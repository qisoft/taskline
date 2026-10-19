import { randomUUID } from "node:crypto";
import { asError } from "../shared/errors.js";
import type {
  Answers,
  Attempt,
  ProjectPolicy,
  Projection,
  Task,
} from "../shared/types.js";
import { activeStates, terminal } from "./scheduler-state.js";
import type { Scheduler } from "./scheduler.js";
export class TaskExecution {
  constructor(private scheduler: Scheduler) {}
  async admit(
    task: Task,
    policy: ProjectPolicy,
    workspace: string | null | undefined,
  ) {
    const group = task.groupId
      ? this.scheduler.store.get("groups", task.groupId)
      : null;
    const prompt =
      (group
        ? "Shared epic context (version " +
          group.contextVersion +
          "):\n" +
          group.context +
          "\nAcceptance criteria:\n" +
          (group.acceptanceCriteria ?? "") +
          "\nConfirmed decisions:\n" +
          JSON.stringify(group.decisions ?? []) +
          "\n\n"
        : "") +
      "TASK:\n" +
      task.prompt +
      "\n\nWhen finished, report: what changed, how it was tested (commands and results), remaining work, and questions requiring my decision. Do not claim checks that were not performed.";
    const attempt: Attempt = {
      id: randomUUID(),
      taskId: task.id,
      projectId: task.projectId,
      threadId: task.threadId ?? randomUUID(),
      newThread:
        !task.threadId ||
        Boolean(
          task.threadKey &&
          !this.scheduler.store.get("threadTargets", task.threadId)
            ?.materializedAt,
        ),
      commandId: randomUUID(),
      messageId: randomUUID(),
      runId: null,
      state: "reserved",
      workspace,
      compiledPrompt: prompt,
      contextVersion: group?.contextVersion ?? null,
      attachments: [],
      createdAt: new Date().toISOString(),
      model: task.model ?? policy.model,
      instanceId: task.instanceId ?? policy.instanceId,
      runtimeMode: policy.runtimeMode,
      baseRef: policy.baseRef,
    };
    this.scheduler.store.transaction(() => {
      this.scheduler.store.put("attempts", attempt);
      this.scheduler.store.update("tasks", task.id, {
        status: "doing",
        executionState: "reserved",
        waitReason: null,
        currentAttemptId: attempt.id,
        validationImages: [],
        validationImageIssues: [],
        validationArtifactsCollectedAt: null,
      });
      this.scheduler.store.event(task.id, "reserved", {
        attemptId: attempt.id,
      });
    });
    this.scheduler.notify();
    await this.scheduler.deliver(attempt);
  }
  async deliver(attempt: Attempt) {
    const task = this.scheduler.store.require("tasks", attempt.taskId);
    try {
      if (!attempt.attachments.length && task.attachments?.length) {
        const attachments = [];
        for (const image of task.attachments)
          attachments.push(
            await this.scheduler.t3.upload({
              ...image,
              bytes: this.scheduler.store.image(image.id),
            }),
          );
        attempt = this.scheduler.store.update("attempts", attempt.id, {
          attachments,
        });
      }
      let projection;
      if (attempt.newThread) {
        const response = await this.scheduler.t3.launch({
          commandId: attempt.commandId,
          threadId: attempt.threadId,
          projectId: attempt.projectId,
          title: task.threadKey || task.title,
          modelSelection: {
            instanceId: attempt.instanceId,
            model: attempt.model,
          },
          runtimeMode: attempt.runtimeMode,
          interactionMode: "default",
          workspaceStrategy: {
            type: "worktree",
            baseRef: attempt.baseRef,
            branch:
              "taskline/" + task.id.slice(0, 8) + "-" + attempt.id.slice(0, 6),
            startFromOrigin: false,
          },
          initialMessage: {
            messageId: attempt.messageId,
            text: attempt.compiledPrompt,
            attachments: attempt.attachments,
          },
        });
        projection = response.projection;
      } else {
        await this.scheduler.t3.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: attempt.commandId,
          threadId: attempt.threadId,
          messageId: attempt.messageId,
          text: attempt.compiledPrompt,
          attachments: attempt.attachments,
          modelSelection: {
            instanceId: attempt.instanceId,
            model: attempt.model,
          },
          dispatchMode: { type: "queue_after_active" },
        });
        projection = await this.scheduler.t3.snapshot(attempt.threadId);
      }
      this.scheduler.observeThread(projection);
      const run = projection.runs.find(
        (r) => r.userMessageId === attempt.messageId,
      );
      if (!run)
        throw Error("Accepted command has not materialized its run yet");
      this.scheduler.store.update("attempts", attempt.id, {
        runId: run.id,
        state: run.status,
        workspace:
          projection.thread.worktreePath ??
          this.scheduler.projects.find((p) => p.id === attempt.projectId)
            ?.workspaceRoot,
      });
      this.scheduler.store.update("tasks", task.id, {
        threadId: attempt.threadId,
        executionState: run.status,
      });
      this.scheduler.store.event(task.id, "dispatched", {
        threadId: attempt.threadId,
        runId: run.id,
      });
      this.scheduler.watch(attempt.threadId);
      this.scheduler.notify();
    } catch (caught) {
      const e = asError(caught);
      const definitive =
        /invalid|not found|does not exist|rejected|disabled|Schema|Parse|base ref|Failed to launch|scope/i.test(
          e.message,
        ) && !/timed out|disconnected/i.test(e.message);
      this.scheduler.store.update("attempts", attempt.id, {
        state: definitive ? "failed" : "recovering",
        error: e.message,
      });
      this.scheduler.store.update("tasks", task.id, {
        status: definitive ? "failed" : "doing",
        executionState: definitive ? "failed" : "recovering",
        error: e.message,
      });
      this.scheduler.store.event(task.id, "dispatch_error", {
        error: e.message,
        uncertain: !definitive,
      });
      this.scheduler.notify();
    }
  }
  observeThread(projection: Projection) {
    const thread = projection.thread;
    const target = this.scheduler.store.get("threadTargets", thread.id);
    if (
      target &&
      target.projectId === thread.projectId &&
      !target.materializedAt
    )
      this.scheduler.store.update("threadTargets", target.id, {
        materializedAt: new Date().toISOString(),
      });
    // Shell snapshots are refreshed less often than turns finish. Use the fresh
    // projection so the next queued task can reuse the thread immediately.
    const active = projection.runs.find((r) => !terminal.has(r.status));
    const cached = this.scheduler.threads.find((t) => t.id === thread.id);
    this.scheduler.threads = this.scheduler.threads.filter(
      (t) => t.id !== thread.id,
    );
    this.scheduler.threads.push({
      ...cached,
      ...thread,
      activeRunId:
        "activeRunId" in thread ? thread.activeRunId : (active?.id ?? null),
      status: thread.status ?? active?.status ?? "idle",
    });
  }
  async watch(threadId: string) {
    if (this.scheduler.subscriptions.has(threadId)) return;
    try {
      const unsubscribe = await this.scheduler.t3.subscribe(
        "orchestration.subscribeThread",
        { threadId, acceptBoundedSnapshot: true },
        () => this.scheduler.signal(),
      );
      this.scheduler.subscriptions.set(threadId, unsubscribe);
    } catch {}
  }
  async respond(taskId: string, requestId: string, answers: Answers) {
    const task = this.scheduler.store.require("tasks", taskId);
    const a = this.scheduler.store.require("attempts", task.currentAttemptId);
    await this.scheduler.t3.dispatch({
      type: "runtime-request.respond",
      commandId: randomUUID(),
      threadId: a.threadId,
      requestId,
      answers,
    });
    this.scheduler.store.event(taskId, "answered", { requestId, answers });
    this.scheduler.signal();
  }
  async approve(taskId: string, requestId: string, decision: string) {
    const task = this.scheduler.store.require("tasks", taskId);
    if (!task.threadId) throw Error("Task has no execution thread");
    await this.scheduler.t3.dispatch({
      type: "runtime-request.respond",
      commandId: randomUUID(),
      threadId: task.threadId,
      requestId,
      decision,
    });
    this.scheduler.signal();
  }
  async cancel(taskId: string) {
    const task = this.scheduler.store.require("tasks", taskId);
    const a = task.currentAttemptId
      ? this.scheduler.store.get("attempts", task.currentAttemptId)
      : null;
    if (a && activeStates.has(a.state)) {
      await this.scheduler.t3.dispatch({
        type: "thread.stop",
        commandId: randomUUID(),
        threadId: a.threadId,
      });
      this.scheduler.signal();
    } else
      this.scheduler.store.update("tasks", taskId, {
        status: "cancelled",
        executionState: "cancelled",
      });
    this.scheduler.notify();
  }
}
