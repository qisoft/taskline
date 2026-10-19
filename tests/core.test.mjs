import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Store } from "../server/store.js";
import { Scheduler } from "../server/scheduler.js";
import { taskThreadTarget } from "../server/thread-targets.js";
class FakeT3 extends EventEmitter {
  constructor() {
    super();
    this.config = { token: "test" };
    this.projections = new Map();
    this.launches = [];
    this.dispatches = [];
    this.uncertain = false;
  }
  async projects() {
    return {
      projects: [{ id: "p", title: "Test", workspaceRoot: "/project" }],
    };
  }
  async shell() {
    return {
      threads: [...this.projections.values()].map((p) => ({
        ...p.thread,
        status: p.runs.at(-1)?.status ?? "idle",
        activeRunId: p.runs.some((r) => r.status === "running")
          ? p.runs.at(-1).id
          : null,
      })),
    };
  }
  async http() {
    return { environmentId: "test" };
  }
  async call() {
    return { providers: [] };
  }
  async subscribe() {
    return () => {};
  }
  async launch(input) {
    this.launches.push(input);
    const p = {
      thread: {
        id: input.threadId,
        projectId: "p",
        worktreePath: "/worktrees/" + input.threadId,
      },
      runs: [
        {
          id: "run-" + input.threadId,
          userMessageId: input.initialMessage.messageId,
          status: "running",
        },
      ],
      turnItems: [],
      messages: [],
      subagents: [],
      runtimeRequests: [],
      checkpoints: [],
    };
    this.projections.set(input.threadId, p);
    if (this.uncertain) {
      this.uncertain = false;
      throw Error("T3 disconnected");
    }
    return { projection: p };
  }
  async dispatch(command) {
    this.dispatches.push(command);
    const p = this.projections.get(command.threadId);
    p.runs.push({
      id: "run-" + command.messageId,
      userMessageId: command.messageId,
      status: "running",
    });
  }
  async snapshot(id) {
    const p = this.projections.get(id);
    if (!p) throw Error("Thread not found");
    return p;
  }
  close() {}
}
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "taskline-test-"));
  const store = new Store(path);
  const t3 = new FakeT3();
  const scheduler = new Scheduler(store, t3, () => {});
  scheduler.reports.enqueue = () => {};
  const add = (id, threadId = null) =>
    store.put("tasks", {
      id,
      title: id,
      prompt: "Work",
      projectId: "p",
      threadId,
      status: "todo",
      createdAt: new Date().toISOString(),
      rank: Number(id.slice(-1)) || 1,
      attachments: [],
    });
  return {
    store,
    t3,
    scheduler,
    add,
    close: () => {
      scheduler.stop();
      store.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
test("SQLite persists task and original attachment bytes across reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "taskline-store-"));
  let store = new Store(dir);
  const image = store.saveImage(
    Buffer.from("attachment bytes").toString("base64"),
  );
  store.put("tasks", { id: "saved", prompt: "Original", attachments: [image] });
  store.close();
  store = new Store(dir);
  assert.equal(store.get("tasks", "saved").prompt, "Original");
  assert.equal(store.image(image.id).toString(), "attachment bytes");
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
test("project cap limits simultaneous work and different threads get separate workspaces", async () => {
  const f = fixture();
  try {
    f.add("t1");
    f.add("t2");
    f.add("t3");
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 2);
    assert.equal(f.store.get("tasks", "t3").status, "todo");
    const running = f.store.list("attempts");
    assert.notEqual(running[0].workspace, running[1].workspace);
    f.t3.projections.get(running[0].threadId).runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "review");
    assert.equal(f.store.get("tasks", "t3").status, "doing");
  } finally {
    f.close();
  }
});
test("tasks in the same existing thread are admitted sequentially", async () => {
  const f = fixture();
  try {
    f.t3.projections.set("same", {
      thread: { id: "same", projectId: "p", worktreePath: "/same" },
      runs: [],
      turnItems: [],
      messages: [],
      subagents: [],
      runtimeRequests: [],
      checkpoints: [],
    });
    f.add("t1", "same");
    f.add("t2", "same");
    await f.scheduler.tick();
    assert.equal(f.t3.dispatches.length, 1);
    assert.equal(f.t3.dispatches[0].dispatchMode.type, "queue_after_active");
    f.t3.projections.get("same").runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.t3.dispatches.length, 2);
    assert.equal(f.store.get("tasks", "t1").status, "review");
    assert.equal(f.store.get("tasks", "t2").status, "doing");
  } finally {
    f.close();
  }
});
test("lost launch response reconciles the existing run without starting another", async () => {
  const f = fixture();
  try {
    f.t3.uncertain = true;
    f.add("t1");
    await f.scheduler.tick();
    assert.equal(f.store.list("attempts")[0].state, "recovering");
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    assert.equal(f.store.list("attempts")[0].state, "running");
  } finally {
    f.close();
  }
});
test("active child work keeps a completed parent attempt out of Review", async () => {
  const f = fixture();
  try {
    f.add("t1");
    await f.scheduler.tick();
    const a = f.store.list("attempts")[0];
    const p = f.t3.projections.get(a.threadId);
    p.runs[0].status = "completed";
    p.subagents = [{ id: "child", runId: p.runs[0].id, status: "running" }];
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "doing");
    assert.equal(f.store.list("attempts")[0].state, "waiting");
    p.subagents[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "review");
  } finally {
    f.close();
  }
});
test("compiled prompt snapshots epic context while preserving task prompt", async () => {
  const f = fixture();
  try {
    f.store.put("groups", {
      id: "g",
      context: "Version one",
      contextVersion: 1,
      decisions: [],
    });
    const t = f.add("t1");
    f.store.update("tasks", t.id, { groupId: "g" });
    await f.scheduler.tick();
    f.store.update("groups", "g", {
      context: "Version two",
      contextVersion: 2,
    });
    const a = f.store.list("attempts")[0];
    assert.match(a.compiledPrompt, /Version one/);
    assert.doesNotMatch(a.compiledPrompt, /Version two/);
    assert.equal(a.contextVersion, 1);
    assert.equal(f.store.get("tasks", t.id).prompt, "Work");
  } finally {
    f.close();
  }
});

test("task-level keys serialize a future thread while different keys in the same epic run in parallel", async () => {
  const f = fixture();
  try {
    f.store.put("groups", { id: "epic", context: "Shared", contextVersion: 1 });
    for (const [id, key] of [
      ["t1", "api"],
      ["t2", "api"],
      ["t3", "ui"],
    ]) {
      f.add(id);
      f.store.transaction(() =>
        f.store.update("tasks", id, {
          ...taskThreadTarget(f.store, [], "p", { threadKey: key }),
          groupId: "epic",
        }),
      );
    }
    const first = f.store.get("tasks", "t1");
    assert.equal(first.threadId, f.store.get("tasks", "t2").threadId);
    assert.notEqual(first.threadId, f.store.get("tasks", "t3").threadId);
    assert.equal(f.t3.launches.length, 0);
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 2);
    assert.equal(f.store.get("tasks", "t2").status, "todo");
    assert.equal(f.store.get("groups", "epic").threadId, undefined);
    f.t3.projections.get(first.threadId).runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 2);
    assert.equal(f.t3.dispatches.length, 1);
    assert.equal(f.t3.dispatches[0].threadId, first.threadId);
    assert.equal(f.store.get("tasks", "t1").status, "review");
    assert.equal(f.store.get("tasks", "t2").status, "doing");
    assert.equal(
      f.store.list("attempts").filter((a) => a.threadId === first.threadId)[0]
        .workspace,
      f.store.list("attempts").filter((a) => a.threadId === first.threadId)[1]
        .workspace,
    );
  } finally {
    f.close();
  }
});

test("a future thread binding survives lost launch response and scheduler restart", async () => {
  const f = fixture();
  try {
    const target = f.store.transaction(() =>
      taskThreadTarget(f.store, [], "p", { threadKey: "future" }),
    );
    for (const id of ["t1", "t2"]) {
      f.add(id);
      f.store.update("tasks", id, target);
    }
    f.t3.uncertain = true;
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t2").status, "todo");
    const original = f.store.list("attempts")[0];
    f.scheduler.stop();
    f.scheduler = new Scheduler(f.store, f.t3, () => {});
    f.scheduler.reports.enqueue = () => {};
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    assert.equal(f.store.list("attempts")[0].commandId, original.commandId);
    assert.ok(f.store.get("threadTargets", target.threadId).materializedAt);
    f.t3.projections.get(target.threadId).runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    assert.equal(f.t3.dispatches[0].threadId, target.threadId);
  } finally {
    f.close();
  }
});

test("an unacknowledged failure holds the named thread queue and a missing materialized thread is never recreated", async () => {
  const f = fixture();
  try {
    const target = f.store.transaction(() =>
      taskThreadTarget(f.store, [], "p", { threadKey: "future" }),
    );
    for (const id of ["t1", "t2"]) {
      f.add(id);
      f.store.update("tasks", id, target);
    }
    await f.scheduler.tick();
    f.t3.projections.get(target.threadId).runs[0].status = "failed";
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "failed");
    assert.equal(f.store.get("tasks", "t2").status, "todo");
    assert.equal(f.t3.dispatches.length, 0);
    f.store.update("tasks", "t1", { failureAcknowledged: true });
    f.t3.projections.delete(target.threadId);
    await f.scheduler.refresh();
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    assert.equal(
      f.store.get("tasks", "t2").waitReason,
      "Target thread is missing or archived",
    );
  } finally {
    f.close();
  }
});

test("definitive pre-launch failure can be retried using the reserved thread ID", async () => {
  const f = fixture();
  try {
    const target = f.store.transaction(() =>
      taskThreadTarget(f.store, [], "p", { threadKey: "future" }),
    );
    for (const id of ["t1", "t2"]) {
      f.add(id);
      f.store.update("tasks", id, target);
    }
    const launch = f.t3.launch.bind(f.t3);
    f.t3.launch = async () => {
      throw Error("Failed to launch: invalid base ref");
    };
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "failed");
    assert.equal(f.store.get("tasks", "t2").status, "todo");
    f.t3.launch = launch;
    f.store.update("tasks", "t1", {
      status: "todo",
      failureAcknowledged: true,
    });
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    assert.equal(f.t3.launches[0].threadId, target.threadId);
    assert.equal(f.store.get("tasks", "t2").status, "todo");
  } finally {
    f.close();
  }
});

test("an independent new-thread task can retry a failure before its thread exists", async () => {
  const f = fixture();
  try {
    f.add("t1");
    const launch = f.t3.launch.bind(f.t3);
    f.t3.launch = async () => {
      throw Error("Failed to launch: invalid base ref");
    };
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "failed");
    assert.equal(f.store.get("tasks", "t1").threadId, null);
    f.t3.launch = launch;
    f.store.update("tasks", "t1", {
      status: "todo",
      failureAcknowledged: true,
    });
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "doing");
    assert.equal(f.t3.launches.length, 1);
  } finally {
    f.close();
  }
});

test("priority selects the next ready task without interrupting active work", async () => {
  const f = fixture();
  try {
    f.store.put("settings", { id: "project:p", concurrencyLimit: 1 });
    f.add("t1");
    await f.scheduler.tick();
    for (const [id, priority] of [
      ["t2", "low"],
      ["t3", "high"],
      ["t4", "urgent"],
      ["t5", "none"],
      ["t6", "normal"],
    ]) {
      f.add(id);
      f.store.update("tasks", id, { priority });
    }
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    for (const expected of ["t4", "t3", "t6", "t2", "t5"]) {
      const active = f.store
        .list("attempts")
        .find((a) => a.state === "running");
      f.t3.projections.get(active.threadId).runs.at(-1).status = "completed";
      await f.scheduler.tick();
      assert.equal(
        f.store.list("attempts").find((a) => a.state === "running").taskId,
        expected,
      );
    }
  } finally {
    f.close();
  }
});

test("a blocked urgent task waits without taking a slot, then reuses its blocker's thread at Review", async () => {
  const f = fixture();
  try {
    const target = f.store.transaction(() =>
      taskThreadTarget(f.store, [], "p", { threadKey: "chain" }),
    );
    for (const id of ["t1", "t2", "t3"]) f.add(id);
    f.store.update("tasks", "t1", { ...target, priority: "low" });
    f.store.update("tasks", "t2", {
      ...target,
      priority: "urgent",
      blockedBy: ["t1"],
    });
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 2);
    assert.equal(f.store.get("tasks", "t2").status, "todo");
    assert.match(f.store.get("tasks", "t2").waitReason, /Blocked by/);
    assert.equal(
      f.store.list("attempts").some((a) => a.taskId === "t2"),
      false,
    );
    f.t3.projections.get(target.threadId).runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "review");
    assert.equal(f.store.get("tasks", "t2").status, "doing");
    assert.equal(f.t3.dispatches[0].threadId, target.threadId);
    assert.equal(f.store.get("tasks", "t2").waitReason, null);
  } finally {
    f.close();
  }
});

test("all blockers must reach Review or Done; failed, cancelled, paused and missing blockers keep tasks queued", async () => {
  for (const status of [
    "todo",
    "doing",
    "failed",
    "cancelled",
    "missing",
    "review",
    "done",
  ]) {
    const f = fixture();
    try {
      f.add("t1");
      f.store.update("tasks", "t1", { blockedBy: ["dependency"] });
      if (status !== "missing") {
        f.add("dependency");
        f.store.update("tasks", "dependency", { status, paused: true });
      }
      await f.scheduler.tick();
      assert.equal(
        f.store.get("tasks", "t1").status,
        ["review", "done"].includes(status) ? "doing" : "todo",
        status,
      );
    } finally {
      f.close();
    }
  }
  const f = fixture();
  try {
    f.add("t1");
    f.store.update("tasks", "t1", { blockedBy: ["a", "b"] });
    for (const id of ["a", "b"]) {
      f.add(id);
      f.store.update("tasks", id, {
        status: id === "a" ? "review" : "todo",
        paused: true,
      });
    }
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "todo");
    f.store.update("tasks", "b", { status: "done" });
    await f.scheduler.tick();
    assert.equal(f.store.get("tasks", "t1").status, "doing");
  } finally {
    f.close();
  }
});
