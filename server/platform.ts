import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

export function dataDirectory(
  platform = process.platform,
  home = homedir(),
  env = process.env,
) {
  const path = platform === "win32" ? win32 : posix;
  if (platform === "darwin")
    return path.join(home, "Library", "Application Support", "Taskline");
  if (platform === "win32")
    return path.join(
      env.APPDATA || path.join(home, "AppData", "Roaming"),
      "Taskline",
    );
  return path.join(
    env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "Taskline",
  );
}
export function toolCandidates(
  name: "t3" | "codex",
  { platform = process.platform, home = homedir(), env = process.env } = {},
) {
  const path = platform === "win32" ? win32 : posix;
  const override =
    name === "codex" ? env.TASKLINE_CODEX_PATH : env.TASKLINE_T3_PATH;
  if (override) return [override];
  if (name === "t3") {
    const bin = path.join(
      env.TASKLINE_T3_HOME || path.join(home, ".t3"),
      "bin",
    );
    return (platform === "win32" ? ["t3.cmd", "t3.exe"] : ["t3"]).map((file) =>
      path.join(bin, file),
    );
  }
  if (platform === "win32")
    return [
      path.join(
        env.APPDATA || path.join(home, "AppData", "Roaming"),
        "npm",
        "codex.cmd",
      ),
    ];
  return [
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
}
export function toolCommand(name: "t3" | "codex") {
  const candidates = toolCandidates(name);
  return (
    candidates.find(existsSync) ||
    (name === "codex"
      ? process.env.TASKLINE_CODEX_PATH
      : process.env.TASKLINE_T3_PATH) ||
    name
  );
}
export const t3Home = () =>
  process.env.TASKLINE_T3_HOME || join(homedir(), ".t3");
