import type { ElectronApplication } from "@playwright/test";
import { test as base, _electron as electron, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { recordTargetUsage } from "../server/target-history.js";
import { stateFixture, tcpPort } from "./helpers.js";

const test =
  process.env.TASKLINE_TEST_APP || process.env.TASKLINE_INSTALLED
    ? base.extend({
        page: async ({}, use) => {
          const directory = mkdtempSync(join(tmpdir(), "taskline-composer-"));
          const portServer = createPortServer();
          await new Promise<void>((resolve) =>
            portServer.listen(0, "127.0.0.1", resolve),
          );
          const port = tcpPort(portServer);
          await new Promise<void>((resolve) =>
            portServer.close(() => resolve()),
          );
          const env: Record<string, string> = {
            ...process.env,
            TASKLINE_E2E: "1",
            TASKLINE_DATA_DIR: directory,
            TASKLINE_PORT: String(port),
          };
          delete env.ELECTRON_RUN_AS_NODE;
          delete env.TASKLINE_UI_ORIGIN;
          let app!: ElectronApplication;
          try {
            app = await electron.launch({
              executablePath:
                process.env.TASKLINE_TEST_APP ||
                "/Applications/Taskline.app/Contents/MacOS/Taskline",
              args: ["--user-data-dir=" + join(directory, "electron")],
              env,
            });
            expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
            await use(await app.firstWindow());
          } finally {
            if (app) {
              const child = app.process();
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  app.close(),
                  new Promise((_, reject) => {
                    timer = setTimeout(
                      () => reject(Error("Desktop did not quit")),
                      5000,
                    );
                  }),
                ]);
              } finally {
                clearTimeout(timer);
                if (child.exitCode === null && child.signalCode === null)
                  child.kill("SIGTERM");
              }
            }
            rmSync(directory, { recursive: true, force: true });
          }
        },
      })
    : base;

let server: import("vite").ViteDevServer | undefined, origin: string;
const fixture = () =>
  stateFixture({
    projects: [
      { id: "codex", title: "Codex project" },
      { id: "opus", title: "Opus project" },
      { id: "empty", title: "Empty project" },
    ],
    projectSettings: [
      { id: "codex", instanceId: "codex", model: "gpt-6.1" },
      { id: "opus", instanceId: "codex", model: "gpt-6.1" },
      { id: "empty", instanceId: "codex", model: "gpt-6-luna" },
    ],
    threads: [
      {
        id: "codex-old",
        projectId: "codex",
        title: "Codex older",
        status: "idle",
        providerInstanceId: "codex",
        modelSelection: { model: "gpt-6.1" },
        updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      },
      {
        id: "codex-new",
        projectId: "codex",
        title: "Codex newer",
        status: "idle",
        providerInstanceId: "codex",
        modelSelection: { model: "gpt-6.1" },
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
      {
        id: "opus-old",
        projectId: "opus",
        title: "Opus older",
        status: "idle",
        providerInstanceId: "claude",
        modelSelection: { model: "opus-5.5" },
        updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      },
      {
        id: "opus-thread",
        projectId: "opus",
        title: "Opus work",
        status: "idle",
        providerInstanceId: "claude",
        modelSelection: { model: "opus-5.5" },
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
    tasks: [],
    groups: [
      {
        id: "codex-epic",
        name: "Codex epic",
        projectId: "codex",
        status: "active",
      },
      {
        id: "opus-epic",
        name: "Opus epic",
        projectId: "opus",
        status: "active",
      },
    ],
    models: [
      { instanceId: "codex", id: "gpt-6.1", label: "GPT-6.1" },
      { instanceId: "claude", id: "opus-5.5", label: "Opus 5.5" },
      { instanceId: "codex", id: "gpt-6-luna", label: "GPT-6 Luna" },
    ],
    settings: {
      textShortcut: "CommandOrControl+Shift+1",
      screenshotShortcut: "CommandOrControl+Shift+2",
      lastProjectId: "codex",
      lastGroupId: "codex-epic",
      targetHistory: {
        codex: {
          lastUsedAt: new Date(Date.now() - 60000).toISOString(),
          lastGroupId: "codex-epic",
        },
      },
    },
    connection: { connected: false },
  });
test.beforeAll(async () => {
  if (process.env.TASKLINE_TEST_APP || process.env.TASKLINE_INSTALLED) return;
  server = await createServer({ server: { port: 0, strictPort: false } });
  await server.listen();
  origin = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  await server?.close();
});
test.beforeEach(async ({ page }) => {
  const state = fixture();
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/state") await route.fulfill({ json: state });
    else if (path === "/api/selection") {
      state.settings = recordTargetUsage(
        state.settings,
        route.request().postDataJSON(),
      );
      await route.fulfill({ json: state.settings });
    } else if (path === "/api/groups" && route.request().method() === "POST") {
      const group = {
        ...route.request().postDataJSON(),
        id: "new-epic",
        status: "active",
      };
      state.groups.push(group);
      await route.fulfill({ json: group });
    } else if (path === "/api/tasks" && route.request().method() === "POST")
      await route.fulfill({
        json: { ...route.request().postDataJSON(), id: "new-task" },
      });
    else await route.fulfill({ body: "", contentType: "text/event-stream" });
  });
  if (process.env.TASKLINE_TEST_APP || process.env.TASKLINE_INSTALLED)
    await page.reload();
  else await page.goto(origin);
  await expect(page.locator(".kanban")).toBeVisible();
});
test("New task uses the current project board", async ({ page }) => {
  await page
    .locator(".project-nav")
    .getByRole("button", { name: "Opus project" })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("opus");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "claude::opus-5.5",
  );
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue("");
});
test("project changes clear foreign epics and restrict options", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Project", { exact: true }).selectOption("empty");
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Epic", { exact: true }).locator("option"),
  ).toHaveText(["No epic"]);
  await page.getByLabel("Project", { exact: true }).selectOption("opus");
  await expect(
    page.getByLabel("Epic", { exact: true }).locator("option"),
  ).toHaveText(["No epic", "Opus epic"]);
});
test("project changes inherit the model used by project threads", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Project", { exact: true }).selectOption("opus");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "claude::opus-5.5",
  );
});
test("epic and model controls have matching vertical bounds", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const epic = await page.getByLabel("Epic", { exact: true }).boundingBox();
  const model = await page.getByLabel("Model", { exact: true }).boundingBox();
  expect(Math.abs(epic!.y - model!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(epic!.height - model!.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("composer.png") });
});

test("inline epic inherits the project and the submitted task retains project, epic and model", async ({
  page,
}) => {
  await page
    .locator(".project-nav")
    .getByRole("button", { name: "Opus project" })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: "Create new epic" }).click();
  await expect(page.getByLabel("Epic project")).toHaveValue("opus");
  await page.getByLabel("Epic name").fill("New Opus epic");
  await page.getByRole("button", { name: "Save epic", exact: true }).click();
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(
    "new-epic",
  );
  await page.getByLabel("Task prompt").fill("Test the composer");
  const request = page.waitForRequest(
    (req) => req.url().endsWith("/api/tasks") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "Create task" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    projectId: "opus",
    groupId: "new-epic",
    instanceId: "claude",
    model: "opus-5.5",
    threadId: "opus-thread",
  });
});

test("switching projects restores each project's last thread and epic before submitting", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "codex-new",
  );
  await page.getByLabel("Thread", { exact: true }).selectOption("codex-old");
  await page.getByLabel("Project", { exact: true }).selectOption("opus");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "opus-thread",
  );
  await page.getByLabel("Thread", { exact: true }).selectOption("opus-old");
  await page.getByLabel("Epic", { exact: true }).selectOption("opus-epic");
  await page.getByLabel("Project", { exact: true }).selectOption("codex");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "codex-old",
  );
  await expect(
    page.getByLabel("Thread", { exact: true }).locator("option"),
  ).toHaveText([
    "New thread · separate worktree",
    "Named thread · create or reuse",
    "Codex older · idle",
    "Codex newer · idle",
  ]);
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(
    "codex-epic",
  );
  await page.getByLabel("Project", { exact: true }).selectOption("opus");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "opus-old",
  );
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(
    "opus-epic",
  );
  await page.getByLabel("Thread", { exact: true }).selectOption("");
  await page.getByLabel("Epic", { exact: true }).selectOption("");
  await page.getByLabel("Project", { exact: true }).selectOption("codex");
  await page.getByLabel("Project", { exact: true }).selectOption("opus");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Project", { exact: true }).locator("option"),
  ).toHaveText(["Opus project", "Codex project", "Empty project"]);
});

test("last project, thread and epic are restored when reopening and reloading", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Project", { exact: true }).selectOption("opus");
  await page.getByLabel("Thread", { exact: true }).selectOption("opus-old");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/selection") &&
      response.request().postDataJSON().groupId === "opus-epic",
  );
  await page.getByLabel("Epic", { exact: true }).selectOption("opus-epic");
  await saved;
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("opus");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "opus-old",
  );
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(
    "opus-epic",
  );
  await page.reload();
  await expect(page.locator(".project-nav button.active")).toContainText(
    "Opus project",
  );
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("opus");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "opus-old",
  );
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(
    "opus-epic",
  );
  await page.goto(new URL("?capture", page.url()).href);
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("opus");
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    "opus-old",
  );
  await expect(page.getByLabel("Epic", { exact: true })).toHaveValue(
    "opus-epic",
  );
});

test("keyboard capture respects the current project", async ({ page }) => {
  await page
    .locator(".project-nav")
    .getByRole("button", { name: "Opus project" })
    .click();
  await page.keyboard.press("c");
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue("opus");
});
