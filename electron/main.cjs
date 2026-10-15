const {
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
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
app.setName("Taskline");
let board,
  capture,
  tray,
  runtime,
  quitting = false,
  pendingCapture = null,
  apiOrigin = "http://127.0.0.1:" + (process.env.TASKLINE_PORT || 4318),
  uiOrigin = process.env.TASKLINE_UI_ORIGIN || apiOrigin,
  settings,
  previousApp = null,
  regionCapturePromise = null;
const regionWindows = new Map();
const get = async (p) => (await fetch(apiOrigin + "/api" + p)).json();
async function post(p, data) {
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
let lastDockShownAt = null;
async function setDockVisibility(visible) {
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
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 17 },
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
      board.hide();
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
    await new Promise((resolve) =>
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
  attachment = null,
  keepFocus = false,
  targetDisplay = null,
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
  capture.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await capture.loadURL(uiOrigin + "/?capture=1");
  capture.focus();
  capture.on("closed", () => {
    capture = null;
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
    (entry ?? regionWindows.values().next().value).window.focus();
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
              : "Allow Taskline screen recording in System Settings → Privacy & Security.",
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
      const id = window.webContents.id;
      regionWindows.set(id, { window, display, source });
      window.on("closed", () => regionWindows.delete(id));
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
  } catch (e) {
    closeRegionWindows();
    new Notification({
      title: "Screen capture unavailable",
      body: e.message,
    }).show();
    throw e;
  }
}
function registerShortcuts(next) {
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
  ]) {
    try {
      if (!accelerator || !globalShortcut.register(accelerator, callback))
        failures.push(label + " shortcut is already used or empty");
    } catch {
      failures.push(label + " shortcut is invalid");
    }
  }
  return failures;
}
async function configure(next) {
  next = {
    boardShortcut: "CommandOrControl+Shift+0",
    showInDock: true,
    ...next,
  };
  const failures = registerShortcuts(next);
  if (failures.length) {
    if (settings) registerShortcuts(settings);
    throw Error(failures.join(". "));
  }
  await setDockVisibility(next.showInDock !== false);
  app.setLoginItemSettings({
    openAtLogin: next.launchAtLogin === true,
    openAsHidden: true,
  });
  settings = next;
  const boardMenuItem =
    Menu.getApplicationMenu()?.getMenuItemById("open-board");
  if (boardMenuItem) boardMenuItem.accelerator = next.boardShortcut;
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
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const b of buffer) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
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
ipcMain.handle("region:finish", async (event, rectangle) => {
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
  const image = await post("/attachments", {
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
ipcMain.handle("permissions:screen", () =>
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
    process.env.TASKLINE_DATA_DIR ||
    path.join(os.homedir(), "Library", "Application Support", "Taskline"),
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
        pathToFileURL(path.join(__dirname, "../server/index.mjs")).href
      );
      runtime = await module.startServer();
    }
    console.log("Taskline: API available");
    const state = await get("/state");
    console.log("Taskline: state loaded");
    settings = state.settings;
    try {
      await configure(settings);
    } catch (e) {
      console.error(e.message);
    }
    console.log("Taskline: shortcuts configured");
    await createTray();
    console.log("Taskline: tray ready");
    createBoard();
    console.log("Taskline: board created");
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
            { label: "Start Dictation", selector: "startDictation:" },
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
