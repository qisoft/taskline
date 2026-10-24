import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asError } from "../shared/errors.js";
import type {
  Answers,
  Attempt,
  Model,
  Project,
  Projection,
  ProjectPolicy,
  Task,
  Thread,
} from "../shared/types.js";
import {
  conservativeReport,
  ReportWorker,
  snapshotEvidence,
} from "./reports.js";
import { TaskExecution } from "./scheduler-execution.js";
import { SchedulerReporting } from "./scheduler-reporting.js";
import { activeStates, terminal } from "./scheduler-state.js";
import type { Store } from "./store.js";
import type { T3Client } from "./t3.js";
import { schedulingPauseReason } from "./epic-mode.js";
import { compareTaskPriority, pendingBlockers } from "./task-planning.js";
export class Scheduler {
  private execution: TaskExecution;
  private reporting: SchedulerReporting;
  projects: Project[] = [];
  threads: Thread[] = [];
  models: Model[] = [];
  environment?: { environmentId: string };
  lastRefresh?: number;
  connected = false;
  error: string | null = null;
  busy = false;
  subscriptions = new Map<string, () => void>();
  reports: ReportWorker;
  timer: ReturnType<typeof setInterval> | undefined;
  dirtyTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    public store: Store,
    public t3: T3Client,
    public notify: () => void,
  ) {
    this.reports = new ReportWorker(store, notify);
    this.execution = new TaskExecution(this);
    this.reporting = new SchedulerReporting(this);
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
  projectSettings(id: string): ProjectPolicy {
    const project = this.projects.find((p) => p.id === id);
    let baseRef =
      this.threads.find((t) => t.projectId === id && t.branch)?.branch ||
      "main";
    try {
      if (
        ["127.0.0.1", "localhost", "[::1]"].includes(
          new URL(this.t3.config.origin ?? "").hostname,
        )
      ) {
        const head = readFileSync(
          join(project!.workspaceRoot, ".git", "HEAD"),
          "utf8",
        ).trim();
        if (head.startsWith("ref: refs/heads/")) baseRef = head.slice(16);
      }
    } catch {}
    const policy = {
      concurrencyLimit: 2,
      autoStart: true,
      model: project?.defaultModelSelection?.model || "gpt-6-luna",
      instanceId: project?.defaultModelSelection?.instanceId || "codex",
      baseRef,
      runtimeMode: "full-access",
      ...this.store.settings("project:" + id),
    };
    return {
      ...policy,
      mode: policy.autoStart === false ? "paused" : "active",
    };
  }
  start() {
    for (const a of this.store
      .list("attempts")
      .filter((a) => a.completedAt && !a.validationArtifactsCollectedAt))
      this.reports.enqueue({
        key: "images:" + a.id,
        run: () => this.captureValidationImages(a),
        fail: () => {},
      });
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
    for (const target of this.store.list("threadTargets"))
      if (
        !target.materializedAt &&
        this.threads.some(
          (t) => t.id === target.id && t.projectId === target.projectId,
        )
      )
        this.store.update("threadTargets", target.id, {
          materializedAt: new Date().toISOString(),
        });
    this.environment = await this.t3.http<{ environmentId: string }>(
      "/.well-known/t3/environment",
    );
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
          .sort(compareTaskPriority);
        for (const candidate of tasks) {
          const task = this.store.get("tasks", candidate.id);
          if (!task || task.status !== "todo" || task.paused) continue;
          const policy = this.projectSettings(task.projectId);
          const pauseReason = schedulingPauseReason(
            this.store.get("groups", task.groupId),
            policy.autoStart,
          );
          if (pauseReason) {
            if (task.waitReason !== pauseReason)
              this.store.update("tasks", task.id, {
                waitReason: pauseReason,
              });
            continue;
          }
          if (
            ["Project is paused", "Epic is paused", "Epic is closed"].includes(
              task.waitReason ?? "",
            )
          )
            this.store.update("tasks", task.id, { waitReason: null });
          const blockers = pendingBlockers(task, {
            get: (id) => this.store.get("tasks", id),
          });
          if (blockers.length) {
            const waitReason =
              "Blocked by " +
              blockers
                .map((id) => "TL-" + id.slice(0, 4).toUpperCase())
                .join(", ");
            if (task.waitReason !== waitReason)
              this.store.update("tasks", task.id, { waitReason });
            continue;
          }
          if (task.waitReason?.startsWith("Blocked by "))
            this.store.update("tasks", task.id, { waitReason: null });
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
            ? this.threads.find(
                (t) => t.id === task.threadId && !t.archivedAt && !t.deletedAt,
              )
            : null;
          const target = task.threadKey
            ? this.store.get("threadTargets", task.threadId)
            : null;
          const pendingThread = target && !target.materializedAt;
          if (task.threadId && !thread && !pendingThread) {
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
              ].includes(thread.status ?? ""))
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
    } catch (caught) {
      const e = asError(caught);
      this.error = e.message;
      this.connected = false;
      this.notify();
    } finally {
      this.busy = false;
    }
  }
  admit(
    task: Task,
    policy: ProjectPolicy,
    workspace: string | null | undefined,
  ) {
    return this.execution.admit(task, policy, workspace);
  }
  deliver(attempt: Attempt) {
    return this.execution.deliver(attempt);
  }
  observeThread(projection: Projection) {
    return this.execution.observeThread(projection);
  }
  watch(threadId: string) {
    return this.execution.watch(threadId);
  }
  async reconcile(attempt: Attempt) {
    this.watch(attempt.threadId);
    let p;
    try {
      p = await this.t3.snapshot(attempt.threadId);
    } catch (caught) {
      const e = asError(caught);
      if (!attempt.runId && /not found/i.test(e.message)) {
        await this.deliver(attempt);
        return;
      }
      throw e;
    }
    this.observeThread(p);
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
    let evidence = snapshotEvidence(p, [...runIds]);
    const pendingIds = new Set(
      p.runtimeRequests.filter((r) => r.status === "pending").map((r) => r.id),
    );
    const questions = p.turnItems
      .filter(
        (i) =>
          runIds.has(i.runId) &&
          ["user_input_request", "approval_request"].includes(i.type) &&
          pendingIds.has(i.requestId ?? ""),
      )
      .map((i) => ({
        requestId: i.requestId!,
        type: i.type,
        questions: i.questions ?? [],
        prompt: i.prompt ?? "",
        options: i.options ?? [],
        requestKind: i.requestKind,
      }));
    this.store.update("attempts", attempt.id, {
      runId: root.id,
      runIds: [...runIds],
      state: working?.status ?? (children.length ? "waiting" : "collecting"),
      evidence,
      questions,
      workspace: p.thread.worktreePath ?? attempt.workspace,
    });
    this.store.update("tasks", attempt.taskId, {
      executionState: questions.length
        ? "waiting"
        : (working?.status ?? (children.length ? "waiting" : "collecting")),
      questions,
      error: null,
    });
    if (!working && !children.length && terminal.has(latest.status)) {
      evidence = await this.enrichEvidence({ ...attempt, evidence });
      const artifacts = await this.captureValidationImages(
        {
          ...attempt,
          workspace: p.thread.worktreePath ?? attempt.workspace,
          evidence,
        },
        false,
      );
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
          evidence,
          evidenceEnriched: true,
          ...artifacts,
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
          ...artifacts,
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
  enrichEvidence(a: Pick<Attempt, "evidence" | "threadId">) {
    return this.reporting.enrichEvidence(a);
  }
  captureValidationImages(a: Attempt, persist = true) {
    return this.reporting.captureValidationImages(a, persist);
  }
  queueTaskReport(attemptId: string): void {
    this.reporting.queueTaskReport(attemptId);
  }
  queueGroupReport(groupId: string): void {
    this.reporting.queueGroupReport(groupId);
  }
  respond(taskId: string, requestId: string, answers: Answers) {
    return this.execution.respond(taskId, requestId, answers);
  }
  approve(taskId: string, requestId: string, decision: string) {
    return this.execution.approve(taskId, requestId, decision);
  }
  cancel(taskId: string) {
    return this.execution.cancel(taskId);
  }
}
