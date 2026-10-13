import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Store } from "./store.mjs";
import { T3Client } from "./t3.mjs";
import { Scheduler } from "./scheduler.mjs";
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultDataDir = join(
  homedir(),
  "Library",
  "Application Support",
  "Taskline",
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
export async function startServer({
  port = Number(process.env.TASKLINE_PORT ?? 4318),
  dataDir = process.env.TASKLINE_DATA_DIR ?? defaultDataDir,
} = {}) {
  const store = new Store(dataDir);
  const connections = new Set();
  const notify = () => {
    for (const res of connections)
      res.write(
        "data: " +
          JSON.stringify({ type: "changed", time: Date.now() }) +
          "\n\n",
      );
  };
  const config = store.config();
  const t3 = new T3Client(config);
  const scheduler = new Scheduler(store, t3, notify);
  const applicationSettings = () => ({
    id: "app",
    paused: false,
    textShortcut: "CommandOrControl+Shift+Space",
    screenshotShortcut: "CommandOrControl+Shift+2",
    launchAtLogin: true,
    lastProjectId: null,
    lastThreadId: null,
    ...store.settings("app"),
  });
  const state = () => ({
    tasks: store
      .list("tasks")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    groups: store.list("groups"),
    projects: scheduler.projects,
    threads: scheduler.threads,
    models: scheduler.models ?? [],
    projectSettings: scheduler.projects.map((p) =>
      scheduler.projectSettings(p.id),
    ),
    settings: applicationSettings(),
    connection: {
      origin: t3.config.origin ?? null,
      connected: scheduler.connected,
      error: scheduler.error,
      environmentId: scheduler.environment?.environmentId ?? null,
    },
    dataDir,
  });
  async function localConnect() {
    const runtimePath = join(
      homedir(),
      ".t3",
      "userdata",
      "server-runtime.json",
    );
    if (!existsSync(runtimePath))
      throw Error("Start T3 Code on this computer first.");
    const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
    const cli = join(homedir(), ".t3", "bin", "t3");
    if (!existsSync(cli))
      throw Error(
        "T3 CLI not found. Open T3 Code once to install its local command.",
      );
    const result = await exec(
      cli,
      [
        "auth",
        "session",
        "issue",
        "--base-dir",
        join(homedir(), ".t3"),
        "--label",
        "Taskline",
        "--ttl",
        "90d",
        "--scope",
        "orchestration:read",
        "--scope",
        "orchestration:operate",
        "--scope",
        "filesystem:read",
        "--scope",
        "settings:write",
        "--token-only",
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const next = { origin: runtime.origin, token: result.stdout.trim() };
    store.saveConfig(next);
    t3.close();
    t3.config = next;
    scheduler.connected = false;
    await scheduler.refresh();
    scheduler.signal();
    return { connected: true, origin: next.origin };
  }
  const respond = (res, value, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  async function body(req) {
    let chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) throw Error("Request too large");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString();
    return text ? JSON.parse(text) : {};
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1:" + port);
      const path = url.pathname;
      if (
        req.headers.origin &&
        ![
          "http://127.0.0.1:" + port,
          "http://localhost:" + port,
          "http://127.0.0.1:4317",
          "http://localhost:4317",
        ].includes(req.headers.origin)
      )
        return respond(res, { error: "Origin not allowed" }, 403);
      if (path === "/api/health")
        return respond(res, { ok: true, version: "1.0.0" });
      if (path === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write('data: {"type":"connected"}\n\n');
        connections.add(res);
        req.on("close", () => connections.delete(res));
        return;
      }
      if (path === "/api/state" && req.method === "GET")
        return respond(res, state());
      if (path === "/api/connect/local" && req.method === "POST") {
        const result = await localConnect();
        notify();
        return respond(res, result);
      }
      if (path === "/api/connect" && req.method === "POST") {
        const input = await body(req);
        if (
          store
            .list("attempts")
            .some((a) =>
              [
                "reserved",
                "preparing",
                "starting",
                "queued",
                "running",
                "waiting",
                "recovering",
              ].includes(a.state),
            )
        )
          throw Error(
            "Pause and finish active work before changing the T3 environment",
          );
        const origin = new URL(input.origin);
        if (!["http:", "https:"].includes(origin.protocol))
          throw Error("Invalid server address");
        store.saveConfig({ origin: origin.origin, token: input.token });
        t3.close();
        t3.config = store.config();
        scheduler.connected = false;
        await scheduler.refresh();
        notify();
        return respond(res, { connected: true });
      }
      if (path === "/api/refresh" && req.method === "POST") {
        await scheduler.refresh();
        return respond(res, state());
      }
      if (path === "/api/attachments" && req.method === "POST") {
        const input = await body(req);
        return respond(
          res,
          store.saveImage(input.base64, input.name, input.mimeType),
        );
      }
      if (path.startsWith("/blobs/")) {
        const id = path.slice(7);
        const metadata = store
          .list("tasks")
          .flatMap((t) => t.attachments ?? [])
          .find((a) => a.id === id);
        res.writeHead(200, {
          "Content-Type": metadata?.mimeType ?? "image/png",
          "Cache-Control": "private, max-age=86400",
        });
        return res.end(store.image(id));
      }
      if (path === "/api/tasks" && req.method === "POST") {
        const input = await body(req);
        if (input.prompt?.length > 100000)
          throw Error("Keep the task prompt below 100,000 characters");
        if (!input.prompt?.trim()) throw Error("Write or dictate a task first");
        if (!scheduler.projects.some((p) => p.id === input.projectId))
          throw Error("Choose an existing T3 project");
        if (
          input.threadId &&
          !scheduler.threads.some(
            (t) => t.id === input.threadId && t.projectId === input.projectId,
          )
        )
          throw Error("Choose a thread in this project");
        if (input.groupId && !store.get("groups", input.groupId))
          throw Error("Group not found");
        const now = new Date().toISOString();
        const task = {
          id: randomUUID(),
          title: (
            input.title?.trim() || input.prompt.trim().split("\n")[0]
          ).slice(0, 100),
          prompt: input.prompt.trim(),
          originalPrompt: input.prompt.trim(),
          projectId: input.projectId,
          threadId: input.threadId || null,
          groupId: input.groupId || null,
          model: input.model || "gpt-6-luna",
          instanceId: input.instanceId || "codex",
          attachments: input.attachments ?? [],
          status: "todo",
          executionState: "queued_on_board",
          rank: Date.now(),
          createdAt: now,
          updatedAt: now,
          questions: [],
          report: null,
          paused: false,
        };
        for (const a of task.attachments) store.image(a.id);
        store.transaction(() => {
          store.put("tasks", task);
          store.event(task.id, "created", {
            projectId: task.projectId,
            threadId: task.threadId,
          });
          store.put("settings", {
            ...applicationSettings(),
            lastProjectId: task.projectId,
            lastThreadId: task.threadId,
            lastGroupId: task.groupId,
          });
        });
        notify();
        scheduler.signal();
        return respond(res, task, 201);
      }
      const taskRoute = path.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskRoute) {
        const [, id, action] = taskRoute;
        const task = store.get("tasks", id);
        if (!task) return respond(res, { error: "Task not found" }, 404);
        if (req.method === "GET")
          return respond(res, {
            task,
            attempts: store.list("attempts").filter((a) => a.taskId === id),
            events: store.list("events").filter((e) => e.taskId === id),
          });
        const input = await body(req);
        if (req.method === "DELETE") {
          if (task.status === "doing")
            throw Error("Stop the task before deleting it");
          store.remove("tasks", id);
          notify();
          return respond(res, { ok: true });
        }
        if (action === "cancel") {
          await scheduler.cancel(id);
          return respond(res, { ok: true });
        }
        if (action === "answer") {
          await scheduler.respond(id, input.requestId, input.answers);
          return respond(res, { ok: true });
        }
        if (action === "approve") {
          await scheduler.approve(id, input.requestId, input.decision);
          return respond(res, { ok: true });
        }
        if (action === "report") {
          if (!task.currentAttemptId)
            throw Error("This task has no attempt yet");
          scheduler.queueTaskReport(task.currentAttemptId);
          return respond(res, { ok: true });
        }
        if (action === "retry" || action === "revision") {
          if (task.status === "doing") throw Error("The task is still running");
          const prompt = input.prompt?.trim() || task.prompt;
          store.update("tasks", id, {
            status: "todo",
            executionState: "queued_on_board",
            prompt,
            report: task.report,
            questions: [],
            paused: false,
            error: null,
            failureAcknowledged: true,
            rank: Date.now(),
          });
          store.event(id, action, { prompt });
          notify();
          scheduler.signal();
          return respond(res, store.get("tasks", id));
        }
        if (req.method === "PATCH" || action === "update") {
          if (input.status === "done" && task.status !== "review")
            throw Error("Only a reviewed task can be accepted");
          const patch = {};
          for (const key of [
            "title",
            "groupId",
            "paused",
            "rank",
            "status",
            "failureAcknowledged",
          ])
            if (key in input) patch[key] = input[key];
          if (
            task.status === "doing" &&
            input.status &&
            input.status !== "doing"
          )
            throw Error("Running task status is controlled by T3");
          const updated = store.update("tasks", id, patch);
          store.event(id, "updated", patch);
          notify();
          scheduler.signal();
          if (task.groupId && task.groupId !== updated.groupId)
            scheduler.queueGroupReport(task.groupId);
          if (updated.groupId) scheduler.queueGroupReport(updated.groupId);
          return respond(res, updated);
        }
      }
      if (path === "/api/groups" && req.method === "POST") {
        const input = await body(req);
        if (!input.name?.trim()) throw Error("Enter an epic name");
        const group = {
          id: randomUUID(),
          name: input.name.trim(),
          context: input.context ?? "",
          acceptanceCriteria: input.acceptanceCriteria ?? "",
          contextVersion: 1,
          decisions: [],
          status: "active",
          summary: null,
          summaryState: "idle",
          createdAt: new Date().toISOString(),
        };
        store.put("groups", group);
        notify();
        return respond(res, group, 201);
      }
      const groupRoute = path.match(/^\/api\/groups\/([^/]+)(?:\/([^/]+))?$/);
      if (groupRoute) {
        const [, id, action] = groupRoute;
        const group = store.get("groups", id);
        if (!group) return respond(res, { error: "Epic not found" }, 404);
        const input = await body(req);
        if (action === "summarize") {
          scheduler.queueGroupReport(id);
          notify();
          return respond(res, { ok: true });
        }
        if (req.method === "DELETE") {
          for (const t of store.list("tasks").filter((t) => t.groupId === id))
            store.update("tasks", t.id, { groupId: null });
          store.remove("groups", id);
          notify();
          return respond(res, { ok: true });
        }
        if (req.method === "PATCH") {
          if (
            input.status === "done" &&
            store
              .list("tasks")
              .some(
                (t) =>
                  t.groupId === id && !["done", "cancelled"].includes(t.status),
              )
          )
            throw Error("Accept all epic tasks before closing the epic");
          const changed =
            ("context" in input && input.context !== group.context) ||
            ("acceptanceCriteria" in input &&
              input.acceptanceCriteria !== group.acceptanceCriteria) ||
            "decisions" in input;
          const update = {
            ...group,
            ...input,
            id,
            contextVersion: group.contextVersion + (changed ? 1 : 0),
          };
          store.put("groups", update);
          notify();
          scheduler.queueGroupReport(id);
          return respond(res, update);
        }
      }
      if (path === "/api/settings" && req.method === "PATCH") {
        const input = await body(req);
        const updated = store.put("settings", {
          ...applicationSettings(),
          ...input,
          id: "app",
        });
        notify();
        scheduler.signal();
        return respond(res, updated);
      }
      if (path.startsWith("/api/projects/") && req.method === "PATCH") {
        const id = decodeURIComponent(path.slice("/api/projects/".length));
        const input = await body(req);
        const limit = Number(input.concurrencyLimit);
        if (
          input.concurrencyLimit !== undefined &&
          (!Number.isInteger(limit) || limit < 1 || limit > 16)
        )
          throw Error("Parallel limit must be 1–16");
        const settings = store.put("settings", {
          ...scheduler.projectSettings(id),
          ...input,
          id: "project:" + id,
        });
        notify();
        scheduler.signal();
        return respond(res, settings);
      }
      if (path.startsWith("/api/"))
        return respond(res, { error: "Not found" }, 404);
      const dist = join(root, "dist");
      const file = path === "/" ? join(dist, "index.html") : join(dist, path);
      const safe =
        resolve(file).startsWith(resolve(dist) + "/") ||
        resolve(file) === join(dist, "index.html");
      const final = safe && existsSync(file) ? file : join(dist, "index.html");
      if (!existsSync(final)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        return res.end("Run npm run build to prepare the interface.");
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(final)] ?? "application/octet-stream",
      });
      res.end(readFileSync(final));
    } catch (e) {
      respond(res, { error: e.message }, 400);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  if (!t3.config.token && existsSync(join(root, ".t3-token"))) {
    const runtime = JSON.parse(
      readFileSync(
        join(homedir(), ".t3", "userdata", "server-runtime.json"),
        "utf8",
      ),
    );
    t3.config = {
      origin: runtime.origin,
      token: readFileSync(join(root, ".t3-token"), "utf8").trim(),
    };
    store.saveConfig(t3.config);
  }
  scheduler.start();
  console.log(
    "Taskline API http://127.0.0.1:" +
      port +
      " · local database " +
      join(dataDir, "taskline.sqlite"),
  );
  return {
    server,
    store,
    scheduler,
    state,
    notify,
    localConnect,
    close: () => {
      scheduler.stop();
      for (const res of connections) res.end();
      server.close();
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const runtime = await startServer();
  process.on("SIGTERM", () => {
    runtime.close();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    runtime.close();
    process.exit(0);
  });
}
