import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ReportWorker,
  snapshotEvidence,
  conservativeReport,
} from "./reports.mjs";

const activeStates = new Set([
  "reserved",
  "preparing",
  "starting",
  "queued",
  "running",
  "waiting",
  "recovering",
]);
const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
]);
export class Scheduler {
  constructor(store, t3, notify) {
    this.store = store;
    this.t3 = t3;
    this.notify = notify;
    this.projects = [];
    this.threads = [];
    this.connected = false;
    this.error = null;
    this.busy = false;
    this.subscriptions = new Map();
    this.reports = new ReportWorker(store, notify);
    this.timer = null;
    this.dirtyTimer = null;
    t3.on("disconnected", () => {
      this.connected = false;
      this.subscriptions.clear();
      this.notify();
    });
    t3.on("protocolError", (e) => {
      this.error = e;
      this.notify();
    });
  }
  projectSettings(id) {
    const project = this.projects.find((p) => p.id === id);
    let baseRef =
      this.threads.find((t) => t.projectId === id && t.branch)?.branch ||
      "main";
    try {
      if (
        ["127.0.0.1", "localhost", "[::1]"].includes(
          new URL(this.t3.config.origin).hostname,
        )
      ) {
        const head = readFileSync(
          join(project.workspaceRoot, ".git", "HEAD"),
          "utf8",
        ).trim();
        if (head.startsWith("ref: refs/heads/")) baseRef = head.slice(16);
      }
    } catch {}
    return {
      id,
      concurrencyLimit: 2,
      autoStart: true,
      model: project?.defaultModelSelection?.model || "gpt-6-luna",
      instanceId: project?.defaultModelSelection?.instanceId || "codex",
      baseRef,
      runtimeMode: "full-access",
      ...this.store.settings("project:" + id),
    };
  }
  start() {
    for (const a of this.store
      .list("attempts")
      .filter((a) => a.reportState === "pending"))
      this.queueTaskReport(a.id);
    for (const g of this.store
      .list("groups")
      .filter((g) => g.summaryState === "pending"))
      this.queueGroupReport(g.id);
    this.tick();
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
  }
  stop() {
    this.reports.stop();
    clearInterval(this.timer);
    clearTimeout(this.dirtyTimer);
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.t3.close();
  }
  signal() {
    clearTimeout(this.dirtyTimer);
    this.dirtyTimer = setTimeout(() => this.tick(), 180);
  }
  async refresh() {
    const [projects, shell, config] = await Promise.all([
      this.t3.projects(),
      this.t3.shell(),
      this.t3.call("server.getConfig", {}),
    ]);
    this.models = (config.providers ?? [])
      .filter((p) => p.enabled && p.installed)
      .flatMap((p) =>
        p.models.map((m) => ({
          instanceId: p.instanceId,
          id: m.slug,
          label: (p.displayName ?? p.instanceId) + " · " + m.name,
        })),
      );
    this.projects = projects.projects;
    this.threads = shell.threads ?? [];
    this.environment = await this.t3.http("/.well-known/t3/environment");
    this.connected = true;
    this.error = null;
    this.notify();
  }
  async tick() {
    if (this.busy || !this.t3.config.token) return;
    this.busy = true;
    try {
      if (
        !this.connected ||
        !this.lastRefresh ||
        Date.now() - this.lastRefresh > 15000
      ) {
        await this.refresh();
        this.lastRefresh = Date.now();
      }
      for (const attempt of this.store
        .list("attempts")
        .filter((a) => activeStates.has(a.state))) {
        await this.reconcile(attempt);
      }
      if (this.store.settings("app").paused !== true) {
        const tasks = this.store
          .list("tasks")
          .filter((t) => t.status === "todo" && !t.paused)
          .sort(
            (a, b) =>
              (a.rank ?? a.createdAt) - (b.rank ?? b.createdAt) ||
              a.createdAt.localeCompare(b.createdAt),
          );
        for (const task of tasks) {
          const policy = this.projectSettings(task.projectId);
          if (!policy.autoStart) continue;
          const active = this.store
            .list("attempts")
            .filter((a) => activeStates.has(a.state));
          if (
            active.filter((a) => a.projectId === task.projectId).length >=
            policy.concurrencyLimit
          )
            continue;
          if (task.threadId && active.some((a) => a.threadId === task.threadId))
            continue;
          if (
            task.threadId &&
            this.store
              .list("tasks")
              .some(
                (t) =>
                  t.id !== task.id &&
                  t.threadId === task.threadId &&
                  t.status === "failed" &&
                  !t.failureAcknowledged,
              )
          )
            continue;
          const thread = task.threadId
            ? this.threads.find((t) => t.id === task.threadId)
            : null;
          if (task.threadId && !thread) {
            this.store.update("tasks", task.id, {
              waitReason: "Target thread is missing or archived",
            });
            continue;
          }
          if (
            thread &&
            (thread.activeRunId ||
              [
                "preparing",
                "queued",
                "starting",
                "running",
                "waiting",
              ].includes(thread.status))
          ) {
            this.store.update("tasks", task.id, {
              waitReason: "Waiting for the existing thread",
            });
            continue;
          }
          const workspace =
            thread?.worktreePath ??
            (thread
              ? this.projects.find((p) => p.id === task.projectId)
                  ?.workspaceRoot
              : null);
          if (workspace && active.some((a) => a.workspace === workspace)) {
            this.store.update("tasks", task.id, {
              waitReason: "Workspace is used by another task",
            });
            continue;
          }
          if (
            workspace &&
            this.threads.some(
              (t) =>
                t.id !== thread?.id &&
                (t.worktreePath ??
                  this.projects.find((p) => p.id === t.projectId)
                    ?.workspaceRoot) === workspace &&
                t.activeRunId,
            )
          ) {
            this.store.update("tasks", task.id, {
              waitReason: "Workspace is used by another T3 thread",
            });
            continue;
          }
          await this.admit(task, policy, workspace);
        }
      }
    } catch (e) {
      this.error = e.message;
      this.connected = false;
      this.notify();
    } finally {
      this.busy = false;
    }
  }
  async admit(task, policy, workspace) {
    const group = task.groupId ? this.store.get("groups", task.groupId) : null;
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
    const attempt = {
      id: randomUUID(),
      taskId: task.id,
      projectId: task.projectId,
      threadId: task.threadId ?? randomUUID(),
      newThread: !task.threadId,
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
    this.store.transaction(() => {
      this.store.put("attempts", attempt);
      this.store.update("tasks", task.id, {
        status: "doing",
        executionState: "reserved",
        waitReason: null,
        currentAttemptId: attempt.id,
      });
      this.store.event(task.id, "reserved", { attemptId: attempt.id });
    });
    this.notify();
    await this.deliver(attempt);
  }
  async deliver(attempt) {
    const task = this.store.get("tasks", attempt.taskId);
    try {
      if (!attempt.attachments.length && task.attachments?.length) {
        const attachments = [];
        for (const image of task.attachments)
          attachments.push(
            await this.t3.upload({
              ...image,
              bytes: this.store.image(image.id),
            }),
          );
        attempt = this.store.update("attempts", attempt.id, { attachments });
      }
      let projection;
      if (attempt.newThread) {
        const response = await this.t3.launch({
          commandId: attempt.commandId,
          threadId: attempt.threadId,
          projectId: attempt.projectId,
          title: task.title,
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
        await this.t3.dispatch({
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
        projection = await this.t3.snapshot(attempt.threadId);
      }
      const run = projection.runs.find(
        (r) => r.userMessageId === attempt.messageId,
      );
      if (!run)
        throw Error("Accepted command has not materialized its run yet");
      this.store.update("attempts", attempt.id, {
        runId: run.id,
        state: run.status,
        workspace:
          projection.thread.worktreePath ??
          this.projects.find((p) => p.id === attempt.projectId)?.workspaceRoot,
      });
      this.store.update("tasks", task.id, {
        threadId: attempt.threadId,
        executionState: run.status,
      });
      this.store.event(task.id, "dispatched", {
        threadId: attempt.threadId,
        runId: run.id,
      });
      this.watch(attempt.threadId);
      this.notify();
    } catch (e) {
      const definitive =
        /invalid|not found|does not exist|rejected|disabled|Schema|Parse|base ref|Failed to launch|scope/i.test(
          e.message,
        ) && !/timed out|disconnected/i.test(e.message);
      this.store.update("attempts", attempt.id, {
        state: definitive ? "failed" : "recovering",
        error: e.message,
      });
      this.store.update("tasks", task.id, {
        status: definitive ? "failed" : "doing",
        executionState: definitive ? "failed" : "recovering",
        error: e.message,
      });
      this.store.event(task.id, "dispatch_error", {
        error: e.message,
        uncertain: !definitive,
      });
      this.notify();
    }
  }
  async watch(threadId) {
    if (this.subscriptions.has(threadId)) return;
    try {
      const unsubscribe = await this.t3.subscribe(
        "orchestration.subscribeThread",
        { threadId, acceptBoundedSnapshot: true },
        () => this.signal(),
      );
      this.subscriptions.set(threadId, unsubscribe);
    } catch {}
  }
  async reconcile(attempt) {
    this.watch(attempt.threadId);
    let p;
    try {
      p = await this.t3.snapshot(attempt.threadId);
    } catch (e) {
      if (!attempt.runId && /not found/i.test(e.message)) {
        await this.deliver(attempt);
        return;
      }
      throw e;
    }
    const root = p.runs.find(
      (r) => r.id === attempt.runId || r.userMessageId === attempt.messageId,
    );
    if (!root) {
      if (!attempt.runId) {
        await this.deliver(attempt);
      }
      return;
    }
    const runIds = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of p.runs)
        if (
          (r.restartContinuationOfRunId &&
            runIds.has(r.restartContinuationOfRunId)) ||
          (r.delegatedCompletion?.parentRunId &&
            runIds.has(r.delegatedCompletion.parentRunId))
        ) {
          if (!runIds.has(r.id)) {
            runIds.add(r.id);
            changed = true;
          }
        }
    }
    const owned = p.runs.filter((r) => runIds.has(r.id));
    const working = owned.find((r) => !terminal.has(r.status));
    const children = p.subagents.filter(
      (s) =>
        runIds.has(s.runId) &&
        !["completed", "failed", "cancelled", "interrupted"].includes(s.status),
    );
    const latest = owned.at(-1) ?? root;
    const evidence = snapshotEvidence(p, [...runIds]);
    const pendingIds = new Set(
      p.runtimeRequests.filter((r) => r.status === "pending").map((r) => r.id),
    );
    const questions = p.turnItems
      .filter(
        (i) =>
          runIds.has(i.runId) &&
          ["user_input_request", "approval_request"].includes(i.type) &&
          pendingIds.has(i.requestId),
      )
      .map((i) => ({
        requestId: i.requestId,
        type: i.type,
        questions: i.questions ?? [],
        prompt: i.prompt ?? "",
        options: i.options ?? [],
        requestKind: i.requestKind,
      }));
    this.store.update("attempts", attempt.id, {
      runId: root.id,
      runIds: [...runIds],
      state: working?.status ?? (children.length ? "waiting" : latest.status),
      evidence,
      questions,
      workspace: p.thread.worktreePath ?? attempt.workspace,
    });
    this.store.update("tasks", attempt.taskId, {
      executionState: questions.length
        ? "waiting"
        : (working?.status ?? (children.length ? "waiting" : latest.status)),
      questions,
      error: null,
    });
    if (!working && !children.length && terminal.has(latest.status)) {
      const succeeded = latest.status === "completed";
      const raw = conservativeReport(evidence);
      const fileChanges = evidence
        .filter((i) => i.type === "file_change")
        .map((i) => ({
          id: i.id,
          fileName: i.payload.fileName,
          diff: i.payload.diffStr ?? "",
          changes: i.payload.changes ?? [],
        }));
      const checkpoints = p.checkpoints.filter((c) => runIds.has(c.runId));
      this.store.transaction(() => {
        this.store.update("attempts", attempt.id, {
          state: latest.status,
          result: raw,
          fileChanges,
          checkpoints,
          completedAt: new Date().toISOString(),
          reportState: "pending",
        });
        this.store.update("tasks", attempt.taskId, {
          status: succeeded
            ? "review"
            : latest.status === "cancelled"
              ? "cancelled"
              : "failed",
          executionState: latest.status,
          report: raw,
          reportState: "pending",
          resultVersion: attempt.id,
          completedAt: new Date().toISOString(),
        });
        this.store.event(attempt.taskId, "finished", {
          status: latest.status,
          attemptId: attempt.id,
        });
      });
      this.subscriptions.get(attempt.threadId)?.();
      this.subscriptions.delete(attempt.threadId);
      this.notify();
      this.queueTaskReport(attempt.id);
    } else this.notify();
  }
  queueTaskReport(attemptId) {
    this.reports.enqueue({
      key: "task:" + attemptId,
      run: async () => {
        let a = this.store.get("attempts", attemptId);
        const enriched = [];
        for (const item of a.evidence ?? []) {
          if (["command_execution", "file_change"].includes(item.type)) {
            try {
              const full = await this.t3.call("orchestration.getTurnItem", {
                threadId: a.threadId,
                itemId: item.id,
              });
              if (full.item) {
                enriched.push({
                  ...item,
                  text:
                    full.item.text ??
                    full.item.output ??
                    full.item.diffStr ??
                    "",
                  payload: full.item,
                });
                continue;
              }
            } catch {}
          }
          enriched.push(item);
        }
        a = this.store.update("attempts", a.id, { evidence: enriched });
        const report = await this.reports.extract("task", {
          taskId: a.taskId,
          attemptId: a.id,
          prompt: a.compiledPrompt,
          evidence: a.evidence ?? [],
          status: a.state,
        });
        this.store.update("attempts", a.id, {
          result: report,
          reportState: "ready",
          reportError: null,
        });
        const task = this.store.get("tasks", a.taskId);
        if (task && task.currentAttemptId === a.id)
          this.store.update("tasks", task.id, {
            report,
            reportState: "ready",
            reportError: null,
          });
        this.notify();
        if (task?.groupId) this.queueGroupReport(task.groupId);
      },
      fail: (e) => {
        const a = this.store.get("attempts", attemptId);
        this.store.update("attempts", attemptId, {
          reportState: "error",
          reportError: e.message,
        });
        const task = this.store.get("tasks", a.taskId);
        if (task && task.currentAttemptId === attemptId)
          this.store.update("tasks", task.id, {
            reportState: "error",
            reportError: e.message,
          });
        this.notify();
      },
    });
  }
  queueGroupReport(groupId) {
    const group = this.store.get("groups", groupId);
    if (!group) return;
    this.store.update("groups", groupId, { summaryState: "pending" });
    this.reports.enqueue({
      key: "group:" + groupId,
      run: async () => {
        const g = this.store.get("groups", groupId);
        if (!g) return;
        const tasks = this.store
          .list("tasks")
          .filter((t) => t.groupId === groupId);
        const input = {
          groupId,
          context: g.context,
          contextVersion: g.contextVersion,
          decisions: g.decisions ?? [],
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            prompt: (t.originalPrompt ?? t.prompt).slice(0, 12000),
            status: t.status,
            resultVersion: t.resultVersion,
            report: t.report ?? null,
          })),
        };
        const hash = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex");
        const report = await this.reports.extract("group", input);
        const current = this.store.get("groups", groupId);
        if (!current) return;
        const currentTasks = this.store
          .list("tasks")
          .filter((t) => t.groupId === groupId);
        const currentInput = {
          ...input,
          context: current.context,
          contextVersion: current.contextVersion,
          decisions: current.decisions ?? [],
          tasks: currentTasks.map((t) => ({
            id: t.id,
            title: t.title,
            prompt: (t.originalPrompt ?? t.prompt).slice(0, 12000),
            status: t.status,
            resultVersion: t.resultVersion,
            report: t.report ?? null,
          })),
        };
        if (
          createHash("sha256")
            .update(JSON.stringify(currentInput))
            .digest("hex") !== hash
        ) {
          this.queueGroupReport(groupId);
          return;
        }
        this.store.update("groups", groupId, {
          summary: report,
          summaryState: "ready",
          summaryError: null,
        });
        this.notify();
      },
      fail: (e) => {
        if (!this.store.get("groups", groupId)) return;
        this.store.update("groups", groupId, {
          summaryState: "error",
          summaryError: e.message,
        });
        this.notify();
      },
    });
  }
  async respond(taskId, requestId, answers) {
    const task = this.store.get("tasks", taskId);
    const a = this.store.get("attempts", task.currentAttemptId);
    await this.t3.dispatch({
      type: "runtime-request.respond",
      commandId: randomUUID(),
      threadId: a.threadId,
      requestId,
      answers,
    });
    this.store.event(taskId, "answered", { requestId, answers });
    this.signal();
  }
  async approve(taskId, requestId, decision) {
    const task = this.store.get("tasks", taskId);
    await this.t3.dispatch({
      type: "runtime-request.respond",
      commandId: randomUUID(),
      threadId: task.threadId,
      requestId,
      decision,
    });
    this.signal();
  }
  async cancel(taskId) {
    const task = this.store.get("tasks", taskId);
    const a = task.currentAttemptId
      ? this.store.get("attempts", task.currentAttemptId)
      : null;
    if (a && activeStates.has(a.state)) {
      await this.t3.dispatch({
        type: "thread.stop",
        commandId: randomUUID(),
        threadId: a.threadId,
      });
      this.signal();
    } else
      this.store.update("tasks", taskId, {
        status: "cancelled",
        executionState: "cancelled",
      });
    this.notify();
  }
}
