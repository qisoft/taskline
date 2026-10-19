import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tcpPort } from "./helpers.js";
let app: ElectronApplication, board: Page, directory: string;
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "taskline-region-"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = tcpPort(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const env: Record<string, string> = {
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
  if (process.env.TASKLINE_CAPTURE_FIXTURE) {
    // Hosted CI has no screen-recording grant. Exercise native overlays, input
    // and cropping with deterministic pixels on each runner display.
    await app.evaluate(({ desktopCapturer, screen, nativeImage }) => {
      desktopCapturer.getSources = async () =>
        screen.getAllDisplays().map((display) => {
          const width = Math.round(display.bounds.width * display.scaleFactor);
          const height = Math.round(
            display.bounds.height * display.scaleFactor,
          );
          const pixels = Buffer.alloc(width * height * 4);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const offset = (y * width + x) * 4;
              pixels[offset] = x % 256;
              pixels[offset + 1] = y % 256;
              pixels[offset + 2] = (x + y) % 256;
              pixels[offset + 3] = 255;
            }
          return {
            id: "screen:" + display.id,
            name: "CI capture fixture",
            display_id: String(display.id),
            thumbnail: nativeImage.createFromBitmap(pixels, { width, height }),
            appIcon: nativeImage.createEmpty(),
          };
        });
    });
  }
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
  await board.evaluate(() => globalThis.window.taskline!.cancelRegion());
}
test("capture overlay covers full display bounds including the left Dock and menu bar", async () => {
  try {
    await board.evaluate(() => globalThis.window.taskline!.captureRegion());
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
      expect(overlay.bounds).toEqual(display!.bounds);
      expect(overlay.contentBounds).toEqual(display!.bounds);
      expect(overlay.viewport).toEqual({
        width: display!.bounds.width,
        height: display!.bounds.height,
      });
    }
  } finally {
    await cancel();
  }
});
test("capture selection is available on every connected monitor and crops its actual pixels", async () => {
  const displays = (await geometry()).displays;
  if (process.env.TASKLINE_CAPTURE_FIXTURE)
    expect(displays.length).toBeGreaterThanOrEqual(1);
  else
    expect(
      displays.length,
      "this regression requires a separate multi-monitor test environment",
    ).toBeGreaterThan(1);
  for (const selected of displays) {
    await board.evaluate(() => globalThis.window.taskline!.captureRegion());
    const state = await geometry();
    expect(state.overlays).toHaveLength(displays.length);
    const match = state.overlays.find(
      (o) =>
        o.bounds.x === selected.bounds.x && o.bounds.y === selected.bounds.y,
    );
    expect(match).toBeTruthy();
    // Match Playwright's page to its native display window without changing focus or cursor.
    let region: Page | undefined;
    for (const candidate of app.windows()) {
      if (!candidate.url().endsWith("/region.html")) continue;
      const id = await (
        await app.browserWindow(candidate)
      ).evaluate((w) => w.id);
      if (id === match!.id) region = candidate;
    }
    await expect(region!.locator("#screen")).toHaveJSProperty("complete", true);
    await expect
      .poll(() =>
        region!
          .locator("#screen")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const dataURL = await region!.locator("#screen").getAttribute("src");
    const imageSize = await region!.locator("#screen").evaluate((img) => ({
      width: (img as HTMLImageElement).naturalWidth,
      height: (img as HTMLImageElement).naturalHeight,
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
          .createFromDataURL(dataURL!)
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
    await region!.mouse.move(2, 2);
    await region!.mouse.down();
    await region!.mouse.move(122, 92, { steps: 4 });
    await region!.mouse.up();
    const capture = await popupPromise;
    await expect(capture.getByLabel("Task prompt")).toBeVisible();
    const attachment = await capture.evaluate(() =>
      globalThis.window.taskline!.pendingCapture(),
    );
    await expect
      .poll(() =>
        capture
          .locator(".attachment-preview img")
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const actualCrop = await capture.evaluate(
      async (url) =>
        Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
      attachment!.url,
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
        width: (img as HTMLImageElement).naturalWidth,
        height: (img as HTMLImageElement).naturalHeight,
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
  const nextRegion = app.waitForEvent("window");
  await Promise.all([
    board.evaluate(() => globalThis.window.taskline!.captureRegion()),
    board.evaluate(() => globalThis.window.taskline!.captureRegion()),
  ]);
  const state = await geometry();
  expect(state.overlays).toHaveLength(state.displays.length);
  // Old pages can remain in Playwright's window list while their native
  // windows are closing. Send input to a window from this capture only.
  const region = await nextRegion;
  await region.waitForLoadState("load");
  await (
    await app.browserWindow(region)
  ).evaluate((window) => {
    window.show();
    window.focus();
    window.webContents.focus();
  });
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
