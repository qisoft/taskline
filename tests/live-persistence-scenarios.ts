import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type {
  AppState,
  Epic,
  ImageReference,
  Project,
  Task,
} from "../shared/types.js";
import { tcpPort } from "./helpers.js";
import { desktop, launch, origin, request } from "./live-desktop-fixture.js";
export function registerPersistenceScenarios() {
  test("project configuration persists and disabling automatic execution holds a new card on the board", async () => {
    const initial = await request("/state");
    const project = initial.projects.find(
      (p: Project) => p.title === "Taskline E2E",
    );
    const policy = (state: AppState) =>
      state.projectSettings.find(
        (p) => p.id === project.id || p.id === "project:" + project.id,
      );
    const original = policy(initial);
    let taskId: string | undefined;
    try {
      await desktop.window
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      let dialog = desktop.window.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      let projectRow = dialog
        .locator(".project-setting")
        .filter({ hasText: project.title });
      await projectRow.getByRole("checkbox").uncheck();
      await expect
        .poll(async () => policy(await request("/state"))!.autoStart)
        .toBe(false);
      await dialog.getByLabel("Parallel tasks for " + project.title).fill("3");
      await dialog
        .getByLabel("Parallel tasks for " + project.title)
        .press("Tab");
      await expect
        .poll(async () => policy(await request("/state"))!.concurrencyLimit)
        .toBe(3);
      await expect(
        dialog.getByLabel("Base branch for " + project.title),
      ).toHaveValue(original!.baseRef);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();

      const title = "E2E project policy pause " + Date.now();
      await desktop.window
        .getByRole("button", { name: "New task", exact: true })
        .click();
      const composer = desktop.window.getByRole("dialog", {
        name: "New task",
        exact: true,
      });
      await composer
        .getByLabel("Task prompt")
        .fill(title + "\nReturn TASKLINE-POLICY-OK. Do not modify files.");
      await composer
        .getByLabel("Project", { exact: true })
        .selectOption(project.id);
      await composer.getByLabel("Thread", { exact: true }).selectOption("");
      await composer.getByLabel("Epic", { exact: true }).selectOption("");
      await composer
        .getByLabel("Model", { exact: true })
        .selectOption("codex::gpt-6-luna");
      await composer.getByRole("button", { name: "Create task" }).click();
      await expect(composer).toBeHidden();
      await expect(
        desktop.window
          .locator(".column-todo")
          .getByRole("article", { name: title, exact: true }),
      ).toBeVisible();
      taskId = (await request("/state")).tasks.find(
        (t: Task) => t.title === title,
      ).id;

      await desktop.app.close();
      desktop.app = await launch();
      desktop.window = await desktop.app.firstWindow();
      await expect(desktop.window.locator(".kanban")).toBeVisible();
      const restored = await request("/state");
      expect(policy(restored)!.concurrencyLimit).toBe(3);
      expect(policy(restored)!.autoStart).toBe(false);
      expect(restored.tasks.find((t: Task) => t.id === taskId).status).toBe(
        "todo",
      );
      expect((await request("/tasks/" + taskId)).attempts).toHaveLength(0);
      await desktop.window
        .getByRole("button", { name: "Settings", exact: true })
        .click();
      dialog = desktop.window.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      projectRow = dialog
        .locator(".project-setting")
        .filter({ hasText: project.title });
      await expect(
        dialog.getByLabel("Parallel tasks for " + project.title),
      ).toHaveValue("3");
      await expect(projectRow.getByRole("checkbox")).not.toBeChecked();
      await desktop.window.screenshot({
        path: "artifacts/project-policy-settings.png",
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await desktop.window
        .getByRole("article", { name: title, exact: true })
        .click();
      await expect(
        desktop.window.getByRole("dialog", { name: "Task details" }),
      ).toBeVisible();
      await desktop.window.screenshot({
        path: "artifacts/project-policy-queued-card.png",
      });
      writeFileSync(
        "artifacts/project-policy-e2e.json",
        JSON.stringify(
          {
            passed: true,
            projectId: project.id,
            taskId,
            originalPolicy: original,
            persistedPolicy: policy(restored),
            attemptsWhilePaused: 0,
          },
          null,
          2,
        ),
      );
    } finally {
      const closeDetails = desktop.window.getByRole("button", {
        name: "Close details",
        exact: true,
      });
      if (await closeDetails.isVisible()) await closeDetails.click();
      if (taskId)
        await request("/tasks/" + taskId + "/cancel", {}).catch(() => {});
      await request(
        "/projects/" + encodeURIComponent(project.id),
        {
          concurrencyLimit: original!.concurrencyLimit,
          autoStart: original!.autoStart,
        },
        "PATCH",
      );
    }
  });

  test("creates an epic inside native task capture and caches agent screenshot references through restart", async () => {
    const bytes = readFileSync("artifacts/kanban-desktop.png");
    const imageServer = createServer((req, res) => {
      res.setHeader("content-type", "image/png");
      res.end(bytes);
    });
    await new Promise<void>((resolve) =>
      imageServer.listen(0, "127.0.0.1", resolve),
    );
    const imageUrl =
      "http://127.0.0.1:" + tcpPort(imageServer) + "/agent-proof.png";
    const stopServer = () =>
      new Promise<void>((resolve) => {
        imageServer.close(() => resolve());
        imageServer.closeAllConnections();
      });
    let stopped = false;
    try {
      const state = await request("/state");
      const project = state.projects.find(
        (p: Project) => p.title === "Taskline E2E",
      );
      const popupPromise = desktop.app.waitForEvent("window");
      await desktop.window.evaluate(() =>
        globalThis.window.taskline!.captureText(),
      );
      const capture = await popupPromise;
      const title = "E2E inline epic and result images " + Date.now();
      const prompt =
        title +
        "\nIn this disposable worktree create the exact file path `validation/proof with spaces.png` by copying /Users/qisoft/dev/taskline/artifacts/kanban-desktop.png. Only modify this disposable workspace, no commits or publishing. Run npm test. In your final answer include a Markdown image using the absolute destination file path enclosed in angle brackets, and this exact remote screenshot URL: " +
        imageUrl +
        ". Return TASKLINE-RESULT-IMAGES-OK. The URL is just an output reference; do not download it.";
      await capture.getByLabel("Task prompt").fill(prompt);
      await capture
        .getByLabel("Project", { exact: true })
        .selectOption(project.id);
      await capture.getByLabel("Thread", { exact: true }).selectOption("");
      await capture
        .getByLabel("Model", { exact: true })
        .selectOption("codex::gpt-6-luna");
      await capture
        .getByLabel("Attach screenshot")
        .setInputFiles("artifacts/kanban-desktop.png");
      await expect(capture.locator(".attachment-preview img")).toBeVisible();
      await capture
        .getByRole("button", { name: "Create new epic", exact: true })
        .click();
      const editor = capture.getByRole("dialog", {
        name: "New epic",
        exact: true,
      });
      const name = "E2E inline epic " + Date.now();
      await editor.getByLabel("Epic name").fill(name);
      await editor
        .getByLabel("Shared context")
        .fill(
          "Use the disposable fixture only. Preserve screenshots as validation evidence.",
        );
      await editor
        .getByLabel("Acceptance criteria")
        .fill(
          "Local and remote image references are displayed in the task checks section.",
        );
      await editor.getByRole("button", { name: "Save epic" }).click();
      await expect(editor).toBeHidden();
      const group = (await request("/state")).groups.find(
        (g: Epic) => g.name === name,
      );
      await expect(capture.getByLabel("Epic", { exact: true })).toHaveValue(
        group.id,
      );
      await expect(capture.getByLabel("Task prompt")).toHaveValue(prompt);
      await expect(capture.locator(".attachment-preview img")).toBeVisible();
      await capture.screenshot({ path: "artifacts/inline-epic-capture.png" });
      await capture.getByRole("button", { name: "Create task" }).click();
      await expect
        .poll(
          async () =>
            (await request("/state")).tasks.find((t: Task) => t.title === title)
              ?.reportState,
          { timeout: 180000 },
        )
        .toBe("ready");
      const task = (await request("/state")).tasks.find(
        (t: Task) => t.title === title,
      );
      expect(task.status).toBe("review");
      expect(task.groupId).toBe(group.id);
      expect(task.validationImages).toHaveLength(1);
      const image = task.validationImages[0];
      expect(
        image.sources.some(
          (s: ImageReference & { kind: string }) => s.kind === "file",
        ),
      ).toBeTruthy();
      expect(
        image.sources.some(
          (s: ImageReference & { kind: string }) => s.reference === imageUrl,
        ),
      ).toBeTruthy();
      expect(
        Buffer.from(
          await (await fetch(origin + image.url)).arrayBuffer(),
        ).equals(bytes),
      ).toBeTruthy();
      const detail = await request("/tasks/" + task.id);
      expect(detail.attempts[0].contextVersion).toBe(1);
      expect(detail.attempts[0].compiledPrompt).toContain(group.context);
      await desktop.window
        .getByRole("button", { name: "My tasks", exact: false })
        .click();
      await desktop.window
        .getByRole("article", { name: title, exact: true })
        .click();
      const checks = desktop.window.locator(".detail-section").filter({
        has: desktop.window.getByRole("heading", {
          name: "How it was tested",
          exact: true,
        }),
      });
      await checks.locator(".validation-gallery img").scrollIntoViewIfNeeded();
      await expect(checks.locator(".validation-gallery img")).toBeVisible();
      for (const issue of task.validationImageIssues)
        await expect(
          checks.getByText("Screenshot unavailable: " + issue.reference, {
            exact: false,
          }),
        ).toBeVisible();
      await expect
        .poll(() =>
          checks
            .locator(".validation-gallery img")
            .evaluate((img) => (img as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(100);
      await desktop.window.screenshot({
        path: "artifacts/result-validation-gallery.png",
      });
      const workspace = detail.attempts[0].workspace;
      const ownedSource = image.sources.find(
        (s: ImageReference & { kind: string }) =>
          s.kind === "file" &&
          (s.reference.startsWith(workspace + "/") ||
            s.reference.startsWith("validation/")),
      );
      expect(ownedSource).toBeTruthy();
      const decoded = decodeURIComponent(ownedSource.reference);
      const ownedPath = decoded.startsWith("/")
        ? decoded
        : join(workspace, decoded);
      expect(ownedPath).toContain(workspace + "/validation/");
      expect(existsSync(ownedPath)).toBeTruthy();
      rmSync(ownedPath);
      await stopServer();
      stopped = true;
      await desktop.app.close();
      desktop.app = await launch();
      desktop.window = await desktop.app.firstWindow();
      await expect(desktop.window.locator(".kanban")).toBeVisible();
      const restored = (await request("/state")).tasks.find(
        (t: Task) => t.id === task.id,
      );
      expect(restored.validationImages).toEqual(task.validationImages);
      expect(restored.report).toEqual(task.report);
      expect(
        Buffer.from(
          await (await fetch(origin + image.url)).arrayBuffer(),
        ).equals(bytes),
      ).toBeTruthy();
      await desktop.window
        .getByRole("article", { name: title, exact: true })
        .click();
      await expect(
        desktop.window.locator(".validation-gallery img"),
      ).toBeVisible();
      await desktop.window
        .getByRole("button", { name: "Close details", exact: true })
        .click();
      writeFileSync(
        "artifacts/result-images-e2e.json",
        JSON.stringify(
          {
            passed: true,
            taskId: task.id,
            threadId: task.threadId,
            groupId: group.id,
            validationImages: image,
            originalFileDeleted: true,
            deletedProofPath: ownedPath,
            originalUrlOffline: true,
            restoredImageMatches: true,
          },
          null,
          2,
        ),
      );
    } finally {
      if (!stopped) await stopServer();
    }
  });
}
