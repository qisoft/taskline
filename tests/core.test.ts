import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../server/store.js";
import { seed } from "./helpers.js";
import { fixture } from "./scheduler-fixture.js";
test("SQLite persists task and original attachment bytes across reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "taskline-store-"));
  let store = new Store(dir);
  const image = store.saveImage(
    Buffer.from("attachment bytes").toString("base64"),
  );
  seed(store, "tasks", {
    id: "saved",
    prompt: "Original",
    attachments: [image],
  });
  store.close();
  store = new Store(dir);
  assert.equal(store.require("tasks", "saved").prompt, "Original");
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
    assert.equal(f.store.require("tasks", "t3").status, "todo");
    const running = f.store.list("attempts");
    assert.notEqual(running[0].workspace, running[1].workspace);
    f.t3.projection(running[0].threadId).runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t1").status, "review");
    assert.equal(f.store.require("tasks", "t3").status, "doing");
  } finally {
    f.close();
  }
});
test("tasks in the same existing thread are admitted sequentially", async () => {
  const f = fixture();
  try {
    f.t3.projections.set("same", {
      thread: {
        id: "same",
        projectId: "p",
        title: "Same",
        worktreePath: "/same",
      },
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
    f.t3.projection("same").runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.t3.dispatches.length, 2);
    assert.equal(f.store.require("tasks", "t1").status, "review");
    assert.equal(f.store.require("tasks", "t2").status, "doing");
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
    const p = f.t3.projection(a.threadId);
    p.runs[0].status = "completed";
    p.subagents = [{ runId: p.runs[0].id, status: "running" }];
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t1").status, "doing");
    assert.equal(f.store.list("attempts")[0].state, "waiting");
    p.subagents[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t1").status, "review");
  } finally {
    f.close();
  }
});
test("compiled prompt snapshots epic context while preserving task prompt", async () => {
  const f = fixture();
  try {
    seed(f.store, "groups", {
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
    assert.equal(f.store.require("tasks", t.id).prompt, "Work");
  } finally {
    f.close();
  }
});
