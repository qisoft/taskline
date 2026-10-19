import type { Display, NativeImage } from "electron";
import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Notification,
  screen,
  systemPreferences,
} from "electron";
import path from "node:path";
import { asError } from "../shared/errors.js";
import type { ImageAttachment, Rectangle } from "../shared/types.js";
interface RegionCaptureOptions {
  preload: string;
  closeComposer: () => void;
  rememberFocus: () => Promise<void>;
  restoreFocus: () => void;
  showCapture: (
    image: ImageAttachment,
    keepFocus: boolean,
    display: Display,
  ) => Promise<void>;
  post: <T>(path: string, data: unknown) => Promise<T>;
}
export function createRegionCapture({
  preload,
  closeComposer,
  rememberFocus,
  restoreFocus,
  showCapture,
  post,
}: RegionCaptureOptions) {
  let regionCapturePromise: Promise<void> | null = null;
  const regionWindows = new Map<
    number,
    { window: BrowserWindow; display: Display; source: NativeImage }
  >();
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
    closeComposer();
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
          const source = sources.find(
            (s) => s.display_id === String(display.id),
          );
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
    const width = Math.min(
        size.width - x,
        Math.round(rectangle.width * scaleX),
      ),
      height = Math.min(size.height - y, Math.round(rectangle.height * scaleY));
    if (width < 1 || height < 1)
      throw Error("Select a non-empty screen region");
    const bytes = entry.source.crop({ x, y, width, height }).toPNG();
    closeRegionWindows();
    const image = await post<ImageAttachment>("/attachments", {
      base64: bytes.toString("base64"),
      name:
        "Screen region " +
        new Date().toISOString().replaceAll(":", "-") +
        ".png",
      mimeType: "image/png",
    });
    await showCapture(image, true, entry.display);
    return image;
  });
  return captureRegion;
}
