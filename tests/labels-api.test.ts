import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startServer } from "../server/index.js";
import { Store } from "../server/store.js";
import { seed, taskFixture, tcpPort } from "./helpers.js";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "taskline-labels-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
  runtime.scheduler.projects = [
    { id: "p", title: "P", workspaceRoot: directory },
  ];
  const origin = "http://127.0.0.1:" + tcpPort(runtime.server);
  const request = async (
    path: string,
    input?: unknown,
    method = input === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(origin + "/api" + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, data: await response.json() };
  };
  return {
    directory,
    runtime,
    origin,
    request,
    close() {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("API persists independent task/epic labels, permits edits during execution and preserves attempt evidence", async () => {
  const f = await fixture();
  try {
    const group = (
      await f.request("/groups", {
        projectId: "p",
        name: "Epic",
        mode: "paused",
        labels: [" Epic ", "epic"],
      })
    ).data;
    assert.deepEqual(group.labels, ["Epic"]);
    const task = (
      await f.request("/tasks", {
        projectId: "p",
        groupId: group.id,
        prompt: "Task",
      })
    ).data;
    assert.deepEqual(task.labels, []);
    const patchTask = (input: unknown) =>
      f.request("/tasks/" + task.id, input, "PATCH");
    assert.deepEqual(
      (await patchTask({ labels: [" Bug ", "API", "bug"] })).data.labels,
      ["Bug", "API"],
    );
    assert.deepEqual(
      (await patchTask({ addLabels: ["Review"], removeLabels: ["api"] })).data
        .labels,
      ["Bug", "Review"],
    );
    seed(f.runtime.store, "attempts", {
      id: "attempt",
      taskId: task.id,
      state: "running",
      compiledPrompt: "Original frozen prompt",
      contextVersion: 1,
    });
    f.runtime.store.update("tasks", task.id, {
      status: "doing",
      currentAttemptId: "attempt",
    });
    const attemptBefore = f.runtime.store.require("attempts", "attempt");
    assert.equal(
      (await patchTask({ addLabels: ["External"] })).data.status,
      "doing",
    );
    const updatedGroup = await f.request(
      "/groups/" + group.id,
      { addLabels: ["Release"] },
      "PATCH",
    );
    assert.deepEqual(updatedGroup.data.labels, ["Epic", "Release"]);
    assert.equal(updatedGroup.data.contextVersion, 1);
    assert.equal(updatedGroup.data.mode, "paused");
    assert.equal(updatedGroup.data.summaryState, "idle");
    assert.equal(
      "addLabels" in f.runtime.store.require("groups", group.id),
      false,
    );
    assert.deepEqual(
      f.runtime.store.require("attempts", "attempt"),
      attemptBefore,
    );
    assert.deepEqual(f.runtime.store.require("tasks", task.id).labels, [
      "Bug",
      "Review",
      "External",
    ]);
    await patchTask({ labels: [] });
    assert.deepEqual(
      (await f.request("/tasks/" + task.id)).data.task.labels,
      [],
    );
    f.runtime.store.put("tasks", taskFixture({ id: "legacy", projectId: "p" }));
    seed(f.runtime.store, "groups", {
      id: "legacy-epic",
      projectId: "p",
      name: "Legacy",
    });
    const state = (await f.request("/state")).data;
    assert.deepEqual(
      state.tasks.find((t: { id: string }) => t.id === "legacy").labels,
      [],
    );
    assert.deepEqual(
      state.groups.find((g: { id: string }) => g.id === "legacy-epic").labels,
      [],
    );
    const snapshot = new Store(f.directory);
    assert.deepEqual(snapshot.require("groups", group.id).labels, [
      "Epic",
      "Release",
    ]);
    snapshot.close();
  } finally {
    f.close();
  }
});

test("invalid API labels reject the complete update and do not reserve thread targets", async () => {
  const f = await fixture();
  try {
    const group = (
      await f.request("/groups", {
        projectId: "p",
        name: "Original",
        labels: ["Keep"],
      })
    ).data;
    const task = (
      await f.request("/tasks", {
        projectId: "p",
        prompt: "Original",
        labels: ["Keep"],
      })
    ).data;
    for (const labels of [
      null,
      "bug",
      [true],
      [""],
      ["x".repeat(65)],
      Array.from({ length: 21 }, (_, i) => "label-" + i),
    ]) {
      assert.equal(
        (
          await f.request("/groups", {
            projectId: "p",
            name: "Invalid",
            labels,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.request("/tasks", {
            projectId: "p",
            prompt: "Invalid",
            labels,
            threadKey: "not-reserved",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.request(
            "/groups/" + group.id,
            { name: "Rejected", labels },
            "PATCH",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await f.request(
            "/tasks/" + task.id,
            { title: "Rejected", labels, threadKey: "not-reserved" },
            "PATCH",
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await f.request(
          "/tasks/" + task.id,
          { labels: [], addLabels: ["No"] },
          "PATCH",
        )
      ).status,
      400,
    );
    assert.equal(f.runtime.store.require("groups", group.id).name, "Original");
    assert.deepEqual(f.runtime.store.require("groups", group.id).labels, [
      "Keep",
    ]);
    assert.equal(f.runtime.store.require("tasks", task.id).title, "Original");
    assert.deepEqual(f.runtime.store.require("tasks", task.id).labels, [
      "Keep",
    ]);
    assert.equal(f.runtime.store.list("threadTargets").length, 0);
    assert.equal(f.runtime.store.list("tasks").length, 1);
    assert.equal(f.runtime.store.list("groups").length, 1);
  } finally {
    f.close();
  }
});

test("incremental label updates use the latest saved labels after a request body finishes", async () => {
  const f = await fixture();
  try {
    const group = (await f.request("/groups", { projectId: "p", name: "Epic" }))
      .data;
    const task = (await f.request("/tasks", { projectId: "p", prompt: "Task" }))
      .data;
    for (const path of ["/tasks/" + task.id, "/groups/" + group.id]) {
      let arrived!: () => void;
      const accepted = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      f.runtime.server.once("request", arrived);
      let finish!: () => void;
      const delayed = new Promise<void>((resolve, reject) => {
        const request = httpRequest(
          f.origin + "/api" + path,
          { method: "PATCH", headers: { "content-type": "application/json" } },
          (response) => {
            response.resume();
            response.on("end", () => {
              assert.equal(response.statusCode, 200);
              resolve();
            });
          },
        );
        request.on("error", reject);
        request.write('{"addLabels":[');
        finish = () => request.end('"first"]}');
      });
      await accepted;
      assert.equal(
        (await f.request(path, { addLabels: ["second"] }, "PATCH")).status,
        200,
      );
      finish();
      await delayed;
      const saved = path.startsWith("/tasks/")
        ? f.runtime.store.require("tasks", task.id)
        : f.runtime.store.require("groups", group.id);
      assert.deepEqual(saved.labels, ["second", "first"]);
    }
  } finally {
    f.close();
  }
});
