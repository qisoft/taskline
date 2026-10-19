import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppSettings, Task } from "../shared/types.js";
import { body, respond } from "./http.js";
import type { Scheduler } from "./scheduler.js";
import type { Store } from "./store.js";
import { recordTargetUsage } from "./target-history.js";
import { validateTaskPlanning } from "./task-planning.js";
import { taskThreadTarget } from "./thread-targets.js";
interface TaskRoutesContext {
  store: Store;
  scheduler: Scheduler;
  validateGroup: (
    groupId: string | null | undefined,
    projectId: string | undefined,
  ) => void;
  applicationSettings: () => AppSettings;
  presentTask: (task: Task) => Task;
  notify: () => void;
}
export function createTaskRoutes({
  store,
  scheduler,
  validateGroup,
  applicationSettings,
  presentTask,
  notify,
}: TaskRoutesContext) {
  return async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (path === "/api/tasks" && req.method === "POST") {
      const input = await body(req);
      if ((input.prompt?.length ?? 0) > 100000)
        throw Error("Keep the task prompt below 100,000 characters");
      if (!input.prompt?.trim()) throw Error("Write or dictate a task first");
      if (!scheduler.projects.some((p) => p.id === input.projectId))
        throw Error("Choose an existing T3 project");
      validateGroup(input.groupId, input.projectId);
      const now = new Date().toISOString();
      const task: Task = {
        id: randomUUID(),
        title: (
          input.title?.trim() || input.prompt.trim().split("\n")[0]
        ).slice(0, 100),
        prompt: input.prompt.trim(),
        originalPrompt: input.prompt.trim(),
        projectId: input.projectId!,
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
        if (!task.currentAttemptId) throw Error("This task has no attempt yet");
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
        return respond(res, presentTask(store.require("tasks", id)));
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
                (id) => !input.blockerIds!.includes(id),
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
        const patch: Partial<Task> = validateTaskPlanning(
          task,
          input,
          store.list("tasks"),
        );
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
        ] as const)
          if (key in input) Object.assign(patch, { [key]: input[key] });
        if (task.status === "doing" && input.status && input.status !== "doing")
          throw Error("Running task status is controlled by T3");
        const updated = store.transaction(() => {
          if ("threadId" in input || "threadKey" in input)
            Object.assign(
              patch,
              taskThreadTarget(store, scheduler.threads, task.projectId, input),
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
    return respond(res, { error: "Not found" }, 404);
  };
}
