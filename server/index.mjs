import { ProjectService } from "./projects.mjs";
import { imageMime } from "./validation-images.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDirectory, t3Home, toolCommand } from "./platform.mjs";
import { runCommand } from "./commands.mjs";
import { randomUUID } from "node:crypto";
import { Store } from "./store.mjs";
import { T3Client } from "./t3.mjs";
import { Scheduler } from "./scheduler.mjs";
import { recordTargetUsage } from "./target-history.mjs";
import { taskThreadTarget } from "./thread-targets.mjs";
import { taskPlanningView, validateTaskPlanning } from "./task-planning.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultDataDir = dataDirectory();
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
  const projects = new ProjectService(store, scheduler, notify);
  const applicationSettings = () => ({
    id: "app",
    paused: false,
    textShortcut: "CommandOrControl+Shift+1",
    screenshotShortcut: "CommandOrControl+Shift+2",
    boardShortcut: "CommandOrControl+Shift+0",
    showInDock: true,
    launchAtLogin: true,
    lastProjectId: null,
    lastThreadId: null,
    ...store.settings("app"),
  });
  const validateProject = (projectId) => {
    if (!scheduler.projects.some((p) => p.id === projectId))
      throw Error("Choose an existing T3 project");
  };
  const validateGroup = (groupId, projectId) => {
    if (!groupId) return;
    const group = store.get("groups", groupId);
    if (!group) throw Error("Epic not found");
    if (group.projectId !== projectId)
      throw Error("Choose an epic in this project");
    if (group.status === "done") throw Error("Choose an active epic");
  };
  const presentTask = (task) =>
    taskPlanningView(task, new Map(store.list("tasks").map((t) => [t.id, t])));
  const taskViews = () => {
    const tasks = store.list("tasks");
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return tasks.map((task) => taskPlanningView(task, byId));
  };
  const state = () => ({
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
      cli,
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
      const requestPort = server.address()?.port ?? port;
      const url = new URL(req.url, "http://127.0.0.1:" + requestPort);
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
      if (path === "/api/tasks" && req.method === "POST") {
        const input = await body(req);
        if (input.prompt?.length > 100000)
          throw Error("Keep the task prompt below 100,000 characters");
        if (!input.prompt?.trim()) throw Error("Write or dictate a task first");
        if (!scheduler.projects.some((p) => p.id === input.projectId))
          throw Error("Choose an existing T3 project");
        validateGroup(input.groupId, input.projectId);
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
          Object.assign(
            task,
            { priority: "normal", blockedBy: [] },
            validateTaskPlanning(task, input, store.list("tasks")),
          );
          Object.assign(
            task,
            taskThreadTarget(store, scheduler.threads, task.projectId, input),
          );
          store.put("tasks", task);
          store.event(task.id, "created", {
            projectId: task.projectId,
            threadId: task.threadId,
          });
          store.put(
            "settings",
            recordTargetUsage(
              applicationSettings(),
              {
                projectId: task.projectId,
                threadId: task.threadId,
                groupId: task.groupId,
              },
              task.createdAt,
            ),
          );
        });
        notify();
        scheduler.signal();
        return respond(res, presentTask(task), 201);
      }
      const taskRoute = path.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskRoute) {
        const [, id, action] = taskRoute;
        const task = store.get("tasks", id);
        if (!task) return respond(res, { error: "Task not found" }, 404);
        if (req.method === "GET")
          return respond(res, {
            task: presentTask(task),
            attempts: store.list("attempts").filter((a) => a.taskId === id),
            events: store.list("events").filter((e) => e.taskId === id),
          });
        const input = await body(req);
        if (req.method === "DELETE") {
          if (task.status === "doing")
            throw Error("Stop the task before deleting it");
          const dependents = store
            .list("tasks")
            .filter((t) => t.blockedBy?.includes(id));
          if (dependents.length)
            throw Error(
              "Remove this blocker from " +
                dependents
                  .map((t) => "TL-" + t.id.slice(0, 4).toUpperCase())
                  .join(", ") +
                " before deleting it",
            );
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
          return respond(res, presentTask(store.get("tasks", id)));
        }
        if (action === "block" || action === "unblock") {
          if (
            !Array.isArray(input.blockerIds) ||
            !input.blockerIds.length ||
            input.blockerIds.some((id) => typeof id !== "string")
          )
            throw Error("Specify blocking task IDs");
          input.blockedBy =
            action === "block"
              ? [...new Set([...(task.blockedBy ?? []), ...input.blockerIds])]
              : (task.blockedBy ?? []).filter(
                  (id) => !input.blockerIds.includes(id),
                );
        }
        if (
          req.method === "PATCH" ||
          ["update", "block", "unblock"].includes(action)
        ) {
          if ("groupId" in input && input.groupId !== task.groupId)
            validateGroup(input.groupId, task.projectId);
          if (input.status === "done" && task.status !== "review")
            throw Error("Only a reviewed task can be accepted");
          const patch = validateTaskPlanning(task, input, store.list("tasks"));
          if ("prompt" in input) {
            if (task.status !== "todo")
              throw Error(
                "Only queued prompts can be edited; request a revision for completed tasks",
              );
            if (!input.prompt?.trim() || input.prompt.length > 100000)
              throw Error("Write a prompt below 100,000 characters");
            patch.prompt = input.prompt.trim();
            if (!task.currentAttemptId) patch.originalPrompt = patch.prompt;
          }
          if ("threadId" in input || "threadKey" in input) {
            if (task.status !== "todo" || task.currentAttemptId)
              throw Error("Only tasks that have not started can change thread");
          }
          if (
            input.status &&
            !["todo", "review", "done", "cancelled", "failed"].includes(
              input.status,
            )
          )
            throw Error("Invalid task status");
          if (input.status === "review" && !task.currentAttemptId)
            throw Error("A task must execute before it can be reviewed");
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
          const updated = store.transaction(() => {
            if ("threadId" in input || "threadKey" in input)
              Object.assign(
                patch,
                taskThreadTarget(
                  store,
                  scheduler.threads,
                  task.projectId,
                  input,
                ),
              );
            const result = store.update("tasks", id, patch);
            store.event(id, "updated", patch);
            return result;
          });
          notify();
          scheduler.signal();
          if (task.groupId && task.groupId !== updated.groupId)
            scheduler.queueGroupReport(task.groupId);
          if (updated.groupId) scheduler.queueGroupReport(updated.groupId);
          return respond(res, presentTask(updated));
        }
      }
      if (path === "/api/groups" && req.method === "POST") {
        const input = await body(req);
        if (!input.name?.trim()) throw Error("Enter an epic name");
        validateProject(input.projectId);
        const group = {
          id: randomUUID(),
          name: input.name.trim(),
          projectId: input.projectId,
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
          recordTargetUsage(applicationSettings(), input),
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
