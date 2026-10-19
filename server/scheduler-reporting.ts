import { createHash } from "node:crypto";
import type { Attempt } from "../shared/types.js";
import type { Scheduler } from "./scheduler.js";
import { collectValidationImages } from "./validation-images.js";
export class SchedulerReporting {
  constructor(private scheduler: Scheduler) {}
  async enrichEvidence(a: Pick<Attempt, "evidence" | "threadId">) {
    const enriched = [];
    for (let start = 0; start < (a.evidence ?? []).length; start += 4) {
      const batch = await Promise.all(
        (a.evidence ?? []).slice(start, start + 4).map(async (item) => {
          if (["command_execution", "file_change"].includes(item.type)) {
            try {
              const full = await this.scheduler.t3.call(
                "orchestration.getTurnItem",
                {
                  threadId: a.threadId,
                  itemId: item.id,
                },
              );
              if (full.item)
                return {
                  ...item,
                  text:
                    full.item.text ??
                    full.item.output ??
                    full.item.diffStr ??
                    "",
                  payload: full.item,
                };
            } catch {}
          }
          return item;
        }),
      );
      enriched.push(...batch);
    }
    return enriched;
  }
  async captureValidationImages(a: Attempt, persist = true) {
    const artifacts = await collectValidationImages(
      this.scheduler.store,
      a,
      this.scheduler.t3.config,
    );
    if (persist) {
      this.scheduler.store.update("attempts", a.id, artifacts);
      const task = this.scheduler.store.get("tasks", a.taskId);
      if (task?.currentAttemptId === a.id)
        this.scheduler.store.update("tasks", task.id, artifacts);
      this.scheduler.notify();
    }
    return artifacts;
  }
  queueTaskReport(attemptId: string) {
    this.scheduler.reports.enqueue({
      key: "task:" + attemptId,
      run: async () => {
        let a = this.scheduler.store.require("attempts", attemptId);
        if (!a.evidenceEnriched)
          a = this.scheduler.store.update("attempts", a.id, {
            evidence: await this.scheduler.enrichEvidence(a),
            evidenceEnriched: true,
          });
        const report = await this.scheduler.reports.extract("task", {
          taskId: a.taskId,
          attemptId: a.id,
          prompt: a.compiledPrompt,
          evidence: a.evidence ?? [],
          status: a.state,
        });
        this.scheduler.store.update("attempts", a.id, {
          result: report,
          reportState: "ready",
          reportError: null,
        });
        const task = this.scheduler.store.get("tasks", a.taskId);
        if (task && task.currentAttemptId === a.id)
          this.scheduler.store.update("tasks", task.id, {
            report,
            reportState: "ready",
            reportError: null,
          });
        this.scheduler.notify();
        if (task?.groupId) this.scheduler.queueGroupReport(task.groupId);
      },
      fail: (e) => {
        const a = this.scheduler.store.require("attempts", attemptId);
        this.scheduler.store.update("attempts", attemptId, {
          reportState: "error",
          reportError: e.message,
        });
        const task = this.scheduler.store.get("tasks", a.taskId);
        if (task && task.currentAttemptId === attemptId)
          this.scheduler.store.update("tasks", task.id, {
            reportState: "error",
            reportError: e.message,
          });
        this.scheduler.notify();
      },
    });
  }
  queueGroupReport(groupId: string) {
    const group = this.scheduler.store.get("groups", groupId);
    if (!group) return;
    this.scheduler.store.update("groups", groupId, { summaryState: "pending" });
    this.scheduler.reports.enqueue({
      key: "group:" + groupId,
      run: async () => {
        const g = this.scheduler.store.get("groups", groupId);
        if (!g) return;
        const tasks = this.scheduler.store
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
        const report = await this.scheduler.reports.extract("group", input);
        const current = this.scheduler.store.get("groups", groupId);
        if (!current) return;
        const currentTasks = this.scheduler.store
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
          this.scheduler.queueGroupReport(groupId);
          return;
        }
        this.scheduler.store.update("groups", groupId, {
          summary: report,
          summaryState: "ready",
          summaryError: null,
        });
        this.scheduler.notify();
      },
      fail: (e) => {
        if (!this.scheduler.store.get("groups", groupId)) return;
        this.scheduler.store.update("groups", groupId, {
          summaryState: "error",
          summaryError: e.message,
        });
        this.scheduler.notify();
      },
    });
  }
}
