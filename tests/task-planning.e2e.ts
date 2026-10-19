import { mockProjectCreation } from "./helpers.js";
import { tcpPort } from "./helpers.js";
import type { ElectronApplication } from "@playwright/test";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startServer } from "../server/index.js";
const exec = promisify(execFile);

test("native board, capture composer and bundled CLI share priorities and blocker state", async ({}, testInfo) => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-planning-ui-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  runtime.scheduler.signal = () => {};
  runtime.scheduler.reports.enqueue = () => {};
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
    const base = await cli([
      "task",
      "add",
      "--project",
      project.id,
      "--priority",
      "low",
      "--prompt",
      "Base API",
    ]);
    const cliTask = await cli([
      "task",
      "add",
      "--project",
      project.id,
      "--priority",
      "high",
      "--blocked-by",
      base.id,
      "--prompt",
      "CLI dependent",
    ]);
    app = await launch();
    let page = await app.firstWindow();
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    await expect(page.locator(".kanban")).toBeVisible();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByLabel("Task prompt").fill("UI dependent");
    await page.getByLabel("Priority", { exact: true }).selectOption("urgent");
    await page.getByLabel("Add blocking task").selectOption(base.id);
    await page.getByRole("button", { name: /^Create task/ }).click();
    const uiCard = page.getByRole("article", {
      name: "UI dependent",
      exact: true,
    });
    await expect(uiCard).toBeVisible();
    await expect(
      uiCard.getByLabel("Priority: Urgent", { exact: true }),
    ).toBeVisible();
    await expect(uiCard.getByLabel("Task is blocked")).toHaveText(
      "Blocked by 1 task",
    );
    await expect(page.locator(".column-todo article h3")).toHaveText([
      "UI dependent",
      "CLI dependent",
      "Base API",
    ]);
    const ui = (await cli(["task", "list", "--project", project.id])).find(
      (t: import("../shared/types.js").Task) => t.title === "UI dependent",
    );
    expect(ui.priority).toBe("urgent");
    expect(ui.blockedBy).toEqual([base.id]);
    await uiCard.click();
    let details = page.getByRole("dialog", {
      name: "Task details",
      exact: true,
    });
    await expect(details.getByLabel("Task priority")).toHaveValue("urgent");
    await details.getByLabel("Task priority").selectOption("low");
    await expect
      .poll(async () => (await cli(["task", "show", ui.id])).task.priority)
      .toBe("low");
    await details
      .getByRole("button", {
        name: "Remove blocker TL-" + base.id.slice(0, 4).toUpperCase(),
        exact: true,
      })
      .click();
    await expect(
      details.getByRole("button", { name: /Remove blocker/ }),
    ).toHaveCount(0);
    expect((await cli(["task", "show", ui.id])).task.blockedBy).toEqual([]);
    await details.getByLabel("Add blocking task").selectOption(base.id);
    await expect(
      details.getByRole("button", { name: /Remove blocker/ }),
    ).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath("task-priority-and-blockers.png"),
    });
    await details.getByRole("button", { name: /TL-.*Base API/ }).click();
    details = page.getByRole("dialog", { name: "Task details", exact: true });
    await expect(
      details.getByRole("heading", { name: "Base API", exact: true }),
    ).toBeVisible();
    await expect(details.getByText("Blocks", { exact: true })).toBeVisible();
    await details.getByLabel("Add blocking task").selectOption(ui.id);
    await expect(
      page.getByText("Blockers would create a dependency cycle", {
        exact: false,
      }),
    ).toBeVisible();
    expect((await cli(["task", "show", base.id])).task.blockedBy).toEqual([]);
    await details
      .getByRole("button", { name: "Close details", exact: true })
      .click();
    await cli(["task", "update", ui.id, "--priority", "urgent"]);
    await expect(
      uiCard.getByLabel("Priority: Urgent", { exact: true }),
    ).toBeVisible();
    // Provider completion is an explicit local fixture transition, not an agent run.
    runtime.store.update("tasks", base.id, { status: "review" });
    runtime.notify();
    await expect(uiCard.getByLabel("Task is blocked")).toHaveCount(0);
    expect(
      await cli(["task", "list", "--project", project.id, "--blocked"]),
    ).toEqual([]);
    await cli(["task", "block", ui.id, "--by", cliTask.id]);
    await expect(uiCard.getByLabel("Task is blocked")).toHaveText(
      "Blocked by 1 task",
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page
        .getByRole("article", { name: "UI dependent", exact: true })
        .getByLabel("Priority: Urgent", { exact: true }),
    ).toBeVisible();
    expect((await cli(["task", "show", ui.id])).task.blockedBy).toEqual([
      base.id,
      cliTask.id,
    ]);
    await page.goto(origin + "/?capture");
    await page.getByLabel("Task prompt").fill("Captured dependent");
    await page.getByLabel("Priority", { exact: true }).selectOption("high");
    await page.getByLabel("Add blocking task").selectOption(cliTask.id);
    await page.getByLabel("Task prompt").press("Meta+Enter");
    await expect
      .poll(
        async () =>
          runtime.store
            .list("tasks")
            .find(
              (t: import("../shared/types.js").Task) =>
                t.title === "Captured dependent",
            )?.priority,
      )
      .toBe("high");
    const captured = runtime.store
      .list("tasks")
      .find(
        (t: import("../shared/types.js").Task) =>
          t.title === "Captured dependent",
      );
    expect(captured!.blockedBy).toEqual([cliTask.id]);
    expect(runtime.store.list("attempts")).toHaveLength(0);
    expect((await cli(["project", "show", project.id])).mode).toBe("paused");
  } finally {
    await app?.close();
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
