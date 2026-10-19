import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const electron: unknown = createRequire(import.meta.url)("electron");
if (typeof electron !== "string")
  throw Error("Launch Taskline from Node.js, outside the Electron runtime");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  cwd: new URL("..", import.meta.url),
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
