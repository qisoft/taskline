import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import type { Epic } from "../shared/types.js";
export const origin = "http://127.0.0.1:4318";
export const request = async (
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) => {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error);
  return result;
};
export const launch = async () => {
  const env: Record<string, string> = { ...process.env, TASKLINE_E2E: "1" };
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
export const desktop = {} as {
  app: ElectronApplication;
  window: Page;
  epic: Epic;
  nativeTaskId: string;
};
export const epicName = "E2E Capture Epic " + Date.now();
export const screenshotTitle = "E2E screenshot task " + Date.now();
