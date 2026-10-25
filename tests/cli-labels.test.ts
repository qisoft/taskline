import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startServer } from "../server/index.js";
import { run } from "./cli-helpers.js";
import { tcpPort } from "./helpers.js";

test("CLI manages and filters independent task and epic labels", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-cli-labels-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
  runtime.scheduler.projects = [
    { id: "p", title: "Project", workspaceRoot: directory },
    { id: "q", title: "Other", workspaceRoot: "/q" },
  ];
  const origin = "http://127.0.0.1:" + tcpPort(runtime.server);
  const ok = async (...args: string[]) => {
    const result = await run(args, origin);
    assert.equal(result.code, 0, result.err);
    return result.data;
  };
  try {
    const epic = await ok(
      "epic",
      "add",
      "--project",
      "p",
      "--name",
      "Release",
      "--label",
      " Roadmap ",
      "--label",
      "roadmap",
    );
    assert.deepEqual(epic.labels, ["Roadmap"]);
    const task = await ok(
      "task",
      "add",
      "--project",
      "p",
      "--epic",
      epic.id,
      "--prompt",
      "Task",
      "--label",
      "Bug",
      "--label",
      "API",
    );
    assert.deepEqual(task.labels, ["Bug", "API"]);
    assert.deepEqual(
      await ok("task", "list", "--project", "p", "--label", "roadmap"),
      [],
    );
    assert.deepEqual(
      await ok("epic", "list", "--project", "p", "--label", "bug"),
      [],
    );
    const code = "TL-" + task.id.slice(0, 4);
    assert.deepEqual(
      (
        await ok(
          "task",
          "update",
          code,
          "--add-label",
          "UI",
          "--add-label",
          "bug",
          "--remove-label",
          "api",
        )
      ).labels,
      ["Bug", "UI"],
    );
    assert.deepEqual(
      (
        await ok(
          "epic",
          "update",
          epic.id,
          "--add-label",
          "Review",
          "--remove-label",
          "ROADMAP",
        )
      ).labels,
      ["Review"],
    );
    assert.deepEqual((await ok("task", "show", code)).task.labels, [
      "Bug",
      "UI",
    ]);
    assert.deepEqual((await ok("epic", "show", epic.id)).labels, ["Review"]);
    await ok(
      "task",
      "add",
      "--project",
      "p",
      "--prompt",
      "Only Bug",
      "--label",
      "Bug",
    );
    await ok(
      "task",
      "add",
      "--project",
      "q",
      "--prompt",
      "Other Project",
      "--label",
      "Bug",
      "--label",
      "UI",
    );
    const matching = await ok(
      "task",
      "list",
      "--project",
      "p",
      "--label",
      "bug",
      "--label",
      "ui",
    );
    assert.deepEqual(
      matching.map((row: { id: string }) => row.id),
      [task.id],
    );
    assert.equal(
      (await ok("task", "list", "--all", "--label", "bug", "--label", "ui"))
        .length,
      2,
    );
    assert.deepEqual(
      (await ok("epic", "list", "--project", "p", "--label", "REVIEW")).map(
        (row: { id: string }) => row.id,
      ),
      [epic.id],
    );
    assert.deepEqual(
      await ok(
        "epic",
        "list",
        "--project",
        "p",
        "--label",
        "Review",
        "--label",
        "Other",
      ),
      [],
    );
    const plain = await run(
      ["task", "list", "--project", "p", "--label", "UI"],
      origin,
      "",
      process.cwd(),
      false,
    );
    assert.equal(plain.code, 0, plain.err);
    assert.match(plain.out, /labels: Bug, UI/);
    const plainEpics = await run(
      ["epic", "list", "--project", "p"],
      origin,
      "",
      process.cwd(),
      false,
    );
    assert.match(plainEpics.out, /labels: Review/);
    for (const [kind, id] of [
      ["task", task.id],
      ["epic", epic.id],
    ]) {
      assert.deepEqual(
        (await ok(kind, "update", id, "--label", "Replacement")).labels,
        ["Replacement"],
      );
      for (const flags of [
        ["--label", "Bad", "--clear-labels"],
        ["--add-label", "Bad", "--clear-labels"],
        ["--label", "Bad", "--remove-label", "Bad"],
        ["--label", ""],
      ]) {
        const result = await run([kind, "update", id, ...flags], origin);
        assert.equal(result.code, 1);
        assert.deepEqual(
          runtime.store.require(kind === "task" ? "tasks" : "groups", id)
            .labels,
          ["Replacement"],
        );
      }
      assert.deepEqual(
        (await ok(kind, "update", id, "--clear-labels")).labels,
        [],
      );
    }
    assert.equal(runtime.store.list("attempts").length, 0);
    assert.equal(runtime.store.require("groups", epic.id).contextVersion, 1);
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
