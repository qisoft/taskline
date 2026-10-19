#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { AppState } from "../shared/types.js";
import { createContext } from "./context.js";
import { options, priorityLevels, usage, type CliValues } from "./options.js";
import { runProjectCommand } from "./project-commands.js";
import { runTaskCommand } from "./task-commands.js";
import { createTransport } from "./transport.js";
async function main() {
  const { values, positionals: args } = parseArgs({
    options,
    allowPositionals: true,
  });
  const v = values as CliValues;
  if (v.help || !args.length) {
    console.log(usage);
    return;
  }
  if (v.paused && v.active) throw Error("Choose either --paused or --active");
  if (
    v.priority !== undefined &&
    !priorityLevels.includes(v.priority!.toLowerCase())
  )
    throw Error("Choose priority: urgent, high, normal, low or none");
  const base = (
    v.url ||
    process.env.TASKLINE_URL ||
    "http://127.0.0.1:4318"
  ).replace(/\/$/, "");
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol))
    throw Error("Invalid Taskline URL");
  const transport = createTransport(v, base);
  const { api, emit } = transport;
  let [kind, action = "list", id] = args;
  kind =
    (
      {
        projects: "project",
        tasks: "task",
        epics: "epic",
        threads: "thread",
      } as Record<string, string>
    )[kind] || kind;
  if (["status", "pause", "resume"].includes(kind)) {
    if (kind !== "status")
      await api("/settings", { paused: kind === "pause" }, "PATCH");
    const state = await api<AppState>("/state");
    emit({
      connected: state.connection.connected,
      scheduler: state.settings.paused ? "paused" : "active",
      tasks: state.tasks.length,
      projects: state.projects.length,
      activeTasks: state.tasks.filter((t) => t.status === "doing").length,
    });
    return;
  }
  if (kind === "start") {
    try {
      await api("/health");
      emit({ running: true, url: base });
      return;
    } catch {}
    const resourceDirectory = dirname(fileURLToPath(import.meta.url));
    const candidates =
      process.platform === "win32"
        ? [
            resolve(resourceDirectory, "..", "Taskline.exe"),
            resolve(
              process.env.LOCALAPPDATA || "",
              "Programs",
              "Taskline",
              "Taskline.exe",
            ),
          ]
        : [
            resolve(resourceDirectory, "..", "MacOS", "Taskline"),
            "/Applications/Taskline.app/Contents/MacOS/Taskline",
          ];
    const executable =
      process.env.TASKLINE_APP_PATH || candidates.find(existsSync);
    if (!executable)
      throw Error(
        "Open Taskline first, or set TASKLINE_APP_PATH to its executable",
      );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.TASKLINE_E2E;
    const child = spawn(executable, [], {
      env,
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    emit({ starting: true, pid: child.pid });
    return;
  }
  const context = await createContext(v, transport);
  if (await runProjectCommand(kind, action, id, context)) return;
  if (await runTaskCommand(kind, action, id, context)) return;
  throw Error("Unknown command: " + args.join(" ") + ". Run taskline --help");
}
main().catch((error) => {
  const json = process.argv.includes("--json");
  console.error(
    json
      ? JSON.stringify({ error: error.message })
      : "taskline: " + error.message,
  );
  process.exitCode = 1;
});
