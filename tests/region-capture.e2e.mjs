import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let app, board, directory;
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "taskline-region-"));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = {
    ...process.env,
    TASKLINE_E2E: "1",
    TASKLINE_DATA_DIR: directory,
    TASKLINE_PORT: String(port),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath:
      process.env.TASKLINE_TEST_APP ||
      "/Applications/Taskline.app/Contents/MacOS/Taskline",
    args: ["--user-data-dir=" + join(directory, "electron")],
    env,
  });
  board = await app.firstWindow();
  await expect(board.locator(".kanban")).toBeVisible();
});
test.afterAll(async () => {
  await app?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
async function geometry() {
  return app.evaluate(async ({ BrowserWindow, screen }) => ({
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    })),
    overlays: await Promise.all(
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().endsWith("/region.html"))
        .map(async (w) => ({
          id: w.id,
          bounds: w.getBounds(),
          contentBounds: w.getContentBounds(),
          viewport: await w.webContents.executeJavaScript(
            "({width:innerWidth,height:innerHeight})",
          ),
        })),
    ),
  }));
}
async function cancel() {
  await board.evaluate(() => window.taskline.cancelRegion());
}
test("capture overlay covers full display bounds including the left Dock and menu bar", async () => {
  try {
    await board.evaluate(() => window.taskline.captureRegion());
    const state = await geometry();
    mkdirSync("artifacts", { recursive: true });
    writeFileSync(
      "artifacts/region-geometry.json",
      JSON.stringify(state, null, 2),
    );
    expect(state.overlays.length).toBeGreaterThan(0);
    for (const overlay of state.overlays) {
      const display = state.displays.find(
        (d) =>
          d.bounds.x === overlay.bounds.x && d.bounds.y === overlay.bounds.y,
      );
      expect(
        display,
        "overlay must start at the display origin, not the Dock inset",
      ).toBeTruthy();
      expect(overlay.bounds).toEqual(display.bounds);
      expect(overlay.contentBounds).toEqual(display.bounds);
      expect(overlay.viewport).toEqual({
        width: display.bounds.width,
        height: display.bounds.height,
      });
    }
  } finally {
    await cancel();
  }
});
test("capture selection is available on every connected monitor and crops its actual pixels", async () => {
  const displays = (await geometry()).displays;
  expect(
    displays.length,
    "this regression requires the user's multi-monitor setup",
  ).toBeGreaterThan(1);
  for (const selected of displays) {
    await board.evaluate(() => window.taskline.captureRegion());
    const state = await geometry();
    expect(state.overlays).toHaveLength(displays.length);
    const match = state.overlays.find(
      (o) =>
        o.bounds.x === selected.bounds.x && o.bounds.y === selected.bounds.y,
    );
    expect(match).toBeTruthy();
    // Match Playwright's page to its native display window without changing focus or cursor.
    let region;
    for (const candidate of app.windows()) {
      if (!candidate.url().endsWith("/region.html")) continue;
      const id = await (
        await app.browserWindow(candidate)
      ).evaluate((w) => w.id);
      if (id === match.id) region = candidate;
    }
    await expect(region.locator("#screen")).toHaveJSProperty("complete", true);
    await expect
      .poll(() => region.locator("#screen").evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    const dataURL = await region.locator("#screen").getAttribute("src");
    const imageSize = await region.locator("#screen").evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    expect(imageSize.width / imageSize.height).toBeCloseTo(
      selected.bounds.width / selected.bounds.height,
      2,
    );
    expect(imageSize).toEqual({
      width: Math.round(selected.bounds.width * selected.scaleFactor),
      height: Math.round(selected.bounds.height * selected.scaleFactor),
    });
    const expectedCrop = await app.evaluate(
      ({ nativeImage }, { dataURL, imageSize, bounds }) =>
        nativeImage
          .createFromDataURL(dataURL)
          .crop({
            x: Math.round((2 * imageSize.width) / bounds.width),
            y: Math.round((2 * imageSize.height) / bounds.height),
            width: Math.round((120 * imageSize.width) / bounds.width),
            height: Math.round((90 * imageSize.height) / bounds.height),
          })
          .toPNG()
          .toString("base64"),
      { dataURL, imageSize, bounds: selected.bounds },
    );
    const popupPromise = app.waitForEvent("window");
    await region.mouse.move(2, 2);
    await region.mouse.down();
    await region.mouse.move(122, 92, { steps: 4 });
    await region.mouse.up();
    const capture = await popupPromise;
    await expect(capture.getByLabel("Task prompt")).toBeVisible();
    const attachment = await capture.evaluate(() =>
      window.taskline.pendingCapture(),
    );
    await expect
      .poll(() =>
        capture
          .locator(".attachment-preview img")
          .evaluate((img) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const actualCrop = await capture.evaluate(
      async (url) =>
        Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
      attachment.url,
    );
    expect(
      Buffer.from(actualCrop).equals(Buffer.from(expectedCrop, "base64")),
    ).toBeTruthy();
    const captureBounds = await (
      await app.browserWindow(capture)
    ).evaluate((w) => w.getBounds());
    expect(captureBounds.x).toBeGreaterThanOrEqual(selected.bounds.x);
    expect(captureBounds.x + captureBounds.width).toBeLessThanOrEqual(
      selected.bounds.x + selected.bounds.width,
    );
    const size = await capture
      .locator(".attachment-preview img")
      .evaluate((img) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
    expect(size.width).toBe(
      Math.round((120 * imageSize.width) / selected.bounds.width),
    );
    expect(size.height).toBe(
      Math.round((90 * imageSize.height) / selected.bounds.height),
    );
    expect((await geometry()).overlays).toHaveLength(0);
    await capture.getByRole("button", { name: "Close", exact: true }).click();
    mkdirSync("artifacts", { recursive: true });
    writeFileSync(
      "artifacts/region-monitor-" + selected.id + ".json",
      JSON.stringify(
        { display: selected, imageSize, crop: size, attachment },
        null,
        2,
      ),
    );
  }
});

test("Escape closes all monitor overlays and repeated capture does not duplicate them", async () => {
  await Promise.all([
    board.evaluate(() => window.taskline.captureRegion()),
    board.evaluate(() => window.taskline.captureRegion()),
  ]);
  const state = await geometry();
  expect(state.overlays).toHaveLength(state.displays.length);
  const region = app.windows().find((w) => w.url().endsWith("/region.html"));
  await region.keyboard.press("Escape").catch((error) => {
    // Escape can destroy the native window before Playwright sends keyup.
    if (!region.isClosed()) throw error;
  });
  await expect.poll(async () => (await geometry()).overlays.length).toBe(0);
  expect(
    await board.evaluate(
      async () => (await (await fetch("/api/state")).json()).tasks.length,
    ),
  ).toBe(0);
});
