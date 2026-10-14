import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
const resource = "/Applications/Taskline.app/Contents/Resources/taskline.mjs";
accessSync(resource, constants.R_OK | constants.X_OK);
const directory = resolve(
  process.argv[2] ||
    (process.platform === "darwin" && existsSync("/opt/homebrew/bin")
      ? "/opt/homebrew/bin"
      : join(homedir(), ".local", "bin")),
);
mkdirSync(directory, { recursive: true });
const target = join(directory, "taskline");
if (
  existsSync(target) ||
  (() => {
    try {
      return lstatSync(target).isSymbolicLink();
    } catch {
      return false;
    }
  })()
) {
  if (!lstatSync(target).isSymbolicLink() || readlinkSync(target) !== resource)
    throw Error("Refusing to replace existing command: " + target);
} else symlinkSync(resource, target);
console.log("Taskline CLI installed: " + target);
