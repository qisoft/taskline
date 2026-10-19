import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer } from "../server/index.js";
const exec = promisify(execFile);

test("native composer and bundled CLI share task-level future threads, preserve explicit targets and restore selection", async ({}, testInfo) => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-target-ui-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
  runtime.scheduler.projects = [
    { id: "p", title: "Planning fixture", workspaceRoot: directory },
  ];
  runtime.scheduler.threads = [
    {
      id: "existing",
      projectId: "p",
      title: "Existing thread",
      status: "idle",
    },
  ];
  runtime.store.put("settings", { id: "project:p", autoStart: false });
  const origin = "http://127.0.0.1:" + runtime.server.address().port;
  const executable =
    process.env.TASKLINE_TEST_APP ||
    "/Applications/Taskline.app/Contents/MacOS/Taskline";
  const bundledCli = resolve(dirname(executable), "../Resources/taskline.mjs");
  const cli = async (args) =>
    JSON.parse(
      (
        await exec(process.execPath, [bundledCli, ...args, "--json"], {
          env: { ...process.env, TASKLINE_URL: origin },
        })
      ).stdout,
    );
  const env = {
    ...process.env,
    TASKLINE_E2E: "1",
    TASKLINE_DATA_DIR: directory,
    TASKLINE_PORT: String(runtime.server.address().port),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TASKLINE_UI_ORIGIN;
  const launch = () =>
    electron.launch({
      executablePath: executable,
      args: ["--user-data-dir=" + join(directory, "electron")],
      env,
    });
  let app;
  try {
    const epic = await cli([
      "epic",
      "add",
      "--project",
      "p",
      "--name",
      "Shared feature",
    ]);
    const first = await cli([
      "task",
      "add",
      "--project",
      "p",
      "--epic",
      epic.id,
      "--thread-key",
      "feature-api",
      "--prompt",
      "Plan API",
    ]);
    app = await launch();
    let page = await app.firstWindow();
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    await expect(page.locator(".kanban")).toBeVisible();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
      first.threadId,
    );
    await page.getByLabel("Thread", { exact: true }).selectOption("__named__");
    await page.getByLabel("Thread key").fill("feature-api");
    await page.getByLabel("Task prompt").fill("Implement API");
    await page.screenshot({
      path: testInfo.outputPath("named-thread-composer.png"),
    });
    await page.getByRole("button", { name: /^Create task/ }).click();
    await expect(
      page.getByRole("article", { name: "Implement API", exact: true }),
    ).toBeVisible();
    const rows = await cli(["task", "list", "--project", "p"]);
    const second = rows.find((t) => t.title === "Implement API");
    expect(second.threadId).toBe(first.threadId);
    expect(second.groupId).toBe(epic.id);
    await page
      .getByRole("article", { name: "Implement API", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Task details" }),
    ).toContainText("feature-api · created on first start");
    await expect(
      page.getByRole("button", { name: "Open in T3 Code", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Close details", exact: true })
      .click();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Thread", { exact: true }).selectOption("__named__");
    await page.getByLabel("Thread key").fill("feature-ui");
    await page.getByLabel("Task prompt").fill("Implement UI");
    await page.getByRole("button", { name: /^Create task/ }).click();
    await expect(
      page.getByRole("article", { name: "Implement UI", exact: true }),
    ).toBeVisible();
    const ui = (await cli(["task", "list", "--project", "p"])).find(
      (t) => t.title === "Implement UI",
    );
    expect(ui.threadId).not.toBe(first.threadId);
    expect(ui.groupId).toBe(epic.id);
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Thread", { exact: true }).selectOption("");
    await page.getByLabel("Task prompt").fill("Independent task");
    await page.getByRole("button", { name: /^Create task/ }).click();
    await expect(
      page.getByRole("article", { name: "Independent task", exact: true }),
    ).toBeVisible();
    expect(
      (await cli(["task", "list", "--project", "p"])).find(
        (t) => t.title === "Independent task",
      ).threadId,
    ).toBeNull();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Thread", { exact: true }).selectOption("existing");
    await page.getByLabel("Task prompt").fill("Explicit existing thread");
    await page.getByRole("button", { name: /^Create task/ }).click();
    await expect(
      page.getByRole("article", {
        name: "Explicit existing thread",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await cli(["task", "list", "--project", "p"])).find(
        (t) => t.title === "Explicit existing thread",
      ).threadId,
    ).toBe("existing");
    await cli([
      "task",
      "add",
      "--project",
      "p",
      "--epic",
      epic.id,
      "--thread-key",
      "feature-api",
      "--prompt",
      "Restore API target",
    ]);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".kanban")).toBeVisible();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
      first.threadId,
    );
    await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(epic.id);
    await page.keyboard.press("Escape");
    await page.goto(origin + "/?capture");
    await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
      first.threadId,
    );
    await page.getByLabel("Task prompt").fill("Captured task for API");
    await page.getByLabel("Task prompt").press("Meta+Enter");
    await expect
      .poll(
        async () =>
          runtime.store
            .list("tasks")
            .find((t) => t.title === "Captured task for API")?.threadId,
      )
      .toBe(first.threadId);
    expect(runtime.store.list("attempts")).toHaveLength(0);
    expect((await cli(["epic", "show", epic.id])).threadId).toBeUndefined();
  } finally {
    await app?.close();
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
