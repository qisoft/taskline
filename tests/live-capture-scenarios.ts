import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Epic, Evidence, Project, Task } from "../shared/types.js";
import { desktop, origin, request } from "./live-desktop-fixture.js";
export function registerCaptureScenarios() {
  test("native board discovers live T3 projects and registers both capture shortcuts", async () => {
    const state = await request("/state");
    expect(
      state.projects.some((p: Project) => p.title === "Taskline E2E"),
    ).toBeTruthy();
    await expect(
      desktop.window.getByRole("button", { name: "Taskline E2E", exact: true }),
    ).toBeVisible();
    const info = await desktop.window.evaluate(() =>
      globalThis.window.taskline!.desktopInfo(),
    );
    expect(info.textRegistered).toBeTruthy();
    expect(info.screenshotRegistered).toBeTruthy();
    await desktop.window.screenshot({ path: "artifacts/kanban-desktop.png" });
  });
  test("captures actual screen pixels and executes the region attachment in an isolated Luna thread", async () => {
    const baseline = existsSync("artifacts/before-cold-start.json")
      ? JSON.parse(readFileSync("artifacts/before-cold-start.json", "utf8"))
      : null;
    const state = await request("/state");
    if (baseline) {
      for (const id of baseline.taskIds)
        expect(state.tasks.some((t: Task) => t.id === id)).toBeTruthy();
      for (const id of baseline.groupIds)
        expect(state.groups.some((g: Epic) => g.id === id)).toBeTruthy();
    }
    const bounds = await desktop.app.evaluate(({ BrowserWindow, screen }) => {
      const board = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "Taskline",
      );
      const b = board!.getBounds(),
        display = screen.getDisplayMatching(b);
      return {
        x: b.x - display.bounds.x,
        y: b.y - display.bounds.y,
        width: b.width,
        height: b.height,
      };
    });
    const regionPromise = desktop.app.waitForEvent("window");
    await desktop.window.evaluate(() =>
      globalThis.window.taskline!.captureRegion(),
    );
    const region = await regionPromise;
    await expect(region.locator("#screen")).toHaveJSProperty("complete", true);
    await expect
      .poll(() =>
        region
          .locator("#screen")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(1000);
    const dimensions = await region.locator("#screen").evaluate((img) => ({
      width: (img as HTMLImageElement).naturalWidth,
      height: (img as HTMLImageElement).naturalHeight,
    }));
    const popupPromise = desktop.app.waitForEvent("window");
    const x = Math.max(40, bounds.x + 270),
      y = Math.max(100, bounds.y + 100);
    await region.mouse.move(x, y);
    await region.mouse.down();
    await region.mouse.move(x + 550, y + 300, { steps: 12 });
    await region.mouse.up();
    const capture = await popupPromise;
    await expect(capture.getByLabel("Task prompt")).toBeVisible();
    await expect(capture.locator(".attachment-preview img")).toBeVisible();
    const attachment = await capture.evaluate(() =>
      globalThis.window.taskline!.pendingCapture(),
    );
    expect(attachment!.mimeType).toBe("image/png");
    await capture.getByLabel("Epic", { exact: true }).selectOption("");
    const title = "E2E native screen region " + Date.now();
    await capture
      .getByLabel("Task prompt")
      .fill(
        title +
          "\nInspect the attached screen region. Return TASKLINE-REGION-OK and describe what you see. Do not modify files or run commands.",
      );
    await capture
      .getByLabel("Project", { exact: true })
      .selectOption(
        state.projects.find((p: Project) => p.title === "Taskline E2E").id,
      );
    await capture.getByLabel("Thread", { exact: true }).selectOption("");
    await capture
      .getByLabel("Model", { exact: true })
      .selectOption("codex::gpt-6-luna");
    await expect(
      capture.getByRole("button", { name: "Create task" }),
    ).toBeInViewport();
    await capture.screenshot({ path: "artifacts/native-region-capture.png" });
    await capture.getByRole("button", { name: "Create task" }).click();
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return s.tasks.find((t: Task) => t.title === title)?.reportState;
        },
        { timeout: 180000 },
      )
      .toBe("ready");
    const final = await request("/state");
    const task = final.tasks.find((t: Task) => t.title === title);
    desktop.nativeTaskId = task.id;
    expect(task.status).toBe("review");
    expect(task.report.summary.length).toBeGreaterThan(10);
    expect(task.attachments).toHaveLength(1);
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
    const bytes = await fetch(origin + attachment!.url);
    expect(bytes.ok).toBeTruthy();
    expect((await bytes.arrayBuffer()).byteLength).toBeGreaterThan(10000);
    writeFileSync(
      "artifacts/installed-native-e2e.json",
      JSON.stringify(
        {
          installed: !!process.env.TASKLINE_INSTALLED,
          screen: dimensions,
          taskId: task.id,
          threadId: task.threadId,
          workspace: detail.attempts[0].workspace,
          attachment,
          report: task.report,
        },
        null,
        2,
      ),
    );
  });
  test("answers a real pending T3 question from the task drawer", async () => {
    let state = await request("/state");
    const seed = state.tasks.find(
      (t: Task) => t.title === "E2E: live user question",
    );
    expect(seed).toBeTruthy();
    const task = await request("/tasks", {
      title: "E2E live user question " + Date.now(),
      prompt:
        "Use request_user_input now to ask one question: header Test color, id test_color, question Which test color should be recorded?, options Blue and Green. Wait for the user response. Then return the selected color in your final result. Do not change files or run tests. Do not replace the tool call with a prose question.",
      projectId: seed.projectId,
      threadId: seed.threadId,
      model: "gpt-6-luna",
      instanceId: "codex",
    });
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return (
            s.tasks.find((t: Task) => t.id === task.id)?.questions?.length ?? 0
          );
        },
        { timeout: 120000 },
      )
      .toBeGreaterThan(0);
    task.questions = (await request("/state")).tasks.find(
      (t: Task) => t.id === task.id,
    ).questions;
    await desktop.window
      .getByRole("article", { name: task.title, exact: true })
      .click();
    if (task.questions?.length) {
      await expect(
        desktop.window.getByText("T3 needs your input", { exact: true }),
      ).toBeVisible();
      await desktop.window
        .getByLabel("Test color", { exact: true })
        .selectOption("Blue");
      await desktop.window
        .getByRole("button", { name: "Send answer to T3" })
        .click();
      await expect
        .poll(
          async () => {
            const s = await request("/state");
            return s.tasks.find((t: Task) => t.id === task.id).status;
          },
          { timeout: 120000 },
        )
        .toBe("review");
    }
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return s.tasks.find((t: Task) => t.id === task.id).reportState;
        },
        { timeout: 150000 },
      )
      .toBe("ready");
    state = await request("/state");
    expect(
      state.tasks.find((t: Task) => t.id === task.id).report.summary,
    ).toMatch(/Blue|син/i);
    await desktop.window.screenshot({
      path: "artifacts/live-question-result.png",
    });
    await desktop.window.getByRole("button", { name: "Close details" }).click();
  });
}
