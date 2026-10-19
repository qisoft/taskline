import type {
  Display,
  NativeImage,
  MenuItemConstructorOptions,
} from "electron";
import type {
  AppState,
  AppSettings,
  ImageAttachment,
  Rectangle,
} from "../shared/types.js";
import { asError } from "../shared/errors.js";
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  shell,
  screen,
  Notification,
  clipboard,
  desktopCapturer,
  systemPreferences,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
app.setName("Taskline");
let board: BrowserWindow | undefined;
let capture: BrowserWindow | undefined;
let tray: Tray | undefined;
let runtime:
  | Awaited<ReturnType<typeof import("../server/index.js").startServer>>
  | undefined;
let quitting = false;
let pendingCapture: ImageAttachment | null = null;
const apiOrigin = "http://127.0.0.1:" + (process.env.TASKLINE_PORT || 4318);
const uiOrigin = process.env.TASKLINE_UI_ORIGIN || apiOrigin;
let settings: AppSettings;
let previousApp: string | null = null;
let regionCapturePromise: Promise<void> | null = null;
const regionWindows = new Map<
  number,
  { window: BrowserWindow; display: Display; source: NativeImage }
>();
const get = async (p: string): Promise<AppState> =>
  (await fetch(apiOrigin + "/api" + p)).json();
async function post<T = unknown>(p: string, data: unknown): Promise<T> {
  const r = await fetch(apiOrigin + "/api" + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error);
  return result;
}
const preload = path.join(__dirname, "preload.cjs");
let lastDockShownAt: number | null = null;
async function setDockVisibility(visible: boolean) {
  if (!app.dock || app.dock.isVisible() === visible) return;
  if (visible) {
    await app.dock.show();
    lastDockShownAt = performance.now();
  } else {
    // Electron ignores hide() shortly after show(). Avoid redundant show calls
    // and honor its documented macOS cooldown when toggling the preference.
    // https://www.electronjs.org/docs/latest/api/dock/#dockhide-macos
    const delay =
      lastDockShownAt === null
        ? 0
        : Math.max(0, 1100 - (performance.now() - lastDockShownAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    app.dock.hide();
  }
}
function createBoard() {
  if (board && !board.isDestroyed()) {
    if (board.isMinimized()) board.restore();
    board.show();
    board.focus();
    app.focus({ steal: true });
    return;
  }
  board = new BrowserWindow({
    width: 1450,
    height: 950,
    minWidth: 900,
    minHeight: 650,
    title: "Taskline",
    backgroundColor: "#101012",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 14, y: 17 },
        }
      : { autoHideMenuBar: true }),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  board.loadURL(uiOrigin);
  board.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      board?.hide();
    }
  });
  board.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:"))
      shell.openExternal(url);
    return { action: "deny" };
  });
}
async function rememberFocus() {
  previousApp = null;
  if (process.platform === "darwin")
    await new Promise<void>((resolve) =>
      execFile(
        "/usr/bin/osascript",
        [
          "-e",
          'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
        ],
        { timeout: 1500 },
        (e, out) => {
          if (!e) previousApp = out.trim();
          resolve();
        },
      ),
    );
}
function restoreFocus() {
  if (
    process.platform === "darwin" &&
    previousApp &&
    previousApp !== "com.qisoft.taskline"
  )
    execFile("/usr/bin/open", ["-b", previousApp], () => {});
}
async function showCapture(
  attachment: ImageAttachment | null = null,
  keepFocus = false,
  targetDisplay: Display | null = null,
) {
  if (capture && !capture.isDestroyed()) {
    capture.show();
    capture.focus();
    return;
  }
  if (!keepFocus) await rememberFocus();
  pendingCapture = attachment;
  const display =
    targetDisplay ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 640,
    height = attachment ? 520 : 440;
  capture = new BrowserWindow({
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.21),
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#1c1c20",
    roundedCorners: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform !== "win32")
    capture.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await capture.loadURL(uiOrigin + "/?capture=1");
  capture.focus();
  capture.on("closed", () => {
    capture = undefined;
    pendingCapture = null;
    restoreFocus();
  });
}
function closeRegionWindows() {
  const windows = [...regionWindows.values()];
  regionWindows.clear();
  for (const entry of windows)
    if (!entry.window.isDestroyed()) entry.window.close();
}
async function captureRegion() {
  if (regionCapturePromise) return regionCapturePromise;
  if (regionWindows.size) {
    const display = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const entry = [...regionWindows.values()].find(
      (e) => e.display.id === display.id,
    );
    (entry ?? regionWindows.values().next().value)?.window.focus();
    return;
  }
  regionCapturePromise = createRegionWindows();
  try {
    return await regionCapturePromise;
  } finally {
    regionCapturePromise = null;
  }
}
async function createRegionWindows() {
  if (capture && !capture.isDestroyed()) capture.close();
  await rememberFocus();
  const displays = screen.getAllDisplays();
  try {
    // Capture every source before showing any overlay, at that display's pixel size.
    const captures = await Promise.all(
      displays.map(async (display) => {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: {
            width: Math.round(display.bounds.width * display.scaleFactor),
            height: Math.round(display.bounds.height * display.scaleFactor),
          },
          fetchWindowIcons: false,
        });
        const source = sources.find((s) => s.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty())
          throw Error(
            process.platform === "darwin" &&
              systemPreferences.getMediaAccessStatus("screen") === "granted"
              ? "No screen is available for " +
                  (display.label || "display " + display.id) +
                  ". Unlock your Mac and try again."
              : process.platform === "darwin"
                ? "Allow Taskline screen recording in System Settings → Privacy & Security."
                : "No screen image is available. Unlock your desktop and try again.",
          );
        return { display, source: source.thumbnail };
      }),
    );
    const loading = [];
    for (const { display, source } of captures) {
      const window = new BrowserWindow({
        ...display.bounds,
        show: false,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        acceptFirstMouse: true,
        // Frameless capture must cover Dock/menu-bar space, not macOS's work area.
        enableLargerThanScreen: true,
        hasShadow: false,
        roundedCorners: false,
        resizable: false,
        movable: false,
        backgroundColor: "#111111",
        webPreferences: {
          preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "Escape") {
          event.preventDefault();
          closeRegionWindows();
          restoreFocus();
        }
      });
      const id = window.webContents.id;
      regionWindows.set(id, { window, display, source });
      window.on("closed", () => regionWindows.delete(id));
      if (process.platform !== "win32")
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.setAlwaysOnTop(true, "screen-saver");
      loading.push(window.loadFile(path.join(__dirname, "region.html")));
    }
    await Promise.all(loading);
    for (const { window } of regionWindows.values()) window.showInactive();
    const nearest = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const focused = [...regionWindows.values()].find(
      (e) => e.display.id === nearest.id,
    );
    (focused ?? regionWindows.values().next().value)?.window.focus();
  } catch (caught) {
    const e = asError(caught);
    closeRegionWindows();
    new Notification({
      title: "Screen capture unavailable",
      body: e.message,
    }).show();
    throw e;
  }
}
function registerShortcuts(next: AppSettings) {
  globalShortcut.unregisterAll();
  const failures = [];
  for (const [label, accelerator, callback] of [
    ["Board", next.boardShortcut, createBoard],
    ["Text", next.textShortcut, () => showCapture()],
    [
      "Screenshot",
      next.screenshotShortcut,
      () => captureRegion().catch(console.error),
    ],
  ] as const) {
    try {
      if (!accelerator || !globalShortcut.register(accelerator, callback))
        failures.push(label + " shortcut is already used or empty");
    } catch {
      failures.push(label + " shortcut is invalid");
    }
  }
  return failures;
}
async function configure(next: AppSettings) {
  next = {
    ...next,
    boardShortcut: next.boardShortcut ?? "CommandOrControl+Shift+0",
    showInDock: next.showInDock ?? true,
  };
  const failures = registerShortcuts(next);
  if (failures.length) {
    if (settings) registerShortcuts(settings);
    throw Error(failures.join(". "));
  }
  await setDockVisibility(next.showInDock !== false);
  app.setLoginItemSettings({
    openAtLogin: next.launchAtLogin === true,
  });
  settings = next;
  const boardMenuItem =
    Menu.getApplicationMenu()?.getMenuItemById("open-board");
  // MenuItem accelerators are immutable at runtime; replace the menu after edits.
  if (boardMenuItem) updateApplicationMenu();
  return { ok: true };
}
function trayImage() {
  const { deflateSync } = require("node:zlib");
  const width = 18,
    height = 18;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const painted =
        (y >= 3 && y <= 5 && x >= 3 && x <= 14) ||
        (y >= 5 && y <= 15 && x >= 8 && x <= 10);
      if (painted) raw[y * (1 + width * 4) + 1 + x * 4 + 3] = 255;
    }
  }
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const b of buffer) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const image = nativeImage.createFromBuffer(png);
  image.setTemplateImage(true);
  return image;
}
function updateApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Taskline",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            id: "open-board",
            label: "Open Taskline",
            accelerator: settings.boardShortcut,
            click: createBoard,
          },
          {
            label: "New task",
            accelerator: settings.textShortcut,
            click: () => showCapture(),
          },
          {
            label: "Capture screenshot",
            accelerator: settings.screenshotShortcut,
            click: captureRegion,
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
          { type: "separator" },
          ...(process.platform === "darwin"
            ? [
                {
                  label: "Start Dictation",
                  selector: "startDictation:",
                } as MenuItemConstructorOptions & { selector: string },
              ]
            : []),
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
    ]),
  );
}
async function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip("Taskline — global task capture");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Taskline", click: createBoard },
      { label: "Capture task", click: () => showCapture() },
      { label: "Capture screen region", click: captureRegion },
      { type: "separator" },
      {
        label: "Quit Taskline",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", createBoard);
}
ipcMain.handle(
  "region:image",
  (event) => regionWindows.get(event.sender.id)?.source.toDataURL() ?? null,
);
ipcMain.handle("region:cancel", () => {
  closeRegionWindows();
  restoreFocus();
});
ipcMain.handle("region:finish", async (event, rectangle: Rectangle) => {
  const entry = regionWindows.get(event.sender.id);
  if (!entry) throw Error("No region capture is active");
  const size = entry.source.getSize(),
    scaleX = size.width / entry.display.bounds.width,
    scaleY = size.height / entry.display.bounds.height;
  const x = Math.max(0, Math.round(rectangle.x * scaleX)),
    y = Math.max(0, Math.round(rectangle.y * scaleY));
  const width = Math.min(size.width - x, Math.round(rectangle.width * scaleX)),
    height = Math.min(size.height - y, Math.round(rectangle.height * scaleY));
  if (width < 1 || height < 1) throw Error("Select a non-empty screen region");
  const bytes = entry.source.crop({ x, y, width, height }).toPNG();
  closeRegionWindows();
  const image = await post<ImageAttachment>("/attachments", {
    base64: bytes.toString("base64"),
    name:
      "Screen region " + new Date().toISOString().replaceAll(":", "-") + ".png",
    mimeType: "image/png",
  });
  await showCapture(image, true, entry.display);
  return image;
});
ipcMain.handle("capture:pending", () => pendingCapture);
ipcMain.on("capture:close", () => capture?.close());
ipcMain.handle("capture:text", () => showCapture());
ipcMain.handle("capture:region", captureRegion);
ipcMain.handle("settings:configure", (_, value) => configure(value));
ipcMain.handle("t3:open", async (_, threadId) => {
  const state = await get("/state");
  if (threadId && state.connection.environmentId)
    shell.openExternal(
      "t3code://threads/" +
        encodeURIComponent(state.connection.environmentId) +
        "/" +
        encodeURIComponent(threadId),
    );
});
ipcMain.handle(
  "permissions:screen",
  () =>
    process.platform === "darwin" &&
    shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    ),
);
ipcMain.handle("desktop:info", () => ({
  boardRegistered: globalShortcut.isRegistered(settings.boardShortcut),
  dockVisible: app.dock?.isVisible() ?? null,
  textRegistered: globalShortcut.isRegistered(settings.textShortcut),
  screenshotRegistered: globalShortcut.isRegistered(
    settings.screenshotShortcut,
  ),
  screenRecording:
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("screen")
      : "granted",
  platform: process.platform,
  appVersion: app.getVersion(),
  dataDir:
    runtime?.state().dataDir ||
    process.env.TASKLINE_DATA_DIR ||
    path.join(app.getPath("appData"), "Taskline"),
}));
if (!app.requestSingleInstanceLock() && !process.env.TASKLINE_E2E) {
  app.quit();
}
app.on("second-instance", createBoard);
app
  .whenReady()
  .then(async () => {
    console.log("Taskline: Electron ready");
    try {
      const response = await fetch(apiOrigin + "/api/health");
      if (!response.ok) throw Error("API not healthy");
    } catch {
      const module = await import(
        pathToFileURL(path.join(__dirname, "../server/index.js")).href
      );
      runtime = await module.startServer();
    }
    console.log("Taskline: API available");
    const state = await get("/state");
    console.log("Taskline: state loaded");
    settings = state.settings;
    try {
      await configure(settings);
    } catch (caught) {
      const e = asError(caught);
      console.error(e.message);
    }
    console.log("Taskline: shortcuts configured");
    await createTray();
    console.log("Taskline: tray ready");
    createBoard();
    console.log("Taskline: board created");
    updateApplicationMenu();
    app.on("activate", createBoard);
  })
  .catch((e) => {
    console.error(e);
    app.quit();
  });
app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  runtime?.close();
});
app.on("window-all-closed", () => {});
module.exports = {
  showCapture,
  captureRegion,
  createBoard,
  get captureWindow() {
    return capture;
  },
  get boardWindow() {
    return board;
  },
};
