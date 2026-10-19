import { createServer } from "node:http";
import { test, expect, _electron as electron } from "@playwright/test";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  rmSync,
} from "node:fs";
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
      : { args: ["build/electron/main.cjs"] }),
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
  const dimensions = await region.locator("#screen").evaluate((img) => ({
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
  expect(task.report.summary.length).toBeGreaterThan(10);
  expect(task.attachments).toHaveLength(1);
  const detail = await request("/tasks/" + task.id);
  expect(
    detail.attempts[0].evidence
      .filter((i) => ["assistant", "assistant_message"].includes(i.type))
      .map((i) => i.text)
      .join("\n"),
  ).toMatch(/TASKLINE-(?:REGION|SCREENSHOT)-OK/);
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
  expect(task.report.summary.length).toBeGreaterThan(10);
  const detail = await request("/tasks/" + task.id);
  expect(
    detail.attempts[0].evidence
      .filter((i) => ["assistant", "assistant_message"].includes(i.type))
      .map((i) => i.text)
      .join("\n"),
  ).toMatch(/TASKLINE-(?:REGION|SCREENSHOT)-OK/);
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

test("project configuration persists and disabling automatic execution holds a new card on the board", async () => {
  const initial = await request("/state");
  const project = initial.projects.find((p) => p.title === "Taskline E2E");
  const policy = (state) =>
    state.projectSettings.find(
      (p) => p.id === project.id || p.id === "project:" + project.id,
    );
  const original = policy(initial);
  let taskId;
  try {
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    let dialog = window.getByRole("dialog", { name: "Settings", exact: true });
    let projectRow = dialog
      .locator(".project-setting")
      .filter({ hasText: project.title });
    await projectRow.getByRole("checkbox").uncheck();
    await expect
      .poll(async () => policy(await request("/state")).autoStart)
      .toBe(false);
    await dialog.getByLabel("Parallel tasks for " + project.title).fill("3");
    await dialog.getByLabel("Parallel tasks for " + project.title).press("Tab");
    await expect
      .poll(async () => policy(await request("/state")).concurrencyLimit)
      .toBe(3);
    await expect(
      dialog.getByLabel("Base branch for " + project.title),
    ).toHaveValue(original.baseRef);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    const title = "E2E project policy pause " + Date.now();
    await window.getByRole("button", { name: "New task", exact: true }).click();
    const composer = window.getByRole("dialog", {
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
      window
        .locator(".column-todo")
        .getByRole("article", { name: title, exact: true }),
    ).toBeVisible();
    taskId = (await request("/state")).tasks.find((t) => t.title === title).id;

    await app.close();
    app = await launch();
    window = await app.firstWindow();
    await expect(window.locator(".kanban")).toBeVisible();
    const restored = await request("/state");
    expect(policy(restored).concurrencyLimit).toBe(3);
    expect(policy(restored).autoStart).toBe(false);
    expect(restored.tasks.find((t) => t.id === taskId).status).toBe("todo");
    expect((await request("/tasks/" + taskId)).attempts).toHaveLength(0);
    await window.getByRole("button", { name: "Settings", exact: true }).click();
    dialog = window.getByRole("dialog", { name: "Settings", exact: true });
    projectRow = dialog
      .locator(".project-setting")
      .filter({ hasText: project.title });
    await expect(
      dialog.getByLabel("Parallel tasks for " + project.title),
    ).toHaveValue("3");
    await expect(projectRow.getByRole("checkbox")).not.toBeChecked();
    await window.screenshot({ path: "artifacts/project-policy-settings.png" });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await window.getByRole("article", { name: title, exact: true }).click();
    await expect(
      window.getByRole("dialog", { name: "Task details" }),
    ).toBeVisible();
    await window.screenshot({
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
    const closeDetails = window.getByRole("button", {
      name: "Close details",
      exact: true,
    });
    if (await closeDetails.isVisible()) await closeDetails.click();
    if (taskId)
      await request("/tasks/" + taskId + "/cancel", {}).catch(() => {});
    await request(
      "/projects/" + encodeURIComponent(project.id),
      {
        concurrencyLimit: original.concurrencyLimit,
        autoStart: original.autoStart,
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
  await new Promise((resolve) => imageServer.listen(0, "127.0.0.1", resolve));
  const imageUrl =
    "http://127.0.0.1:" + imageServer.address().port + "/agent-proof.png";
  const stopServer = () =>
    new Promise((resolve) => {
      imageServer.close(resolve);
      imageServer.closeAllConnections();
    });
  let stopped = false;
  try {
    const state = await request("/state");
    const project = state.projects.find((p) => p.title === "Taskline E2E");
    const popupPromise = app.waitForEvent("window");
    await window.evaluate(() => window.taskline.captureText());
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
    const group = (await request("/state")).groups.find((g) => g.name === name);
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
          (await request("/state")).tasks.find((t) => t.title === title)
            ?.reportState,
        { timeout: 180000 },
      )
      .toBe("ready");
    const task = (await request("/state")).tasks.find((t) => t.title === title);
    expect(task.status).toBe("review");
    expect(task.groupId).toBe(group.id);
    expect(task.validationImages).toHaveLength(1);
    const image = task.validationImages[0];
    expect(image.sources.some((s) => s.kind === "file")).toBeTruthy();
    expect(image.sources.some((s) => s.reference === imageUrl)).toBeTruthy();
    expect(
      Buffer.from(await (await fetch(origin + image.url)).arrayBuffer()).equals(
        bytes,
      ),
    ).toBeTruthy();
    const detail = await request("/tasks/" + task.id);
    expect(detail.attempts[0].contextVersion).toBe(1);
    expect(detail.attempts[0].compiledPrompt).toContain(group.context);
    await window
      .getByRole("button", { name: "My tasks", exact: false })
      .click();
    await window.getByRole("article", { name: title, exact: true }).click();
    const checks = window.locator(".detail-section").filter({
      has: window.getByRole("heading", {
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
          .evaluate((img) => img.naturalWidth),
      )
      .toBeGreaterThan(100);
    await window.screenshot({
      path: "artifacts/result-validation-gallery.png",
    });
    const workspace = detail.attempts[0].workspace;
    const ownedSource = image.sources.find(
      (s) =>
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
    await app.close();
    app = await launch();
    window = await app.firstWindow();
    await expect(window.locator(".kanban")).toBeVisible();
    const restored = (await request("/state")).tasks.find(
      (t) => t.id === task.id,
    );
    expect(restored.validationImages).toEqual(task.validationImages);
    expect(restored.report).toEqual(task.report);
    expect(
      Buffer.from(await (await fetch(origin + image.url)).arrayBuffer()).equals(
        bytes,
      ),
    ).toBeTruthy();
    await window.getByRole("article", { name: title, exact: true }).click();
    await expect(window.locator(".validation-gallery img")).toBeVisible();
    await window
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
