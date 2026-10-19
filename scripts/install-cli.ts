import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDesktopCli } from "../electron/cli-install.js";
export { installCli } from "../electron/cli-install.js";

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = installDesktopCli({
    resource: resolve("build/standalone/taskline.mjs"),
    runtime: process.execPath,
  });
  console.log("Taskline CLI installed: " + result.path);
  console.log("Open a new terminal to use taskline.");
}
