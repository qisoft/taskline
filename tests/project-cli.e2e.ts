import type { ElectronApplication } from "@playwright/test";
import { _electron as electron, expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { startServer } from "../server/index.js";
import { mockProjectCreation, tcpPort } from "./helpers.js";
const exec = promisify(execFile);
test("CLI planning backlog and native Active/Paused controls share one durable project policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-cli-ui-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  mockProjectCreation(runtime.scheduler.t3);
  const origin = "http://127.0.0.1:" + tcpPort(runtime.server);
  const executable =
    process.env.TASKLINE_TEST_APP ||
    "/Applications/Taskline.app/Contents/MacOS/Taskline";
  const bundledCli = resolve(dirname(executable), "../Resources/taskline.mjs");
  const cli = async (args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, [bundledCli, ...args, "--json"], {
          env: { ...process.env, TASKLINE_URL: origin },
        })
      ).stdout,
    );
  const env: Record<string, string> = {
    ...process.env,
    TASKLINE_E2E: "1",
    TASKLINE_DATA_DIR: directory,
    TASKLINE_PORT: String(tcpPort(runtime.server)),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TASKLINE_UI_ORIGIN;
  const launch = () =>
    electron.launch({
      executablePath: executable,
      args: ["--user-data-dir=" + join(directory, "electron")],
      env,
    });
  let app!: ElectronApplication;
  try {
    const project = await cli([
      "project",
      "create",
      "--name",
      "Planning fixture",
      "--path",
      directory,
    ]);
    const epic = await cli([
      "epic",
      "add",
      "--project",
      project.id,
      "--name",
      "Feature plan",
      "--label",
      "Roadmap",
    ]);
    expect(epic.mode).toBe("paused");
    const task = await cli([
      "task",
      "add",
      "--project",
      project.id,
      "--epic",
      epic.id,
      "--prompt",
      "Local CLI planning fixture. No agent executes this task.",
      "--label",
      "Bug",
    ]);
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator(".kanban")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Activate project Planning fixture",
        exact: true,
      }),
    ).toBeVisible();
    const taskCard = page.getByRole("article", {
      name: task.title,
      exact: true,
    });
    await expect(taskCard.locator(".item-labels")).toHaveText("Bug");
    await cli(["task", "update", task.id, "--add-label", "Reviewed"]);
    await page
      .getByRole("combobox", { name: "Filter tasks by label" })
      .selectOption("reviewed");
    await taskCard.click();
    const taskDetails = page.getByRole("dialog", {
      name: "Task details",
      exact: true,
    });
    await taskDetails.getByLabel("Task labels", { exact: true }).fill("UI");
    await taskDetails.getByLabel("Task labels", { exact: true }).press("Enter");
    await expect(
      taskDetails.getByRole("button", { name: "Remove label UI", exact: true }),
    ).toBeVisible();
    await taskDetails
      .getByRole("button", { name: "Remove label Bug", exact: true })
      .click();
    await expect
      .poll(async () => (await cli(["task", "show", task.id])).task.labels)
      .toEqual(["Reviewed", "UI"]);
    await taskDetails
      .getByRole("button", { name: "Close details", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Filter tasks by label" })
      .selectOption("ui");
    await cli(["task", "update", task.id, "--remove-label", "UI"]);
    await expect(taskCard).not.toBeVisible();
    await page
      .getByRole("combobox", { name: "Filter tasks by label" })
      .selectOption("");
    await expect(
      page
        .locator(".column-todo")
        .getByRole("article", { name: task.title, exact: true }),
    ).toBeVisible();
    await cli(["project", "activate", project.id]);
    await expect(
      page.getByRole("button", {
        name: "Pause project Planning fixture",
        exact: true,
      }),
    ).toHaveText("Active");
    await page
      .getByRole("button", {
        name: "Pause project Planning fixture",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Activate project Planning fixture",
        exact: true,
      }),
    ).toHaveText("Paused");
    expect((await cli(["project", "show", project.id])).mode).toBe("paused");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("checkbox", {
        name: "Active project Planning fixture",
        exact: true,
      })
      .check();
    await expect
      .poll(async () => (await cli(["project", "show", project.id])).mode)
      .toBe("active");
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await cli(["project", "pause", project.id]);
    await page.getByRole("button", { name: /^Epics/ }).click();
    const epicCard = page
      .locator(".epic-card")
      .filter({ hasText: "Feature plan" });
    await epicCard.getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit epic", exact: true });
    await editor.getByLabel("Epic labels", { exact: true }).fill("UI");
    await editor.getByLabel("Epic labels", { exact: true }).press("Enter");
    await expect(
      editor.getByRole("button", { name: "Remove label UI", exact: true }),
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "Save epic", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Filter epics by label" })
      .selectOption("ui");
    await expect(epicCard).toBeVisible();
    await cli(["epic", "update", epic.id, "--remove-label", "UI"]);
    await expect(epicCard).not.toBeVisible();
    await page
      .getByRole("combobox", { name: "Filter epics by label" })
      .selectOption("");
    await expect(
      epicCard.getByRole("button", {
        name: "Activate epic Feature plan",
        exact: true,
      }),
    ).toHaveText("Paused");
    await cli(["epic", "activate", epic.id]);
    await expect(
      epicCard.getByRole("button", {
        name: "Pause epic Feature plan",
        exact: true,
      }),
    ).toHaveText("Active");
    await cli(["project", "activate", project.id]);
    await cli(["project", "pause", project.id]);
    expect((await cli(["epic", "show", epic.id])).mode).toBe("active");
    await epicCard
      .getByRole("button", { name: "Pause epic Feature plan", exact: true })
      .click();
    await expect
      .poll(async () => (await cli(["epic", "show", epic.id])).mode)
      .toBe("paused");
    await cli(["epic", "resume", epic.id]);
    await cli(["project", "stop", project.id]);
    await expect(
      epicCard.getByRole("button", {
        name: "Activate epic Feature plan",
        exact: true,
      }),
    ).toHaveText("Paused");
    await expect(
      page.getByRole("button", {
        name: "Activate project Planning fixture",
        exact: true,
      }),
    ).toBeVisible();
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("button", {
        name: "Activate project Planning fixture",
        exact: true,
      }),
    ).toHaveText("Paused");
    const details = await cli(["task", "show", task.id]);
    expect(details.task.status).toBe("todo");
    expect(details.attempts).toHaveLength(0);
    expect(details.task.labels).toEqual(["Reviewed"]);
    expect((await cli(["epic", "show", epic.id])).labels).toEqual(["Roadmap"]);
    expect((await cli(["epic", "show", epic.id])).mode).toBe("paused");
  } finally {
    await app?.close();
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
