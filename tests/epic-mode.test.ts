import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectService } from "../server/projects.js";
import { Store } from "../server/store.js";
import { seed } from "./helpers.js";
import { fixture } from "./scheduler-fixture.js";

test("epic modes stay independent when project mode changes; ungrouped tasks follow the project", async () => {
  for (const autoStart of [false, true]) {
    const f = fixture();
    f.scheduler.signal = () => {};
    try {
      seed(f.store, "settings", {
        id: "project:p",
        autoStart,
        concurrencyLimit: 16,
      });
      for (const mode of ["active", "paused"])
        seed(f.store, "groups", {
          id: mode,
          projectId: "p",
          mode,
          status: "active",
        });
      for (const [id, groupId] of [
        ["t1", null],
        ["t2", "active"],
        ["t3", "paused"],
      ] as const) {
        f.add(id);
        f.store.update("tasks", id, { groupId });
      }
      await f.scheduler.tick();
      assert.equal(
        f.store.require("tasks", "t1").status,
        autoStart ? "doing" : "todo",
      );
      assert.equal(f.store.require("tasks", "t2").status, "doing");
      assert.equal(f.store.require("tasks", "t3").status, "todo");
      assert.equal(f.store.require("tasks", "t3").waitReason, "Epic is paused");
      const service = new ProjectService(f.store, f.scheduler, () => {});
      service.update("p", { mode: autoStart ? "paused" : "active" });
      f.add("t4");
      await f.scheduler.tick();
      assert.equal(
        f.store.require("tasks", "t4").status,
        autoStart ? "todo" : "doing",
      );
      assert.equal(f.store.require("tasks", "t2").status, "doing");
      assert.equal(f.store.require("tasks", "t3").status, "todo");
      for (const mode of ["active", "paused"])
        assert.equal(f.store.require("groups", mode).mode, mode);
    } finally {
      f.close();
    }
  }
});

test("epic pause lets running work finish; resume respects project limits, blockers, global and task pauses", async () => {
  const f = fixture();
  try {
    seed(f.store, "settings", {
      id: "project:p",
      autoStart: false,
      concurrencyLimit: 1,
    });
    seed(f.store, "groups", {
      id: "g",
      projectId: "p",
      mode: "active",
      status: "active",
    });
    for (const id of ["t1", "t2", "t3"]) {
      f.add(id);
      f.store.update("tasks", id, { groupId: "g" });
    }
    seed(f.store, "settings", { id: "app", paused: true });
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 0);
    f.store.update("settings", "app", { paused: false });
    f.store.update("tasks", "t1", { paused: true });
    f.store.update("tasks", "t2", { blockedBy: ["t1"] });
    f.store.update("tasks", "t3", { blockedBy: ["t2"] });
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 0);
    assert.match(f.store.require("tasks", "t2").waitReason!, /Blocked by/);
    f.store.update("tasks", "t1", { paused: false });
    await f.scheduler.tick();
    assert.equal(f.t3.launches.length, 1);
    f.store.update("groups", "g", { mode: "paused" });
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t1").status, "doing");
    const attempt = f.store.require(
      "attempts",
      f.store.require("tasks", "t1").currentAttemptId,
    );
    f.t3.projection(attempt.threadId).runs[0].status = "completed";
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t1").status, "review");
    assert.equal(f.store.require("tasks", "t2").waitReason, "Epic is paused");
    f.store.update("groups", "g", { mode: "active" });
    f.store.update("tasks", "t3", { blockedBy: [] });
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t2").status, "doing");
    assert.equal(f.store.require("tasks", "t2").waitReason, null);
    assert.equal(f.store.require("tasks", "t3").status, "todo");
    assert.equal(f.t3.launches.length, 2);
  } finally {
    f.close();
  }
});

test("legacy epic modes are snapshotted once and remain independent after SQLite reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-epic-migration-"));
  let store = new Store(directory);
  try {
    seed(store, "settings", { id: "project:p", autoStart: false });
    seed(store, "settings", { id: "project:q", autoStart: true });
    seed(store, "groups", { id: "paused", projectId: "p", contextVersion: 7 });
    seed(store, "groups", { id: "active", projectId: "q" });
    seed(store, "groups", { id: "explicit", projectId: "p", mode: "active" });
    seed(store, "groups", { id: "inferred" });
    seed(store, "tasks", { id: "t", projectId: "p", groupId: "inferred" });
    store.close();
    store = new Store(directory);
    assert.equal(store.require("groups", "paused").mode, "paused");
    assert.equal(store.require("groups", "active").mode, "active");
    assert.equal(store.require("groups", "explicit").mode, "active");
    assert.equal(store.require("groups", "inferred").mode, "paused");
    assert.equal(store.require("groups", "paused").contextVersion, 7);
    store.update("settings", "project:p", { autoStart: true });
    store.update("settings", "project:q", { autoStart: false });
    store.close();
    store = new Store(directory);
    assert.equal(store.require("groups", "paused").mode, "paused");
    assert.equal(store.require("groups", "active").mode, "active");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("project hard stop commits all pauses before requesting cancellations and keeps the queue intact", async () => {
  const f = fixture();
  f.scheduler.signal = () => {};
  try {
    seed(f.store, "groups", {
      id: "g",
      projectId: "p",
      mode: "active",
      status: "active",
    });
    seed(f.store, "groups", {
      id: "other",
      projectId: "q",
      mode: "active",
      status: "active",
    });
    for (const id of ["t1", "t2", "t3"]) {
      f.add(id);
      f.store.update("tasks", id, { groupId: id === "t2" ? null : "g" });
    }
    await f.scheduler.tick();
    seed(f.store, "tasks", { id: "other", projectId: "q", status: "doing" });
    const stopped: string[] = [];
    let fail = true;
    f.t3.dispatch = async (command) => {
      assert.equal(command.type, "thread.stop");
      if (command.type !== "thread.stop") throw Error("Unexpected command");
      assert.equal(f.store.settings("project:p").autoStart, false);
      assert.equal(f.store.require("groups", "g").mode, "paused");
      if (fail && stopped.length) throw Error("T3 disconnected");
      stopped.push(command.threadId);
      f.t3.projection(command.threadId).runs[0].status = "cancelled";
    };
    const service = new ProjectService(f.store, f.scheduler, () => {});
    await assert.rejects(
      service.stop("p"),
      /paused.*could not be stopped.*T3 disconnected/,
    );
    assert.equal(stopped.length, 1);
    assert.equal(f.store.require("tasks", "t1").status, "doing");
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t1").status, "cancelled");
    assert.equal(f.store.require("tasks", "t2").status, "doing");
    assert.equal(f.store.require("tasks", "t3").status, "todo");
    fail = false;
    const result = await service.stop("p");
    assert.deepEqual(result.stopRequestedTaskIds, ["t2"]);
    assert.equal(result.pausedEpics, 1);
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t2").status, "cancelled");
    assert.equal(f.store.require("tasks", "t3").status, "todo");
    assert.equal(f.t3.launches.length, 2);
    assert.equal(f.store.require("groups", "other").mode, "active");
    assert.equal(f.store.require("tasks", "other").status, "doing");
    service.update("p", { mode: "active" });
    await f.scheduler.tick();
    assert.equal(f.store.require("tasks", "t3").status, "todo");
    assert.equal(f.store.require("groups", "g").mode, "paused");
    await assert.rejects(service.stop("missing"), /Project not found/);
  } finally {
    f.close();
  }
});
