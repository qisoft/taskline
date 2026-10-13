import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:net";
import { deflateSync } from "node:zlib";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";

let app, window, directory, imagePath;
const title = "Image viewer fixture";
function fixturePng(width, height) {
  const chunk = (type, bytes) => {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, bytes])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, name, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const pixels = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels[y * (width + 1) + x + 1] =
        (Math.floor(x / 100) + Math.floor(y / 100)) % 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from([34, 40, 70, 110, 112, 230])),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const png = fixturePng(1800, 1200);
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "taskline-viewer-"));
  imagePath = join(directory, "composer.png");
  writeFileSync(imagePath, png);
  const store = new Store(directory);
  const input = store.saveImage(png.toString("base64"), "Input screenshot.png");
  const output = {
    ...store.saveImage(png.toString("base64"), "Result screenshot.png"),
    sources: [{ reference: "fixture.png", kind: "file", evidenceIds: [] }],
  };
  const report = {
    summary: "Local UI fixture; no agent task was launched.",
    changes: [],
    questions: [],
    validation: [],
    remainingWork: [],
  };
  const now = new Date().toISOString();
  store.put("tasks", {
    id: "viewer-fixture",
    title,
    prompt: "View the fixture screenshot.",
    projectId: "fixture",
    status: "review",
    createdAt: now,
    updatedAt: now,
    attachments: [input],
    validationImages: [output],
    validationImageIssues: [],
    questions: [],
    currentAttemptId: "viewer-attempt",
    report,
    reportState: "ready",
  });
  store.put("attempts", {
    id: "viewer-attempt",
    taskId: "viewer-fixture",
    state: "completed",
    createdAt: now,
    completedAt: now,
    reportState: "ready",
    validationArtifactsCollectedAt: now,
    validationImages: [output],
    result: report,
    evidence: [],
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
  app = await electron.launch({
    ...(process.env.TASKLINE_TEST_APP || process.env.TASKLINE_INSTALLED
      ? {
          executablePath:
            process.env.TASKLINE_TEST_APP ||
            "/Applications/Taskline.app/Contents/MacOS/Taskline",
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
  window = await app.firstWindow();
  await expect(window.locator(".kanban")).toBeVisible();
  await app.evaluate(({ shell }) => {
    globalThis.externalUrls = [];
    shell.openExternal = async (url) => {
      globalThis.externalUrls.push(url);
    };
  });
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
const viewer = (page) =>
  page.getByRole("dialog", { name: "Image viewer", exact: true });
const assertNoBrowser = async () =>
  expect(await app.evaluate(() => globalThis.externalUrls)).toEqual([]);

test("opens board and task attachments in-app, supports zoom, Escape, focus return and backdrop close", async () => {
  const card = window.getByRole("article", { name: title, exact: true });
  const thumbnail = card.getByRole("button", {
    name: "View image: Input screenshot.png",
    exact: true,
  });
  await thumbnail.focus();
  await thumbnail.press("Enter");
  await expect(viewer(window)).toBeVisible();
  await expect(
    window.getByRole("dialog", { name: "Task details" }),
  ).toHaveCount(0);
  await expect(viewer(window).getByRole("img")).toHaveJSProperty(
    "naturalWidth",
    1800,
  );
  await viewer(window)
    .getByRole("button", { name: "View image at actual size" })
    .click();
  expect(
    await viewer(window)
      .getByRole("img")
      .evaluate((img) => img.getBoundingClientRect().width),
  ).toBe(1800);
  await viewer(window)
    .getByRole("button", { name: "Fit image to window" })
    .click();
  expect(
    await viewer(window)
      .getByRole("img")
      .evaluate((img) => img.getBoundingClientRect().width),
  ).toBeLessThan(1800);
  await window.keyboard.press("Escape");
  await expect(viewer(window)).toBeHidden();
  await expect(thumbnail).toBeFocused();
  await card.getByRole("heading", { name: title }).click();
  const detail = window.getByRole("dialog", { name: "Task details" });
  await detail
    .getByRole("button", { name: "View image: Input screenshot.png" })
    .click();
  await expect(viewer(window)).toBeVisible();
  await expect(window.locator("#root")).toHaveJSProperty("inert", true);
  await window.keyboard.press("Escape");
  await expect(viewer(window)).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(window.locator("#root")).toHaveJSProperty("inert", false);
  await detail
    .getByRole("button", { name: "View image: Input screenshot.png" })
    .click();
  await window.mouse.click(8, 8);
  await expect(viewer(window)).toBeHidden();
  await expect(detail).toBeVisible();
  expect(app.windows()).toHaveLength(1);
  await assertNoBrowser();
});

test("opens current validation screenshots and attempt history in the same viewer", async () => {
  const detail = window.getByRole("dialog", { name: "Task details" });
  await detail
    .getByRole("button", { name: "View image: Result screenshot.png" })
    .click();
  await expect(
    viewer(window).getByRole("img", { name: "Result screenshot.png" }),
  ).toHaveJSProperty("naturalWidth", 1800);
  await viewer(window)
    .getByRole("button", { name: "Close image viewer" })
    .click();
  await detail.getByRole("button", { name: /Attempts/ }).click();
  await detail
    .getByRole("button", { name: "View image: Result screenshot.png" })
    .click();
  await expect(viewer(window)).toBeVisible();
  await window.keyboard.press("Tab");
  await expect(
    viewer(window).getByRole("button", { name: "View image at actual size" }),
  ).toBeFocused();
  await window.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await window.getByRole("button", { name: "Close details" }).click();
  await assertNoBrowser();
});

test("previews attachments in board and global capture composers without losing their draft", async () => {
  await window.getByRole("button", { name: "New task", exact: true }).click();
  const composer = window.getByRole("dialog", {
    name: "New task",
    exact: true,
  });
  await composer.getByLabel("Task prompt").fill("Keep this draft");
  await composer.getByLabel("Attach screenshot").setInputFiles(imagePath);
  await composer
    .getByRole("button", { name: "View image: composer.png" })
    .click();
  await expect(viewer(window)).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(composer.getByLabel("Task prompt")).toHaveValue(
    "Keep this draft",
  );
  await composer.getByRole("button", { name: "Remove attachment" }).click();
  await expect(composer.locator(".attachment-preview")).toHaveCount(0);
  await composer.getByRole("button", { name: "Close", exact: true }).click();
  const popupPromise = app.waitForEvent("window");
  await window.evaluate(() => window.taskline.captureText());
  const capture = await popupPromise;
  await capture.getByLabel("Task prompt").fill("Keep the global capture draft");
  await capture.getByLabel("Attach screenshot").setInputFiles(imagePath);
  await capture
    .getByRole("button", { name: "View image: composer.png" })
    .click();
  await expect(viewer(capture)).toBeVisible();
  await capture.keyboard.press("Escape");
  await expect(viewer(capture)).toBeHidden();
  await expect(capture.getByLabel("Task prompt")).toHaveValue(
    "Keep the global capture draft",
  );
  await expect(capture.locator(".attachment-preview img")).toBeVisible();
  await capture.getByRole("button", { name: "Close", exact: true }).click();
  await assertNoBrowser();
});
