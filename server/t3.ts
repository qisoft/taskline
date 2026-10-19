import type {
  ConnectionConfig,
  T3RpcResults,
  T3RpcRequests,
  ThreadLaunchInput,
  OrchestrationCommand,
  UploadedImage,
  Project,
  Thread,
} from "../shared/types.js";
import { asError } from "../shared/errors.js";
import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

interface Pending {
  timeout?: ReturnType<typeof setTimeout>;
  resolve?: (value: unknown) => void;
  reject?: (error: Error) => void;
  onValue?: (value: unknown) => void;
}
interface WireMessage {
  _tag: string;
  requestId?: string;
  values?: unknown[];
  exit?: {
    _tag: string;
    value?: unknown;
    cause?: { error?: { message?: string } | string; defect?: unknown }[];
  };
}
export class T3Client extends EventEmitter {
  pending = new Map<string, Pending>();
  sequence = 0;
  socket: WebSocket | null = null;
  connecting: Promise<void> | null = null;
  constructor(public config: ConnectionConfig) {
    super();
  }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
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
        } catch (caught) {
          const e = asError(caught);
          this.emit("protocolError", e.message);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  receive(msg: WireMessage) {
    if (msg._tag === "Ping") {
      this.socket!.send(JSON.stringify({ _tag: "Pong" }));
      return;
    }
    const p = this.pending.get(String(msg.requestId));
    if (msg._tag === "Chunk") {
      this.socket!.send(
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
          .map(
            (c) =>
              (typeof c?.error === "object" ? c.error.message : c?.error) ??
              c?.defect ??
              c,
          )
          .filter(Boolean);
        p.reject?.(Error(JSON.stringify(details)));
      }
    }
  }
  async call<K extends keyof T3RpcResults>(
    tag: K,
    payload: T3RpcRequests[K],
    timeoutMs = 30000,
  ): Promise<T3RpcResults[K]> {
    await this.connect();
    const id = String(++this.sequence);
    return new Promise<T3RpcResults[K]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(tag + " timed out; outcome may be unknown"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T3RpcResults[K]),
        reject,
        timeout,
      });
      this.socket!.send(
        JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }),
      );
    });
  }
  async subscribe(
    tag: string,
    payload: unknown,
    onValue: (value: unknown) => void,
  ) {
    await this.connect();
    const id = String(++this.sequence);
    this.pending.set(id, {
      onValue,
      reject: (e) => this.emit("subscriptionError", e.message),
    });
    this.socket!.send(
      JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }),
    );
    return () => {
      if (this.socket?.readyState === 1)
        this.socket!.send(JSON.stringify({ _tag: "Interrupt", requestId: id }));
      this.pending.delete(id);
    };
  }
  async http<T>(path: string): Promise<T> {
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
    return this.http<{ projects: Project[] }>("/api/projects");
  }
  snapshot(threadId: string) {
    return this.call("orchestration.getThreadProjection", { threadId });
  }
  shell() {
    return this.http<{ threads: Thread[] }>("/api/orchestration/shell");
  }
  dispatch(command: OrchestrationCommand) {
    return this.call("orchestration.dispatchCommand", command);
  }
  launch(input: ThreadLaunchInput) {
    return this.call("orchestration.launchThread", input, 60000);
  }
  async upload(file: {
    name: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<UploadedImage> {
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
        body: new Uint8Array(file.bytes),
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
