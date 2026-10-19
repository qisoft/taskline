import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/types.js";
contextBridge.exposeInMainWorld("taskline", {
  regionImage: () => ipcRenderer.invoke("region:image"),
  finishRegion: (rectangle) => ipcRenderer.invoke("region:finish", rectangle),
  cancelRegion: () => ipcRenderer.invoke("region:cancel"),
  pendingCapture: () => ipcRenderer.invoke("capture:pending"),
  closeCapture: () => ipcRenderer.send("capture:close"),
  captureText: () => ipcRenderer.invoke("capture:text"),
  captureRegion: () => ipcRenderer.invoke("capture:region"),
  configure: (settings) => ipcRenderer.invoke("settings:configure", settings),
  openThread: (id) => ipcRenderer.invoke("t3:open", id),
  openScreenPermissions: () => ipcRenderer.invoke("permissions:screen"),
  desktopInfo: () => ipcRenderer.invoke("desktop:info"),
} satisfies DesktopBridge);
