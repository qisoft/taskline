import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";

let app, page, directory;
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "taskline-board-status-"));
  const store = new Store(directory);
  store.put("settings", { id: "app", paused: true });
  for (const status of [
    "todo",
    "failed",
    "doing",
    "review",
    "done",
    "cancelled",
  ])
    store.put("tasks", {
      id: status + "-fixture",
      title: status + " fixture",
      prompt: "Local board fixture; no agent task is launched.",
      projectId: "fixture",
      status,
      model: "gpt-6-luna",
      instanceId: "codex",
      createdAt: "2026-10-13T12:00:00Z",
      updatedAt: "2026-10-13T12:00:00Z",
      rank: 1,
      attachments: [],
      questions: [],
    });
  store.close();
  const portServer = createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const env = {
    ...process.env,
    TASKLINE_E2E: "1",
    TASKLINE_DATA_DIR: directory,
    TASKLINE_PORT: String(port),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TASKLINE_UI_ORIGIN;
  app = await electron.launch({
    ...(process.env.TASKLINE_INSTALLED
      ? {
          executablePath: "/Applications/Taskline.app/Contents/MacOS/Taskline",
          args: ["--user-data-dir=" + join(directory, "electron")],
        }
      : {
          args: [
            "electron/main.cjs",
            "--user-data-dir=" + join(directory, "electron"),
          ],
        }),
    env,
  });
  page = await app.firstWindow();
  await expect(page.locator(".kanban")).toBeVisible();
});
test.afterAll(async () => {
  if (app) {
    const child = app.process();
    let timer;
    try {
      await Promise.race([
        app.close(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("Desktop did not quit")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
    }
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("cancelled tasks appear in Done, retain their status and can still be retried", async () => {
  const card = page.getByRole("article", {
    name: "cancelled fixture",
    exact: true,
  });
  await expect(
    page
      .locator(".column-todo")
      .getByRole("article", { name: "cancelled fixture", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".column-done")
      .getByRole("article", { name: "cancelled fixture", exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.locator(".column-todo > header span")).toHaveText("2");
  await expect(page.locator(".column-done > header span")).toHaveText("2");
  for (const [column, statuses] of [
    ["todo", ["todo", "failed"]],
    ["doing", ["doing"]],
    ["review", ["review"]],
    ["done", ["done", "cancelled"]],
  ]) {
    const section = page.locator(".column-" + column);
    await expect(section.getByRole("article")).toHaveCount(statuses.length);
    for (const status of statuses)
      await expect(
        section.getByRole("article", {
          name: status + " fixture",
          exact: true,
        }),
      ).toBeVisible();
  }
  const detail = await (
    await page.request.get(
      new URL("/api/tasks/cancelled-fixture", page.url()).href,
    )
  ).json();
  expect(detail.task.status).toBe("cancelled");
  await card.click();
  await expect(
    page
      .getByRole("dialog", { name: "Task details" })
      .getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  const identity = await app.evaluate(({ app }) => ({
    executable: process.execPath,
    packaged: app.isPackaged,
  }));
  if (process.env.TASKLINE_INSTALLED) {
    expect(identity.packaged).toBe(true);
    expect(identity.executable).toBe(
      "/Applications/Taskline.app/Contents/MacOS/Taskline",
    );
  }
});
