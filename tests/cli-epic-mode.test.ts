import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startServer } from "../server/index.js";
import { run } from "./cli-helpers.js";
import { seed, tcpPort } from "./helpers.js";

test("CLI creates independent paused/active epics, changes their modes and hard stops a scoped project", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-cli-epic-mode-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
  runtime.scheduler.projects = [
    { id: "p", title: "Planning", workspaceRoot: directory },
    { id: "q", title: "Other", workspaceRoot: "/q" },
  ];
  const origin = "http://127.0.0.1:" + tcpPort(runtime.server);
  const ok = async (args: string[]) => {
    const result = await run(args, origin);
    assert.equal(result.code, 0, result.err);
    return result.data;
  };
  const add = (name: string, ...args: string[]) =>
    ok(["epic", "add", "--project", "p", "--name", name, ...args]);
  try {
    await ok(["project", "pause", "p"]);
    const paused = await add("Default paused");
    assert.equal(paused.mode, "paused");
    const active = await add("Explicit active", "--active");
    assert.equal(active.mode, "active");
    await ok(["project", "activate", "p"]);
    assert.equal((await ok(["epic", "show", paused.id])).mode, "paused");
    const defaultActive = await add("Default active");
    assert.equal(defaultActive.mode, "active");
    const explicitPaused = await add("Explicit paused", "--paused");
    assert.equal(explicitPaused.mode, "paused");
    await ok(["project", "pause", "p"]);
    assert.equal((await ok(["epic", "show", defaultActive.id])).mode, "active");
    for (const [action, args, mode] of [
      ["activate", [], "active"],
      ["pause", [], "paused"],
      ["resume", [], "active"],
      ["update", ["--mode", "paused"], "paused"],
      ["update", ["--active"], "active"],
      ["update", ["--paused"], "paused"],
    ] as const) {
      const result = await ok(["epic", action, paused.id, ...args]);
      assert.equal(result.mode, mode);
      assert.equal(result.contextVersion, 1);
      assert.equal(result.status, "active");
    }
    assert.equal(runtime.store.list("jobs").length, 0);
    for (const args of [
      ["--mode", "invalid"],
      ["--active", "--paused"],
    ]) {
      const invalid = await run(["epic", "update", paused.id, ...args], origin);
      assert.equal(invalid.code, 1);
      assert.equal(runtime.store.require("groups", paused.id).mode, "paused");
      assert.equal(
        (
          await run(
            ["epic", "add", "--project", "p", "--name", "Invalid", ...args],
            origin,
          )
        ).code,
        1,
      );
    }
    const all = await ok(["epic", "list", "--project", "p"]);
    assert.equal(
      all.find((g: { id: string }) => g.id === active.id).mode,
      "active",
    );
    const plain = await run(
      ["epic", "list", "--project", "p"],
      origin,
      "",
      process.cwd(),
      false,
    );
    assert.equal(plain.code, 0, plain.err);
    assert.match(plain.out, /paused\tDefault paused/);
    assert.match(plain.out, /active\tExplicit active/);
    const closed = await add("Closed", "--active");
    await ok(["epic", "close", closed.id]);
    const closedList = await run(
      ["epic", "list", "--project", "p"],
      origin,
      "",
      process.cwd(),
      false,
    );
    assert.match(closedList.out, /done\tClosed/);
    await ok([
      "epic",
      "add",
      "--project",
      "q",
      "--name",
      "Other epic",
      "--active",
    ]);
    const task = await ok([
      "task",
      "add",
      "--project",
      "p",
      "--epic",
      active.id,
      "--prompt",
      "Queue preserved",
    ]);
    seed(runtime.store, "attempts", {
      id: "attempt",
      taskId: task.id,
      projectId: "p",
      threadId: "live-thread",
      state: "running",
    });
    runtime.store.update("tasks", task.id, {
      status: "doing",
      currentAttemptId: "attempt",
    });
    const queued = await ok([
      "task",
      "add",
      "--project",
      "p",
      "--prompt",
      "Ungrouped queued",
    ]);
    let stopRequested = false;
    runtime.scheduler.t3.dispatch = async (command) => {
      assert.equal(command.type, "thread.stop");
      if (command.type !== "thread.stop") throw Error("Unexpected command");
      assert.equal(command.threadId, "live-thread");
      assert.equal(runtime.store.settings("project:p").autoStart, false);
      assert.ok(
        runtime.store
          .list("groups")
          .filter((g) => g.projectId === "p")
          .every((g) => g.mode === "paused"),
      );
      stopRequested = true;
    };
    const stopped = await ok(["project", "stop", "Planning"]);
    assert.equal(stopped.mode, "paused");
    assert.equal(stopped.pausedEpics, 5);
    assert.deepEqual(stopped.stopRequestedTaskIds, [task.id]);
    assert.equal(stopRequested, true);
    assert.equal(runtime.store.require("tasks", queued.id).status, "todo");
    assert.equal(
      (await ok(["epic", "list", "--project", "q"]))[0].mode,
      "active",
    );
    await ok(["project", "activate", "p"]);
    assert.ok(
      (await ok(["epic", "list", "--project", "p"])).every(
        (g: { mode: string }) => g.mode === "paused",
      ),
    );
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
