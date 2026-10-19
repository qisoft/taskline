import { seed } from "./helpers.js";
import { tcpPort } from "./helpers.js";
import type { ElectronApplication, Page } from "@playwright/test";
import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";

// This fixture launches no T3 connection or provider. It verifies native OS
// shortcut registration and invokes the exact registered callback, not a keypress.
test("board shortcut and Dock preference apply immediately and survive relaunch", async ({}, testInfo) => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-board-access-"));
  const originalShortcut = "Control+Alt+Shift+F8";
  const textShortcut = "Control+Alt+Shift+F9";
  const store = new Store(directory);
  seed(store, "settings", {
    id: "app",
    boardShortcut: originalShortcut,
    textShortcut,
    screenshotShortcut: "Control+Alt+Shift+F10",
  });
  store.close();
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const port = tcpPort(listener);
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const origin = "http://127.0.0.1:" + port;
  const executable =
    process.env.TASKLINE_TEST_APP ||
    "/Applications/Taskline.app/Contents/MacOS/Taskline";
  const env: Record<string, string> = {
    ...process.env,
    TASKLINE_E2E: "1",
    TASKLINE_DATA_DIR: directory,
    TASKLINE_PORT: String(port),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TASKLINE_UI_ORIGIN;
  const launch = () =>
    electron.launch({
      executablePath: executable,
      args: ["--user-data-dir=" + join(directory, "electron")],
      env,
    });
  let app!: ElectronApplication;
  const state = async () => await (await fetch(origin + "/api/state")).json();
  const openSettings = async (page: Page) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    return page.getByRole("dialog", { name: "Settings", exact: true });
  };
  const boardState = () =>
    app.evaluate(({ BrowserWindow, app }) => {
      const board = BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === "Taskline",
      );
      return {
        id: board!.id,
        visible: board!.isVisible(),
        minimized: board!.isMinimized(),
        focused: board!.isFocused(),
        dock: app.dock!.isVisible(),
      };
    });
  try {
    app = await launch();
    let page = await app.firstWindow();
    await expect(page.locator(".kanban")).toBeVisible();
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    const initial = await page.evaluate(() =>
      globalThis.window.taskline!.desktopInfo(),
    );
    expect(initial.boardRegistered).toBe(true);
    expect(initial.textRegistered).toBe(true);
    expect(initial.screenshotRegistered).toBe(true);
    expect(initial.dockVisible).toBe(true);
    expect((await state()).settings.boardShortcut).toBe(originalShortcut);
    await app.evaluate(({ globalShortcut }) => {
      const register = globalShortcut.register.bind(globalShortcut);
      globalThis.registeredBoardCallbacks = new Map();
      globalShortcut.register = (key, callback) => {
        const accepted = register(key, callback);
        if (accepted) globalThis.registeredBoardCallbacks.set(key, callback);
        return accepted;
      };
    });
    let settings = await openSettings(page);
    await settings
      .getByLabel("Board shortcut", { exact: true })
      .fill(textShortcut);
    await settings
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(settings).toBeVisible();
    await expect(
      page.getByText("Text shortcut is already used or empty", {
        exact: false,
      }),
    ).toBeVisible();
    expect((await state()).settings.boardShortcut).toBe(originalShortcut);
    expect(
      (await page.evaluate(() => globalThis.window.taskline!.desktopInfo()))
        .boardRegistered,
    ).toBe(true);
    expect(
      (await page.evaluate(() => globalThis.window.taskline!.desktopInfo()))
        .textRegistered,
    ).toBe(true);
    const shortcut = "Control+Alt+Shift+0";
    await settings.getByLabel("Board shortcut", { exact: true }).fill(shortcut);
    await settings.getByLabel("Always show Taskline in the Dock").uncheck();
    await settings
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(settings).not.toBeVisible();
    expect((await state()).settings.showInDock).toBe(false);
    expect(
      await app.evaluate(
        ({ globalShortcut }, key) => globalShortcut.isRegistered(key),
        originalShortcut,
      ),
    ).toBe(false);
    expect(
      (await page.evaluate(() => globalThis.window.taskline!.desktopInfo()))
        .boardRegistered,
    ).toBe(true);
    await expect
      .poll(async () => (await boardState()).dock, { timeout: 3000 })
      .toBe(false);
    const originalId = (await boardState()).id;
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Taskline")!
        .close(),
    );
    await expect.poll(async () => (await boardState()).visible).toBe(false);
    await app.evaluate(
      (_, key) => globalThis.registeredBoardCallbacks.get(key)!(),
      shortcut,
    );
    await expect.poll(async () => (await boardState()).visible).toBe(true);
    await expect.poll(async () => (await boardState()).focused).toBe(true);
    expect((await boardState()).id).toBe(originalId);
    expect((await boardState()).dock).toBe(false);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Taskline")!
        .minimize(),
    );
    await expect.poll(async () => (await boardState()).minimized).toBe(true);
    await app.evaluate(
      (_, key) => globalThis.registeredBoardCallbacks.get(key)!(),
      shortcut,
    );
    await expect.poll(async () => (await boardState()).minimized).toBe(false);
    await expect.poll(async () => (await boardState()).focused).toBe(true);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".kanban")).toBeVisible();
    expect(
      (await page.evaluate(() => globalThis.window.taskline!.desktopInfo()))
        .boardRegistered,
    ).toBe(true);
    await expect.poll(async () => (await boardState()).dock).toBe(false);
    settings = await openSettings(page);
    await expect(
      settings.getByLabel("Board shortcut", { exact: true }),
    ).toHaveValue(shortcut);
    await expect(
      settings.getByLabel("Always show Taskline in the Dock"),
    ).not.toBeChecked();
    await settings.getByLabel("Always show Taskline in the Dock").check();
    await settings
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(settings).not.toBeVisible();
    await expect.poll(async () => (await boardState()).dock).toBe(true);
    // Rapid show -> hide must survive Electron's native Dock cooldown.
    settings = await openSettings(page);
    await settings.getByLabel("Always show Taskline in the Dock").uncheck();
    await settings
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(settings).not.toBeVisible();
    await expect.poll(async () => (await boardState()).dock).toBe(false);
    settings = await openSettings(page);
    await settings.getByLabel("Always show Taskline in the Dock").check();
    await settings
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(settings).not.toBeVisible();
    await expect.poll(async () => (await boardState()).dock).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Taskline")!
        .close(),
    );
    expect((await boardState()).dock).toBe(true);
    expect((await boardState()).visible).toBe(false);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator(".kanban")).toBeVisible();
    expect((await boardState()).dock).toBe(true);
    expect((await state()).tasks).toHaveLength(0);
    expect((await state()).settings.showInDock).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath("board-access-settings.png"),
    });
  } finally {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
