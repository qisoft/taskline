import { _electron as electron } from "@playwright/test";
const env = { ...process.env, TASKLINE_E2E: "1" };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: "/Applications/Taskline.app/Contents/MacOS/Taskline",
  args: [],
  env,
  timeout: 30000,
});
const window = await app.firstWindow();
await window.locator(".kanban").waitFor();
let info = await window.evaluate(() => window.taskline.desktopInfo());
console.log(JSON.stringify(info));
if (info.screenRecording !== "granted") {
  try {
    await window.evaluate(() => window.taskline.captureRegion());
  } catch (error) {
    console.log(error.message);
  }
  await window.evaluate(() => window.taskline.openScreenPermissions());
  console.log("Waiting for macOS screen-recording permission.");
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      info = await window.evaluate(() => window.taskline.desktopInfo());
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
