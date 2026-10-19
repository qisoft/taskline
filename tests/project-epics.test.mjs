import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { startServer } from "../server/index.js";

test("legacy epics inherit only an unambiguous project", () => {
  const dir = mkdtempSync(join(tmpdir(), "taskline-epics-"));
  let store = new Store(dir);
  try {
    for (const id of ["single", "mixed", "empty"])
      store.put("groups", { id, contextVersion: 3 });
    for (const [id, groupId, projectId] of [
      ["a", "single", "p"],
      ["b", "mixed", "p"],
      ["c", "mixed", "q"],
    ])
      store.put("tasks", { id, groupId, projectId });
    store.close();
    store = new Store(dir);
    assert.equal(store.get("groups", "single").projectId, "p");
    assert.equal(store.get("groups", "single").contextVersion, 3);
    assert.ok(!store.get("groups", "mixed").projectId);
    assert.ok(!store.get("groups", "empty").projectId);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("API enforces project ownership on epic creation and task assignment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "taskline-epic-api-"));
  const runtime = await startServer({ port: 0, dataDir: dir });
  runtime.scheduler.stop();
  runtime.scheduler.projects = [{ id: "p" }, { id: "q" }];
  const origin = "http://127.0.0.1:" + runtime.server.address().port;
  const request = async (path, body, method = "POST") => {
    const res = await fetch(origin + "/api" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  try {
    assert.equal(
      (await request("/groups", { name: "Missing project" })).status,
      400,
    );
    const group = await request("/groups", { name: "Epic", projectId: "p" });
    assert.equal(group.status, 201);
    assert.equal(group.data.projectId, "p");
    assert.equal(
      (
        await request("/tasks", {
          prompt: "Wrong project",
          projectId: "q",
          groupId: group.data.id,
        })
      ).status,
      400,
    );
    const task = await request("/tasks", { prompt: "Task", projectId: "q" });
    assert.equal(task.status, 201);
    assert.equal(
      (
        await request(
          "/tasks/" + task.data.id,
          { groupId: group.data.id },
          "PATCH",
        )
      ).status,
      400,
    );
    const owned = await request("/tasks", {
      prompt: "Owned",
      projectId: "p",
      groupId: group.data.id,
    });
    assert.equal(owned.status, 201);
    assert.equal(
      (await request("/groups/" + group.data.id, { projectId: "q" }, "PATCH"))
        .status,
      400,
    );
  } finally {
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
