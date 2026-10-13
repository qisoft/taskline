import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Store } from "../server/store.mjs";
import { Scheduler } from "../server/scheduler.mjs";
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
