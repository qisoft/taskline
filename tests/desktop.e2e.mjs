import { test, expect, _electron as electron } from "@playwright/test";
import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
const origin = "http://127.0.0.1:4318";
const request = async (path, body, method = body ? "POST" : "GET") => {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error);
  return result;
};
const launch = async () => {
  const env = { ...process.env, TASKLINE_E2E: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({
    ...(process.env.TASKLINE_INSTALLED
      ? {
          executablePath: "/Applications/Taskline.app/Contents/MacOS/Taskline",
          args: [],
        }
      : { args: ["electron/main.cjs"] }),
    env,
    timeout: 30000,
  });
};
let app, window, epic, nativeTaskId;
const epicName = "E2E Capture Epic " + Date.now();
const screenshotTitle = "E2E screenshot task " + Date.now();
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  mkdirSync("artifacts", { recursive: true });
  app = await launch();
  window = await app.firstWindow();
  await expect(window.locator(".kanban")).toBeVisible();
});
test.afterAll(async () => {
  await app?.close();
});
test("native board discovers live T3 projects and registers both capture shortcuts", async () => {
  const state = await request("/state");
  expect(state.projects.some((p) => p.title === "Taskline E2E")).toBeTruthy();
  await expect(
    window.getByRole("button", { name: "Taskline E2E", exact: true }),
  ).toBeVisible();
  const info = await window.evaluate(() => window.taskline.desktopInfo());
  expect(info.textRegistered).toBeTruthy();
  expect(info.screenshotRegistered).toBeTruthy();
  await window.screenshot({ path: "artifacts/kanban-desktop.png" });
});
test("captures actual screen pixels and executes the region attachment in an isolated Luna thread", async () => {
  const baseline = existsSync("artifacts/before-cold-start.json")
    ? JSON.parse(readFileSync("artifacts/before-cold-start.json", "utf8"))
    : null;
  const state = await request("/state");
  if (baseline) {
    for (const id of baseline.taskIds)
      expect(state.tasks.some((t) => t.id === id)).toBeTruthy();
    for (const id of baseline.groupIds)
      expect(state.groups.some((g) => g.id === id)).toBeTruthy();
  }
  const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const board = BrowserWindow.getAllWindows().find(
      (w) => w.getTitle() === "Taskline",
    );
    const b = board.getBounds(),
      display = screen.getDisplayMatching(b);
    return {
      x: b.x - display.bounds.x,
      y: b.y - display.bounds.y,
      width: b.width,
      height: b.height,
    };
  });
  const regionPromise = app.waitForEvent("window");
  await window.evaluate(() => window.taskline.captureRegion());
  const region = await regionPromise;
  await expect(region.locator("#screen")).toHaveJSProperty("complete", true);
  await expect
    .poll(() => region.locator("#screen").evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(1000);
  const dimensions = await region
    .locator("#screen")
    .evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  const popupPromise = app.waitForEvent("window");
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
    window.taskline.pendingCapture(),
  );
  expect(attachment.mimeType).toBe("image/png");
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
    .selectOption(state.projects.find((p) => p.title === "Taskline E2E").id);
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
        return s.tasks.find((t) => t.title === title)?.reportState;
      },
      { timeout: 180000 },
    )
    .toBe("ready");
  const final = await request("/state");
  const task = final.tasks.find((t) => t.title === title);
  nativeTaskId = task.id;
  expect(task.status).toBe("review");
  expect(task.report.summary).toMatch(/TASKLINE-REGION-OK/);
  expect(task.attachments).toHaveLength(1);
  const detail = await request("/tasks/" + task.id);
  expect(detail.attempts[0].workspace).toContain("/worktrees/");
  const bytes = await fetch(origin + attachment.url);
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
  const seed = state.tasks.find((t) => t.title === "E2E: live user question");
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
        return s.tasks.find((t) => t.id === task.id)?.questions?.length ?? 0;
      },
      { timeout: 120000 },
    )
    .toBeGreaterThan(0);
  task.questions = (await request("/state")).tasks.find(
    (t) => t.id === task.id,
  ).questions;
  await window.getByRole("article", { name: task.title, exact: true }).click();
  if (task.questions?.length) {
    await expect(
      window.getByText("T3 needs your input", { exact: true }),
    ).toBeVisible();
    await window.getByLabel("Test color", { exact: true }).selectOption("Blue");
    await window.getByRole("button", { name: "Send answer to T3" }).click();
    await expect
      .poll(
        async () => {
          const s = await request("/state");
          return s.tasks.find((t) => t.id === task.id).status;
        },
        { timeout: 120000 },
      )
      .toBe("review");
  }
  await expect
    .poll(
      async () => {
        const s = await request("/state");
        return s.tasks.find((t) => t.id === task.id).reportState;
      },
      { timeout: 150000 },
    )
    .toBe("ready");
  state = await request("/state");
  expect(state.tasks.find((t) => t.id === task.id).report.summary).toMatch(
    /Blue|син/i,
  );
  await window.screenshot({ path: "artifacts/live-question-result.png" });
  await window.getByRole("button", { name: "Close details" }).click();
});
test("creates an epic and a screenshot task through the native quick composer", async () => {
  await window.getByRole("button", { name: /^Epics/ }).click();
  await window.getByRole("button", { name: "New epic", exact: true }).click();
  await window.getByLabel("Epic name").fill(epicName);
  await window
    .getByLabel("Shared context")
    .fill(
      "This is a disposable integration test. Never modify another project. Return TASKLINE-E2E in results.",
    );
  await window
    .getByLabel("Acceptance criteria")
    .fill("Screenshots reach T3 and results return to the correct card.");
  await window.getByRole("button", { name: "Save epic" }).click();
  await expect(window.getByRole("dialog", { name: "New epic" })).toBeHidden();
  const state = await request("/state");
  epic = state.groups.find((g) => g.name === epicName);
  expect(epic.contextVersion).toBe(1);
  const capturePromise = app.waitForEvent("window");
  await window.evaluate(() => window.taskline.captureText());
  const capture = await capturePromise;
  await expect(capture.getByLabel("Task prompt")).toBeVisible();
  await capture
    .getByLabel("Task prompt")
    .fill(
      screenshotTitle +
        "\nInspect the attached screenshot. Return TASKLINE-SCREENSHOT-OK and briefly describe visible interface elements. Do not change files. Testing was not run because this is an image input test.",
    );
  const project = state.projects.find((p) => p.title === "Taskline E2E");
  await capture.getByLabel("Project", { exact: true }).selectOption(project.id);
  await capture.getByLabel("Thread", { exact: true }).selectOption("");
  await capture.getByLabel("Epic", { exact: true }).selectOption(epic.id);
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
        return s.tasks.find((t) => t.title === screenshotTitle)?.status;
      },
      { timeout: 150000 },
    )
    .toBe("review");
  await expect
    .poll(
      async () => {
        const s = await request("/state");
        return s.tasks.find((t) => t.title === screenshotTitle)?.reportState;
      },
      { timeout: 150000 },
    )
    .toBe("ready");
  const final = await request("/state");
  const task = final.tasks.find((t) => t.title === screenshotTitle);
  expect(task.attachments).toHaveLength(1);
  expect(task.groupId).toBe(epic.id);
  expect(task.report.summary).toMatch(/TASKLINE-SCREENSHOT-OK/);
  const detail = await request("/tasks/" + task.id);
  expect(detail.attempts[0].workspace).toContain("/worktrees/");
  expect(detail.attempts[0].compiledPrompt).toContain("TASKLINE-E2E");
  expect(detail.attempts[0].contextVersion).toBe(1);
  await window.getByRole("button", { name: "My tasks", exact: false }).click();
  await window
    .getByRole("article", { name: screenshotTitle, exact: true })
    .click();
  await expect(window.locator(".detail-image")).toBeVisible();
  await window.screenshot({ path: "artifacts/screenshot-task-review.png" });
  await window.getByRole("button", { name: "Accept result" }).click();
  await expect
    .poll(async () => {
      const s = await request("/state");
      return s.tasks.find((t) => t.id === task.id).status;
    })
    .toBe("done");
  await window.getByRole("button", { name: "Close details" }).click();
});
test("epic context edits are versioned and group summaries are produced by Luna", async () => {
  await window.getByRole("button", { name: /^Epics/ }).click();
  const card = window.locator(".epic-card").filter({ hasText: epicName });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await window
    .getByLabel("Shared context")
    .fill(
      "Updated shared context: the screenshot flow is accepted. Next test sequential execution.",
    );
  await window.getByRole("button", { name: "Save epic" }).click();
  await expect
    .poll(async () => {
      const s = await request("/state");
      return s.groups.find((g) => g.id === epic.id).contextVersion;
    })
    .toBe(2);
  await card.getByRole("button", { name: "Refresh summary" }).click();
  await expect
    .poll(
      async () => {
        const s = await request("/state");
        return s.groups.find((g) => g.id === epic.id).summaryState;
      },
      { timeout: 180000 },
    )
    .toBe("ready");
  const state = await request("/state");
  const group = state.groups.find((g) => g.id === epic.id);
  expect(group.summary.model).toBe("gpt-6-luna");
  expect(group.summary.overview.length).toBeGreaterThan(10);
  await expect(card.getByText("Group summary", { exact: false })).toBeVisible();
  await window.screenshot({ path: "artifacts/epic-summary.png" });
});

test("persists task results and screenshot blobs across a complete application restart", async () => {
  const before = await request("/state");
  const task = before.tasks.find((t) =>
    nativeTaskId ? t.id === nativeTaskId : t.title === screenshotTitle,
  );
  expect(task.reportState).toBe("ready");
  const expectedImage = Buffer.from(
    await (await fetch(origin + task.attachments[0].url)).arrayBuffer(),
  );
  expect(expectedImage.byteLength).toBeGreaterThan(10000);
  await app.close();
  app = await launch();
  window = await app.firstWindow();
  await expect(window.locator(".kanban")).toBeVisible();
  const state = await request("/state");
  const restored = state.tasks.find((t) => t.id === task.id);
  expect(restored.report).toEqual(task.report);
  expect(restored.attachments).toEqual(task.attachments);
  const restoredImage = Buffer.from(
    await (await fetch(origin + restored.attachments[0].url)).arrayBuffer(),
  );
  expect(restoredImage.equals(expectedImage)).toBeTruthy();
  expect(state.groups.find((g) => g.id === epic.id).contextVersion).toBe(2);
  await expect
    .poll(async () => (await request("/state")).connection.connected)
    .toBeTruthy();
  await window.screenshot({ path: "artifacts/installed-app.png" });
});
