import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startServer } from "../server/index.js";
import { Store } from "../server/store.js";
import { seed, tcpPort } from "./helpers.js";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "taskline-planning-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
  runtime.scheduler.projects = [
    { id: "p", title: "p", workspaceRoot: "/fixture/p" },
    { id: "q", title: "q", workspaceRoot: "/fixture/q" },
  ];
  const origin = "http://127.0.0.1:" + tcpPort(runtime.server);
  const request = async (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const add = async (input = {}) =>
    (
      await request("/tasks", {
        projectId: "p",
        prompt: "Planning fixture",
        ...input,
      })
    ).data;
  return {
    directory,
    runtime,
    request,
    add,
    close() {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("API persists priorities and cross-project blockers, derives current blocking state, and guards graph integrity", async () => {
  const f = await fixture();
  try {
    const a = await f.add(),
      b = await f.add({ priority: "urgent", blockedBy: [a.id, a.id] }),
      c = await f.add({ projectId: "q", blockedBy: [b.id] });
    assert.equal(a.priority, "normal");
    assert.deepEqual(a.blockedBy, []);
    assert.deepEqual(b.blockedBy, [a.id]);
    assert.deepEqual(b.blockingTaskIds, [a.id]);
    const patch = (id: string, body: unknown) =>
      f.request("/tasks/" + id, body, "PATCH");
    for (const ids of [[a.id], [b.id], [c.id]]) {
      const bad = await patch(a.id, { blockedBy: ids });
      assert.equal(bad.status, 400);
      assert.match(bad.data.error, /itself|cycle/);
    }
    for (const input of [
      { priority: "critical" },
      { priority: null },
      { blockedBy: null },
      { blockedBy: "x" },
      { blockedBy: [{}] },
      { blockedBy: ["unknown"] },
    ] as const)
      assert.equal((await patch(a.id, input)).status, 400);
    assert.equal((await f.request("/tasks/" + a.id, {}, "DELETE")).status, 400);
    const failed = await patch(b.id, {
      priority: "low",
      blockedBy: [c.id],
      threadKey: "must-not-reserve",
    });
    assert.equal(failed.status, 400);
    assert.equal(f.runtime.store.require("tasks", b.id).priority, "urgent");
    assert.equal(f.runtime.store.list("threadTargets").length, 0);
    f.runtime.store.update("tasks", a.id, {
      status: "review",
      currentAttemptId: "fixture",
    });
    assert.deepEqual(
      (await f.request("/tasks/" + b.id)).data.task.blockingTaskIds,
      [],
    );
    await f.request("/tasks/" + a.id + "/retry", {});
    assert.deepEqual(
      (await f.request("/tasks/" + b.id)).data.task.blockingTaskIds,
      [a.id],
    );
    await f.request("/tasks/" + b.id + "/block", { blockerIds: [a.id] });
    assert.deepEqual(f.runtime.store.require("tasks", b.id).blockedBy, [a.id]);
    await f.request("/tasks/" + b.id + "/unblock", { blockerIds: [a.id] });
    assert.deepEqual(
      (await f.request("/tasks/" + b.id)).data.task.blockedBy,
      [],
    );
    assert.equal((await f.request("/tasks/" + a.id, {}, "DELETE")).status, 200);
    f.runtime.store.update("tasks", b.id, { status: "doing" });
    assert.equal((await patch(b.id, { blockedBy: [] })).status, 400);
    assert.equal((await patch(b.id, { priority: "high" })).status, 200);
    assert.equal(f.runtime.store.require("tasks", b.id).status, "doing");
    assert.equal(f.runtime.store.list("attempts").length, 0);
  } finally {
    f.close();
  }
});

test("SQLite reopen preserves planning metadata and legacy tasks get safe API defaults", async () => {
  const f = await fixture();
  try {
    const a = await f.add({ priority: "low" }),
      b = await f.add({ priority: "high", blockedBy: [a.id] });
    seed(f.runtime.store, "tasks", {
      id: "legacy",
      projectId: "p",
      prompt: "Legacy",
      status: "todo",
      createdAt: new Date().toISOString(),
    });
    const state = (await f.request("/state")).data;
    assert.equal(
      state.tasks.find(
        (t: import("../shared/types.js").Task) => t.id === "legacy",
      ).priority,
      "normal",
    );
    assert.deepEqual(
      state.tasks.find(
        (t: import("../shared/types.js").Task) => t.id === "legacy",
      ).blockingTaskIds,
      [],
    );
    const reopened = new Store(f.directory);
    assert.equal(reopened.require("tasks", b.id).priority, "high");
    assert.deepEqual(reopened.require("tasks", b.id).blockedBy, [a.id]);
    reopened.close();
  } finally {
    f.close();
  }
});
