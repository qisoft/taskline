import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asError } from "../shared/errors.js";
import type { AppSettings, AppState, Epic, Task } from "../shared/types.js";
import { runCommand } from "./commands.js";
import { body, respond } from "./http.js";
import { dataDirectory, t3Home, toolCommand } from "./platform.js";
import { ProjectService } from "./projects.js";
import { Scheduler } from "./scheduler.js";
import { assetPath } from "./static-files.js";
import { Store } from "./store.js";
import { T3Client } from "./t3.js";
import { recordTargetUsage } from "./target-history.js";
import { taskPlanningView } from "./task-planning.js";
import { createTaskRoutes } from "./task-routes.js";
import { imageMime } from "./validation-images.js";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = existsSync(join(moduleRoot, "package.json"))
  ? moduleRoot
  : resolve(moduleRoot, "..");
export const defaultDataDir = dataDirectory();
const mime: Record<string, string> = {
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
  const connections = new Set<ServerResponse>();
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
  const projects = new ProjectService(store, scheduler, notify);
  const applicationSettings = (): AppSettings => ({
    paused: false,
    textShortcut: "CommandOrControl+Shift+1",
    screenshotShortcut: "CommandOrControl+Shift+2",
    boardShortcut: "CommandOrControl+Shift+0",
    showInDock: true,
    launchAtLogin: true,
    lastProjectId: null,
    lastThreadId: null,
    ...store.settings("app"),
    id: "app",
  });
  const validateProject = (projectId: string | undefined) => {
    if (!scheduler.projects.some((p) => p.id === projectId))
      throw Error("Choose an existing T3 project");
  };
  const validateGroup = (
    groupId: string | null | undefined,
    projectId: string | undefined,
  ) => {
    if (!groupId) return;
    const group = store.get("groups", groupId);
    if (!group) throw Error("Epic not found");
    if (group.projectId !== projectId)
      throw Error("Choose an epic in this project");
    if (group.status === "done") throw Error("Choose an active epic");
  };
  const presentTask = (task: Task) =>
    taskPlanningView(task, new Map(store.list("tasks").map((t) => [t.id, t])));
  const taskViews = () => {
    const tasks = store.list("tasks");
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return tasks.map((task) => taskPlanningView(task, byId));
  };
  const state = (): AppState => ({
    tasks: taskViews().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    groups: store.list("groups"),
    projects: scheduler.projects,
    threads: scheduler.threads,
    threadTargets: store.list("threadTargets"),
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
    const runtimePath = join(t3Home(), "userdata", "server-runtime.json");
    if (!existsSync(runtimePath))
      throw Error("Start T3 Code on this computer first.");
    const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
    const result = await runCommand(
      toolCommand("t3"),
      [
        "auth",
        "session",
        "issue",
        "--base-dir",
        t3Home(),
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
  const taskRoutes = createTaskRoutes({
    store,
    scheduler,
    validateGroup,
    applicationSettings,
    presentTask,
    notify,
  });
  const server = createServer(async (req, res) => {
    try {
      const requestPort =
        (server.address() as import("node:net").AddressInfo | null)?.port ??
        port;
      const url = new URL(req.url ?? "/", "http://127.0.0.1:" + requestPort);
      const path = url.pathname;
      if (
        req.headers.origin &&
        ![
          "http://127.0.0.1:" + requestPort,
          "http://localhost:" + requestPort,
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
        const bytes = store.image(id);
        res.writeHead(200, {
          "Content-Type": imageMime(bytes) ?? "application/octet-stream",
          "Cache-Control": "private, max-age=86400",
        });
        return res.end(bytes);
      }
      if (path === "/api/projects" && req.method === "POST")
        return respond(res, await projects.create(await body(req)), 201);
      if (
        (path === "/api/tasks" && req.method === "POST") ||
        /^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/.test(path)
      )
        return await taskRoutes(req, res, path);
      if (path === "/api/groups" && req.method === "POST") {
        const input = await body(req);
        if (!input.name?.trim()) throw Error("Enter an epic name");
        validateProject(input.projectId);
        const group: Epic = {
          id: randomUUID(),
          name: input.name.trim(),
          projectId: input.projectId!,
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
          if ("projectId" in input && input.projectId !== group.projectId) {
            validateProject(input.projectId);
            if (group.projectId)
              throw Error("An epic cannot move to another project");
            if (
              store
                .list("tasks")
                .some(
                  (t) => t.groupId === id && t.projectId !== input.projectId,
                )
            )
              throw Error("All epic tasks must belong to the selected project");
          }
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
      if (path === "/api/selection" && req.method === "POST") {
        const input = await body(req);
        validateProject(input.projectId);
        if (
          input.threadId &&
          store.get("threadTargets", input.threadId)?.projectId !==
            input.projectId &&
          !scheduler.threads.some(
            (t) =>
              t.id === input.threadId &&
              t.projectId === input.projectId &&
              !t.archivedAt &&
              !t.deletedAt &&
              (t.lineage?.relationshipToParent ?? t.relationshipToParent) !==
                "subagent",
          )
        )
          throw Error("Choose a thread in this project");
        if ("groupId" in input) validateGroup(input.groupId, input.projectId);
        const updated = store.put(
          "settings",
          recordTargetUsage(applicationSettings(), {
            ...input,
            projectId: input.projectId!,
          }),
        );
        notify();
        return respond(res, updated);
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
        const settings = projects.update(id, input);
        return respond(res, settings);
      }
      if (path.startsWith("/api/"))
        return respond(res, { error: "Not found" }, 404);
      const dist = join(root, "dist");
      const file = assetPath(dist, path);
      const final = file && existsSync(file) ? file : join(dist, "index.html");
      if (!existsSync(final)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        return res.end("Run npm run build to prepare the interface.");
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(final)] ?? "application/octet-stream",
      });
      res.end(readFileSync(final));
    } catch (caught) {
      const e = asError(caught);
      respond(res, { error: e.message }, 400);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });
  if (!t3.config.token && existsSync(join(root, ".t3-token"))) {
    const runtime = JSON.parse(
      readFileSync(join(t3Home(), "userdata", "server-runtime.json"), "utf8"),
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
