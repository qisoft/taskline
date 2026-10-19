import { execFileSync } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const marker = "Taskline managed CLI v1";
const pathMarker = "# >>> Taskline CLI >>>";
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const batchQuote = (text: string) => '"' + text.replaceAll("%", "%%") + '"';

export function installCli({
  resource,
  directory,
  platform = process.platform,
  runtime = "node",
  runAsNode = false,
}: {
  resource: string;
  directory: string;
  platform?: NodeJS.Platform;
  runtime?: string;
  runAsNode?: boolean;
}) {
  accessSync(resource, constants.R_OK);
  mkdirSync(directory, { recursive: true });
  const target = join(
    directory,
    platform === "win32" ? "taskline.cmd" : "taskline",
  );
  const content =
    platform === "win32"
      ? `@echo off\r\nrem ${marker}\r\nsetlocal DisableDelayedExpansion\r\n${runAsNode ? 'set "ELECTRON_RUN_AS_NODE=1"\r\n' : ""}${batchQuote(runtime)} ${batchQuote(resource)} %*\r\n`
      : `#!/bin/sh\n# ${marker}\n${runAsNode ? "export ELECTRON_RUN_AS_NODE=1\n" : ""}exec ${quote(runtime)} ${quote(resource)} "$@"\n`;
  let existing;
  try {
    existing = lstatSync(target);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  if (existing?.isSymbolicLink()) {
    if (readlinkSync(target) !== resource)
      throw Error("Refusing to replace existing command: " + target);
    unlinkSync(target);
  } else if (existing) {
    const previous = existing.isFile() ? readFileSync(target, "utf8") : "";
    const legacyWindowsShim =
      '@echo off\r\nnode "' + resource.replaceAll("%", "%%") + '" %*\r\n';
    if (
      !existing.isFile() ||
      (!previous.startsWith(
        platform === "win32"
          ? `@echo off\r\nrem ${marker}\r\n`
          : `#!/bin/sh\n# ${marker}\n`,
      ) &&
        !(platform === "win32" && previous === legacyWindowsShim))
    )
      throw Error("Refusing to replace existing command: " + target);
    if (readFileSync(target, "utf8") === content) return target;
  }
  writeFileSync(target, content, { mode: 0o755 });
  if (platform !== "win32") chmodSync(target, 0o755);
  return target;
}

export function updateWindowsUserPath(directory: string) {
  const path = directory.replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'Stop'
$directory = '${path}'
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if (@($current -split ';' | ForEach-Object { $_.TrimEnd('\\') }) -notcontains $directory.TrimEnd('\\')) {
  $next = if ([String]::IsNullOrEmpty($current)) { $directory } else { "$directory;$current" }
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  Add-Type -Namespace Taskline -Name EnvironmentBroadcast -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);'
  $result = [UIntPtr]::Zero
  [void][Taskline.EnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
}
`;
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 15000, stdio: "pipe" },
  );
}

function addShellPath(path: string, directory: string, fish = false) {
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (previous.includes(pathMarker)) return;
  mkdirSync(dirname(path), { recursive: true });
  const setup = fish
    ? `fish_add_path --prepend -- ${quote(directory)}`
    : `case ":$PATH:" in\n  *:${quote(directory)}:*) ;;\n  *) export PATH=${quote(directory)}:"$PATH" ;;\nesac`;
  appendFileSync(
    path,
    `${previous.endsWith("\n") || !previous ? "" : "\n"}\n${pathMarker}\n${setup}\n# <<< Taskline CLI <<<\n`,
  );
}

export function installDesktopCli({
  resource,
  runtime,
  home = homedir(),
  platform = process.platform,
  env = process.env,
  registerWindowsPath = updateWindowsUserPath,
}: {
  resource: string;
  runtime: string;
  home?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  registerWindowsPath?: (directory: string) => void;
}) {
  const directory =
    platform === "win32"
      ? join(
          env.LOCALAPPDATA || join(home, "AppData", "Local"),
          "Taskline",
          "bin",
        )
      : join(home, ".local", "bin");
  const target = installCli({
    resource,
    directory,
    platform,
    runtime,
    runAsNode: true,
  });
  if (platform === "win32") registerWindowsPath(directory);
  else {
    const shell = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/sh");
    if (shell.endsWith("/fish"))
      addShellPath(
        join(
          env.XDG_CONFIG_HOME || join(home, ".config"),
          "fish",
          "conf.d",
          "taskline.fish",
        ),
        directory,
        true,
      );
    else if (shell.endsWith("/zsh")) {
      const dotdir = env.ZDOTDIR || home;
      for (const name of [".zprofile", ".zshrc"])
        addShellPath(join(dotdir, name), directory);
    } else {
      const login =
        [".bash_profile", ".bash_login", ".profile"].find((name) =>
          existsSync(join(home, name)),
        ) || ".profile";
      addShellPath(join(home, login), directory);
      if (shell.endsWith("/bash"))
        addShellPath(join(home, ".bashrc"), directory);
    }
  }
  return { path: target, directory };
}
