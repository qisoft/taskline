import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../server/index.mjs";

async function fixture(directory) {
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
  runtime.scheduler.projects = [{ id: "p" }, { id: "q" }];
  runtime.scheduler.threads = [
    { id: "existing", projectId: "p" },
    { id: "foreign", projectId: "q" },
    { id: "archived", projectId: "p", archivedAt: "now" },
  ];
  const origin = "http://127.0.0.1:" + runtime.server.address().port;
  const request = async (
    path,
    input,
    method = input === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    return { status: response.status, data: await response.json() };
  };
  return { runtime, request };
}

test("API reserves project-scoped task targets independently of epics, and persists them across a database restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-target-api-"));
  let f = await fixture(directory);
  try {
    const epic = (await f.request("/groups", { name: "Epic", projectId: "p" }))
      .data;
    const inputs = [
      { projectId: "p", groupId: epic.id, threadKey: "same" },
      { projectId: "p", threadKey: " same " },
      { projectId: "q", threadKey: "same" },
      { projectId: "p", groupId: epic.id, threadKey: "different" },
    ];
    const tasks = await Promise.all(
      inputs.map((input) =>
        f.request("/tasks", { ...input, prompt: "Plan only" }),
      ),
    );
    for (const task of tasks) assert.equal(task.status, 201);
    assert.equal(tasks[0].data.threadId, tasks[1].data.threadId);
    assert.notEqual(tasks[0].data.threadId, tasks[2].data.threadId);
    assert.notEqual(tasks[0].data.threadId, tasks[3].data.threadId);
    assert.equal(f.runtime.store.get("groups", epic.id).threadId, undefined);
    assert.equal(f.runtime.store.list("attempts").length, 0);
    assert.equal(f.runtime.store.list("threadTargets").length, 3);
    const id = tasks[0].data.threadId;
    assert.equal(
      (await f.request("/selection", { projectId: "p", threadId: id })).status,
      200,
    );
    assert.equal(
      (await f.request("/selection", { projectId: "q", threadId: id })).status,
      400,
    );
    const byId = await f.request("/tasks", {
      projectId: "p",
      threadId: id,
      prompt: "Use reserved ID",
    });
    assert.equal(byId.data.threadKey, "same");
    f.runtime.close();
    f = await fixture(directory);
    const afterRestart = await f.request("/tasks", {
      projectId: "p",
      threadKey: "same",
      prompt: "After restart",
    });
    assert.equal(afterRestart.data.threadId, id);
    const state = (await f.request("/state")).data;
    assert.equal(
      state.threadTargets.find((t) => t.id === id).materializedAt,
      null,
    );
    assert.equal(state.settings.targetHistory.p.lastThreadId, id);
    const separate = await f.request("/tasks", {
      projectId: "p",
      groupId: epic.id,
      prompt: "Independent new thread",
    });
    assert.equal(separate.data.threadId, null);
    assert.equal(separate.data.threadKey, null);
  } finally {
    f.runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("API validates target choices and only permits retargeting unstarted queued tasks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-target-validation-"));
  const f = await fixture(directory);
  try {
    for (const target of [
      { threadKey: "" },
      { threadKey: "   " },
      { threadKey: "x".repeat(121) },
      { threadKey: {} },
      { threadKey: "conflict", threadId: "existing" },
      { threadId: "foreign" },
      { threadId: "archived" },
      { threadId: "unknown" },
    ])
      assert.equal(
        (
          await f.request("/tasks", {
            ...target,
            projectId: "p",
            prompt: "Invalid",
          })
        ).status,
        400,
      );
    assert.equal(f.runtime.store.list("threadTargets").length, 0);
    assert.equal(f.runtime.store.list("tasks").length, 0);
    const task = (await f.request("/tasks", { projectId: "p", prompt: "Task" }))
      .data;
    const path = "/tasks/" + task.id;
    const keyed = await f.request(path, { threadKey: "lane" }, "PATCH");
    assert.equal(keyed.data.threadKey, "lane");
    const existing = await f.request(path, { threadId: "existing" }, "PATCH");
    assert.equal(existing.data.threadId, "existing");
    assert.equal(existing.data.threadKey, null);
    const separate = await f.request(path, { threadId: null }, "PATCH");
    assert.equal(separate.data.threadId, null);
    assert.equal(separate.data.threadKey, null);
    const bad = await f.request(
      path,
      { prompt: "Should roll back", threadKey: "bad", threadId: "existing" },
      "PATCH",
    );
    assert.equal(bad.status, 400);
    assert.equal(f.runtime.store.get("tasks", task.id).prompt, "Task");
    f.runtime.store.update("tasks", task.id, { currentAttemptId: "previous" });
    assert.equal(
      (await f.request(path, { threadKey: "too-late" }, "PATCH")).status,
      400,
    );
    assert.equal(f.runtime.store.list("threadTargets").length, 1);
  } finally {
    f.runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
