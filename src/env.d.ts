import type { DesktopBridge } from "../shared/types.js";
declare global {
  interface Window {
    taskline?: DesktopBridge;
  }
}
