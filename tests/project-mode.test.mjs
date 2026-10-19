import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Store } from "../server/store.js";
import { Scheduler } from "../server/scheduler.js";
import { ProjectService } from "../server/projects.js";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "taskline-mode-"));
  const store = new Store(directory);
  const t3 = new EventEmitter();
  t3.config = { token: "fixture" };
  t3.close = () => {};
  const scheduler = new Scheduler(store, t3, () => {});
  scheduler.projects = [
    { id: "p", workspaceRoot: "/p" },
    { id: "q", workspaceRoot: "/q" },
  ];
  scheduler.connected = true;
  scheduler.lastRefresh = Date.now();
  return {
    directory,
    store,
    t3,
    scheduler,
    service: new ProjectService(store, scheduler, () => {}),
    close() {
      scheduler.stop();
      scheduler.store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("Paused blocks new project starts while reconciling running tasks and leaving other projects active", async () => {
  const f = fixture();
  try {
    const started = [],
      reconciled = [];
    f.scheduler.admit = async (t) => {
      started.push(t.id);
      f.store.update("tasks", t.id, { status: "doing" });
    };
    f.scheduler.reconcile = async (a) => {
      reconciled.push(a.id);
    };
    f.store.put("attempts", {
      id: "running",
      projectId: "p",
      state: "running",
    });
    for (const [id, projectId] of [
      ["p-new", "p"],
      ["q-new", "q"],
    ])
      f.store.put("tasks", {
        id,
        projectId,
        status: "todo",
        createdAt: new Date().toISOString(),
        rank: 1,
      });
    f.service.update("p", { mode: "paused" });
    await f.scheduler.tick();
    assert.deepEqual(started, ["q-new"]);
    assert.deepEqual(reconciled, ["running"]);
    assert.equal(f.store.get("tasks", "p-new").waitReason, "Project is paused");
    f.service.update("p", { mode: "active" });
    await f.scheduler.tick();
    assert.deepEqual(started, ["q-new", "p-new"]);
    assert.equal(f.store.get("tasks", "p-new").waitReason, null);
    assert.equal(f.store.get("attempts", "running").state, "running");
    f.service.update("p", { mode: "paused" });
    f.store.close();
    f.store = new Store(f.directory);
    assert.equal(f.store.settings("project:p").autoStart, false);
    f.scheduler.store = f.store;
  } finally {
    f.close();
  }
});
test("project creation persists Paused before publishing to T3 and preserves it on unknown outcomes", async () => {
  const f = fixture();
  try {
    let command;
    f.t3.call = async (tag, input) => {
      assert.equal(tag, "projects.mutate");
      assert.equal(
        f.store.settings("project:" + input.projectId).autoStart,
        false,
      );
      command = input;
      return {
        id: input.projectId,
        title: input.title,
        workspaceRoot: input.workspaceRoot,
      };
    };
    const workspace = join(f.directory, "workspace");
    mkdirSync(join(workspace, ".git"), { recursive: true });
    writeFileSync(join(workspace, ".git", "HEAD"), "ref: refs/heads/trunk\n");
    f.t3.config.origin = "http://127.0.0.1:3773";
    const project = await f.service.create({
      title: "Plan",
      workspaceRoot: workspace,
      projectId: "new",
      commandId: "create",
    });
    assert.equal(project.mode, "paused");
    assert.equal(project.policy.baseRef, "trunk");
    assert.equal(command.type, "project.create");
    f.t3.call = async () => {
      throw Error("T3 disconnected");
    };
    await assert.rejects(
      f.service.create({
        title: "Unknown",
        workspaceRoot: "/unknown",
        projectId: "unknown",
        commandId: "stable",
      }),
      /stable/,
    );
    assert.equal(f.store.settings("project:unknown").autoStart, false);
    assert.throws(() => f.service.update("new", { mode: "bad" }), /mode/);
    assert.throws(
      () => f.service.update("new", { mode: "paused", autoStart: true }),
      /Conflicting/,
    );
    assert.throws(
      () => f.service.update("missing", { mode: "active" }),
      /not found/,
    );
  } finally {
    f.close();
  }
});
