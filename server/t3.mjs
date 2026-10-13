import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export class T3Client extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.pending = new Map();
    this.sequence = 0;
    this.socket = null;
    this.connecting = null;
  }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const url = new URL("/ws", this.config.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("orchestrationProtocol", "2");
      const socket = new WebSocket(url, {
        headers: { Authorization: "Bearer " + this.config.token },
      });
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(Error("T3 connection timed out"));
      }, 10000);
      socket.once("open", () => {
        clearTimeout(timeout);
        this.emit("connected");
        resolve();
      });
      socket.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      socket.on("close", () => {
        for (const [id, p] of this.pending) {
          clearTimeout(p.timeout);
          p.reject?.(Error("T3 disconnected"));
        }
        this.pending.clear();
        this.emit("disconnected");
      });
      socket.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          for (const msg of Array.isArray(parsed) ? parsed : [parsed])
            this.receive(msg);
        } catch (e) {
          this.emit("protocolError", e.message);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  receive(msg) {
    if (msg._tag === "Ping") {
      this.socket.send(JSON.stringify({ _tag: "Pong" }));
      return;
    }
    const p = this.pending.get(String(msg.requestId));
    if (msg._tag === "Chunk") {
      this.socket.send(
        JSON.stringify({ _tag: "Ack", requestId: msg.requestId }),
      );
      for (const value of msg.values ?? []) p?.onValue?.(value);
      return;
    }
    if (msg._tag === "Exit" && p) {
      clearTimeout(p.timeout);
      this.pending.delete(String(msg.requestId));
      if (msg.exit?._tag === "Success") p.resolve?.(msg.exit.value);
      else {
        const cause = msg.exit?.cause;
        const errors = Array.isArray(cause) ? cause : [cause];
        const details = errors
          .map((c) => c?.error?.message ?? c?.error ?? c?.defect ?? c)
          .filter(Boolean);
        p.reject?.(Error(JSON.stringify(details)));
      }
    }
  }
  async call(tag, payload = {}, timeoutMs = 30000) {
    await this.connect();
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(tag + " timed out; outcome may be unknown"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(
        JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }),
      );
    });
  }
  async subscribe(tag, payload, onValue) {
    await this.connect();
    const id = String(++this.sequence);
    this.pending.set(id, {
      onValue,
      reject: (e) => this.emit("subscriptionError", e.message),
    });
    this.socket.send(
      JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }),
    );
    return () => {
      if (this.socket?.readyState === 1)
        this.socket.send(JSON.stringify({ _tag: "Interrupt", requestId: id }));
      this.pending.delete(id);
    };
  }
  async http(path) {
    const response = await fetch(new URL(path, this.config.origin), {
      headers: {
        Authorization: "Bearer " + this.config.token,
        "x-t3-orchestration-protocol": "2",
      },
    });
    if (!response.ok)
      throw Error(
        "T3 HTTP " + response.status + ": " + (await response.text()),
      );
    return response.json();
  }
  projects() {
    return this.http("/api/projects");
  }
  snapshot(threadId) {
    return this.call("orchestration.getThreadProjection", { threadId });
  }
  shell() {
    return this.http("/api/orchestration/shell");
  }
  dispatch(command) {
    return this.call("orchestration.dispatchCommand", command);
  }
  launch(input) {
    return this.call("orchestration.launchThread", input, 60000);
  }
  async upload(file) {
    const upload = await this.call("attachments.createUploadUrl", {
      type: "image",
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
    });
    const response = await fetch(
      new URL(upload.relativeUrl, this.config.origin),
      {
        method: "POST",
        headers: { "content-type": file.mimeType },
        body: file.bytes,
      },
    );
    if (!response.ok) throw Error("Upload failed: " + (await response.text()));
    return {
      type: "image",
      id: upload.attachmentId,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
    };
  }
  close() {
    this.socket?.close();
  }
}
export const newId = () => randomUUID();
