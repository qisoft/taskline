const asError = (value: unknown): Error & { code?: string } =>
  value instanceof Error ? value : new Error(String(value));
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export function installCli({
  resource,
  directory,
  platform = process.platform,
}: {
  resource: string;
  directory: string;
  platform?: NodeJS.Platform;
}) {
  accessSync(resource, constants.R_OK);
  mkdirSync(directory, { recursive: true });
  const target = join(
    directory,
    platform === "win32" ? "taskline.cmd" : "taskline",
  );
  if (platform === "win32") {
    const command =
      '@echo off\r\nnode "' + resource.replaceAll("%", "%%") + '" %*\r\n';
    if (existsSync(target) && readFileSync(target, "utf8") !== command)
      throw Error("Refusing to replace existing command: " + target);
    writeFileSync(target, command);
  } else {
    let existing;
    try {
      existing = lstatSync(target);
    } catch (caught) {
      const error = asError(caught);
      if (error.code !== "ENOENT") throw error;
    }
    if (existing) {
      if (!existing.isSymbolicLink() || readlinkSync(target) !== resource)
        throw Error("Refusing to replace existing command: " + target);
    } else symlinkSync(resource, target);
  }
  return target;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const adjacent = join(
    dirname(fileURLToPath(import.meta.url)),
    "taskline.mjs",
  );
  const resource = resolve(
    process.env.TASKLINE_CLI_RESOURCE ||
      (existsSync(adjacent)
        ? adjacent
        : process.platform === "win32"
          ? join(
              process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
              "Programs",
              "Taskline",
              "resources",
              "taskline.mjs",
            )
          : "/Applications/Taskline.app/Contents/Resources/taskline.mjs"),
  );
  const directory = resolve(
    process.argv[2] ||
      (process.platform === "win32"
        ? join(
            process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
            "Taskline",
            "bin",
          )
        : existsSync("/opt/homebrew/bin")
          ? "/opt/homebrew/bin"
          : join(homedir(), ".local", "bin")),
  );
  console.log("Taskline CLI installed: " + installCli({ resource, directory }));
  console.log("Add this directory to PATH if needed: " + directory);
}
