import { _electron as electron } from "@playwright/test";
import { asError } from "../shared/errors.js";
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
env.TASKLINE_E2E = "1";
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: "/Applications/Taskline.app/Contents/MacOS/Taskline",
  args: [],
  env,
  timeout: 30000,
});
const appWindow = await app.firstWindow();
await appWindow.locator(".kanban").waitFor();
let info = await appWindow.evaluate(() => window.taskline!.desktopInfo());
console.log(JSON.stringify(info));
if (info.screenRecording !== "granted") {
  try {
    await appWindow.evaluate(() => window.taskline!.captureRegion());
  } catch (caught) {
    const error = asError(caught);
    console.log(error.message);
  }
  await appWindow.evaluate(() => window.taskline!.openScreenPermissions());
  console.log("Waiting for macOS screen-recording permission.");
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      info = await appWindow.evaluate(() => window.taskline!.desktopInfo());
    } catch {
      console.log("Application was restarted by macOS.");
      break;
    }
    if (info.screenRecording === "granted") {
      console.log("Screen-recording permission is granted.");
      break;
    }
  }
}
await app.close().catch(() => {});
