import { expect, test } from "@playwright/test";
import { join } from "node:path";
import type { Epic, Evidence, Project, Task } from "../shared/types.js";
import {
  desktop,
  epicName,
  launch,
  origin,
  request,
  screenshotTitle,
} from "./live-desktop-fixture.js";
export function registerEpicScenarios() {
  test("creates an epic and a screenshot task through the native quick composer", async () => {
    await desktop.window.getByRole("button", { name: /^Epics/ }).click();
    await desktop.window
      .getByRole("button", { name: "New epic", exact: true })
      .click();
    await desktop.window.getByLabel("Epic name").fill(epicName);
    await desktop.window
      .getByLabel("Shared context")
      .fill(
        "This is a disposable integration test. Never modify another project. Return TASKLINE-E2E in results.",
      );
    await desktop.window
      .getByLabel("Acceptance criteria")
      .fill("Screenshots reach T3 and results return to the correct card.");
    await desktop.window.getByRole("button", { name: "Save epic" }).click();
    await expect(
      desktop.window.getByRole("dialog", { name: "New epic" }),
    ).toBeHidden();
    const state = await request("/state");
    desktop.epic = state.groups.find((g: Epic) => g.name === epicName);
    expect(desktop.epic.contextVersion).toBe(1);
    const capturePromise = desktop.app.waitForEvent("window");
    await desktop.window.evaluate(() =>
      globalThis.window.taskline!.captureText(),
    );
    const capture = await capturePromise;
    await expect(capture.getByLabel("Task prompt")).toBeVisible();
    await capture
      .getByLabel("Task prompt")
      .fill(
        screenshotTitle +
          "\nInspect the attached screenshot. Return TASKLINE-SCREENSHOT-OK and briefly describe visible interface elements. Do not change files. Testing was not run because this is an image input test.",
      );
    const project = state.projects.find(
      (p: Project) => p.title === "Taskline E2E",
    );
    await capture
      .getByLabel("Project", { exact: true })
      .selectOption(project.id);
    await capture.getByLabel("Thread", { exact: true }).selectOption("");
    await capture
      .getByLabel("Epic", { exact: true })
      .selectOption(desktop.epic.id);
    await capture
      .getByLabel("Model", { exact: true })
      .selectOption("codex::gpt-6-luna");
    await capture
      .getByLabel("Attach screenshot", { exact: true })
      .setInputFiles(join(process.cwd(), "artifacts/kanban-desktop.png"));
    await expect(capture.locator(".attachment-preview img")).toBeVisible();
    await expect(
      capture.getByRole("button", { name: "Create task" }),
    ).toBeInViewport();
    await capture.screenshot({ path: "artifacts/quick-capture.png" });
    await capture.getByRole("button", { name: "Create task" }).click();
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return s.tasks.find((t: Task) => t.title === screenshotTitle)?.status;
        },
        { timeout: 150000 },
      )
      .toBe("review");
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return s.tasks.find((t: Task) => t.title === screenshotTitle)
            ?.reportState;
        },
        { timeout: 150000 },
      )
      .toBe("ready");
    const final = await request("/state");
    const task = final.tasks.find((t: Task) => t.title === screenshotTitle);
    expect(task.attachments).toHaveLength(1);
    expect(task.groupId).toBe(desktop.epic.id);
    expect(task.report.summary.length).toBeGreaterThan(10);
    const detail = await request("/tasks/" + task.id);
    expect(
      detail.attempts[0].evidence
        .filter((i: Evidence) =>
          ["assistant", "assistant_message"].includes(i.type),
        )
        .map((i: Evidence) => i.text)
        .join("\n"),
    ).toMatch(/TASKLINE-(?:REGION|SCREENSHOT)-OK/);
    expect(detail.attempts[0].workspace).toContain("/worktrees/");
    expect(detail.attempts[0].compiledPrompt).toContain("TASKLINE-E2E");
    expect(detail.attempts[0].contextVersion).toBe(1);
    await desktop.window
      .getByRole("button", { name: "My tasks", exact: false })
      .click();
    await desktop.window
      .getByRole("article", { name: screenshotTitle, exact: true })
      .click();
    await expect(desktop.window.locator(".detail-image")).toBeVisible();
    await desktop.window.screenshot({
      path: "artifacts/screenshot-task-review.png",
    });
    await desktop.window.getByRole("button", { name: "Accept result" }).click();
    await expect
      .poll(async () => {
        const s = await request("/state");
        return s.tasks.find((t: Task) => t.id === task.id).status;
      })
      .toBe("done");
    await desktop.window.getByRole("button", { name: "Close details" }).click();
  });
  test("epic context edits are versioned and group summaries are produced by Luna", async () => {
    await desktop.window.getByRole("button", { name: /^Epics/ }).click();
    const card = desktop.window
      .locator(".epic-card")
      .filter({ hasText: epicName });
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await desktop.window
      .getByLabel("Shared context")
      .fill(
        "Updated shared context: the screenshot flow is accepted. Next test sequential execution.",
      );
    await desktop.window.getByRole("button", { name: "Save epic" }).click();
    await expect
      .poll(async () => {
        const s = await request("/state");
        return s.groups.find((g: Epic) => g.id === desktop.epic.id)
          .contextVersion;
      })
      .toBe(2);
    await card.getByRole("button", { name: "Refresh summary" }).click();
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return s.groups.find((g: Epic) => g.id === desktop.epic.id)
            .summaryState;
        },
        { timeout: 180000 },
      )
      .toBe("ready");
    const state = await request("/state");
    const group = state.groups.find((g: Epic) => g.id === desktop.epic.id);
    expect(group.summary.model).toBe("gpt-6-luna");
    expect(group.summary.overview.length).toBeGreaterThan(10);
    await expect(
      card.getByText("Group summary", { exact: false }),
    ).toBeVisible();
    await desktop.window.screenshot({ path: "artifacts/epic-summary.png" });
  });

  test("persists task results and screenshot blobs across a complete application restart", async () => {
    const before = await request("/state");
    const task = before.tasks.find((t: Task) =>
      desktop.nativeTaskId
        ? t.id === desktop.nativeTaskId
        : t.title === screenshotTitle,
    );
    expect(task.reportState).toBe("ready");
    const expectedImage = Buffer.from(
      await (await fetch(origin + task.attachments[0].url)).arrayBuffer(),
    );
    expect(expectedImage.byteLength).toBeGreaterThan(10000);
    await desktop.app.close();
    desktop.app = await launch();
    desktop.window = await desktop.app.firstWindow();
    await expect(desktop.window.locator(".kanban")).toBeVisible();
    const state = await request("/state");
    const restored = state.tasks.find((t: Task) => t.id === task.id);
    expect(restored.report).toEqual(task.report);
    expect(restored.attachments).toEqual(task.attachments);
    const restoredImage = Buffer.from(
      await (await fetch(origin + restored.attachments[0].url)).arrayBuffer(),
    );
    expect(restoredImage.equals(expectedImage)).toBeTruthy();
    expect(
      state.groups.find((g: Epic) => g.id === desktop.epic.id).contextVersion,
    ).toBe(2);
    await expect
      .poll(async () => (await request("/state")).connection.connected)
      .toBeTruthy();
    await desktop.window.screenshot({ path: "artifacts/installed-app.png" });
  });
}
