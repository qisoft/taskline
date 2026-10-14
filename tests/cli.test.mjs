import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../server/index.mjs";
const cli = resolve("cli/taskline.mjs");
function run(args, origin, input = "", cwd = process.cwd()) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args, "--json"], {
      cwd,
      env: { ...process.env, TASKLINE_URL: origin },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.stdin.end(input);
    child.on("close", (code) =>
      resolve({ code, out, err, data: code === 0 ? JSON.parse(out) : null }),
    );
  });
}
test("CLI manages paused planning projects, epics, stdin tasks, updates and statuses through the real local API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-cli-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  const origin = "http://127.0.0.1:" + runtime.server.address().port;
  runtime.scheduler.t3.call = async (tag, input) => {
    assert.equal(tag, "projects.mutate");
    return {
      id: input.projectId,
      title: input.title,
      workspaceRoot: input.workspaceRoot,
    };
  };
  const ok = async (args, input = "") => {
    const result = await run(args, origin, input);
    assert.equal(result.code, 0, result.err);
    return result.data;
  };
  try {
    const p = await ok([
      "project",
      "create",
      "--name",
      "Planning",
      "--path",
      directory,
    ]);
    assert.equal(p.mode, "paused");
    assert.equal(runtime.store.settings("project:" + p.id).autoStart, false);
    const epic = await ok([
      "epic",
      "add",
      "--project",
      p.id,
      "--name",
      "Big feature",
      "--context",
      "Shared requirements",
    ]);
    assert.equal(epic.projectId, p.id);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=",
      "base64",
    );
    const image = join(directory, "input with spaces.png");
    writeFileSync(image, png);
    const task = await ok(
      [
        "task",
        "add",
        "--project",
        "Planning",
        "--epic",
        epic.id,
        "--prompt-file",
        "-",
        "--image",
        image,
      ],
      "First task\nDetailed prompt from stdin",
    );
    assert.equal(task.status, "todo");
    assert.equal(task.attachments.length, 1);
    assert.ok(runtime.store.image(task.attachments[0].id).equals(png));
    assert.equal(task.groupId, epic.id);
    assert.equal(task.prompt, "First task\nDetailed prompt from stdin");
    const rows = await ok([
      "task",
      "list",
      "--project",
      p.id,
      "--status",
      "todo",
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, task.id);
    await ok([
      "task",
      "update",
      task.id,
      "--title",
      "Renamed",
      "--prompt",
      "Changed queued prompt",
    ]);
    assert.equal(
      (await ok(["task", "show", "TL-" + task.id.slice(0, 4)])).task
        .originalPrompt,
      "Changed queued prompt",
    );
    await ok(["task", "pause", task.id]);
    assert.equal((await ok(["task", "show", task.id])).task.paused, true);
    await ok(["task", "resume", task.id]);
    await ok(["project", "activate", p.id]);
    assert.equal((await ok(["project", "show", p.id])).mode, "active");
    await ok(["project", "pause", p.id]);
    assert.equal((await ok(["project", "show", p.id])).mode, "paused");
    assert.deepEqual((await ok(["task", "show", task.id])).attempts, []);
    await ok(["epic", "update", epic.id, "--context", "Revised context"]);
    assert.equal((await ok(["epic", "show", epic.id])).contextVersion, 2);
    const wrong = await run(
      ["project", "set", p.id, "--mode", "invalid"],
      origin,
    );
    assert.equal(wrong.code, 1);
    assert.match(wrong.err, /mode/);
    const flag = await run(["task", "list", "--unknown"], origin);
    assert.equal(flag.code, 1);
    await ok(["task", "cancel", task.id]);
    assert.equal(
      (await ok(["task", "show", task.id])).task.status,
      "cancelled",
    );
    await ok(["epic", "close", epic.id]);
    await ok(["epic", "reopen", epic.id]);
    await ok(["task", "delete", task.id]);
    await ok(["epic", "delete", epic.id]);
    assert.equal((await ok(["task", "list", "--all"])).length, 0);
    await ok(["pause"]);
    assert.equal((await ok(["status"])).scheduler, "paused");
    await ok(["resume"]);
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI creates, lists and edits task-level future thread bindings without binding an epic", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-cli-threads-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.projects = [
    { id: "p", title: "Project", workspaceRoot: directory },
    { id: "q", title: "Other" },
  ];
  runtime.scheduler.threads = [
    { id: "existing", projectId: "p", title: "Existing", status: "idle" },
  ];
  const origin = "http://127.0.0.1:" + runtime.server.address().port;
  const ok = async (args) => {
    const result = await run(args, origin);
    assert.equal(result.code, 0, result.err);
    return result.data;
  };
  const add = async (target, project = "p", epic = "none") =>
    ok([
      "task",
      "add",
      "--project",
      project,
      "--epic",
      epic,
      "--prompt",
      "Planned task",
      ...target,
    ]);
  try {
    const epic = await ok([
      "epic",
      "add",
      "--project",
      "p",
      "--name",
      "Feature",
    ]);
    const first = await add(["--thread-key", "api"], "p", epic.id);
    const second = await add(["--thread-key", "api"], "p", epic.id);
    const third = await add(["--thread-key", "ui"], "p", epic.id);
    assert.equal(first.threadId, second.threadId);
    assert.notEqual(first.threadId, third.threadId);
    const other = await add(["--thread-key", "api"], "q");
    assert.notEqual(other.threadId, first.threadId);
    const byId = await add(["--thread", first.threadId]);
    assert.equal(byId.threadKey, "api");
    const threads = await ok(["thread", "list", "--project", "p"]);
    assert.equal(threads.filter((t) => t.status === "planned").length, 2);
    assert.equal(threads.find((t) => t.threadKey === "api").id, first.threadId);
    assert.equal((await ok(["epic", "show", epic.id])).threadId, undefined);
    assert.equal((await add(["--thread", "new"], "p", epic.id)).threadId, null);
    assert.equal(
      (await add(["--thread", "existing"], "p", epic.id)).threadId,
      "existing",
    );
    const moved = await ok(["task", "update", third.id, "--thread-key", "api"]);
    assert.equal(moved.threadId, first.threadId);
    const separate = await ok(["task", "update", third.id, "--thread", "new"]);
    assert.equal(separate.threadId, null);
    assert.equal(separate.threadKey, null);
    const conflict = await run(
      [
        "task",
        "add",
        "--project",
        "p",
        "--prompt",
        "Invalid",
        "--thread",
        "new",
        "--thread-key",
        "oops",
      ],
      origin,
    );
    assert.equal(conflict.code, 1);
    assert.match(conflict.err, /either/);
    assert.equal(runtime.store.list("attempts").length, 0);
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
