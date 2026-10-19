import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AppState,
  Epic,
  Project,
  Settings,
  Task,
} from "../shared/types.js";
import type { CliValues } from "./options.js";
import type { createTransport } from "./transport.js";
const exec = promisify(execFile);
export async function createContext(
  v: CliValues,
  { api, emit }: ReturnType<typeof createTransport>,
) {
  const state = await api<AppState>("/state");
  const projectThreads = (projectId: string) => {
    const targets = (state.threadTargets || []).filter(
      (t) => t.projectId === projectId,
    );
    const threads = state.threads.filter(
      (t) =>
        t.projectId === projectId &&
        !t.archivedAt &&
        !t.deletedAt &&
        (t.lineage?.relationshipToParent ?? t.relationshipToParent) !==
          "subagent",
    );
    return [
      ...threads.map((t) => ({
        ...t,
        threadKey: targets.find((target) => target.id === t.id)?.key || null,
      })),
      ...targets
        .filter((t) => !threads.some((thread) => thread.id === t.id))
        .map((t) => ({
          ...t,
          title: t.key,
          threadKey: t.key,
          status: t.materializedAt ? "missing" : "planned",
        })),
    ];
  };
  const taskTarget = (projectId: string) => {
    if (v.thread !== undefined && v["thread-key"] !== undefined)
      throw Error("Use either --thread or --thread-key");
    if (v["thread-key"] !== undefined) return { threadKey: v["thread-key"] };
    return {
      threadId:
        v.thread && v.thread !== "new"
          ? find(projectThreads(projectId), v.thread, "thread").id
          : null,
    };
  };
  const blockerIds = (values: string[]) => [
    ...new Set(
      values
        .flatMap((value) => value.split(","))
        .map((value) => find(state.tasks, value.trim(), "blocking task").id),
    ),
  ];
  const planningPatch = (): Partial<Task> => {
    if (v["blocked-by"] && v["clear-blockers"])
      throw Error("Use either --blocked-by or --clear-blockers");
    return {
      ...(v.priority !== undefined
        ? { priority: v.priority!.toLowerCase() as Task["priority"] }
        : {}),
      ...(v["blocked-by"] ? { blockedBy: blockerIds(v["blocked-by"]) } : {}),
      ...(v["clear-blockers"] ? { blockedBy: [] } : {}),
    };
  };
  function find<T extends { id: string; title?: string; name?: string }>(
    items: T[],
    selector: string | undefined,
    label: string,
  ): T {
    if (!selector) throw Error("Specify a " + label + " ID");
    let matches = items.filter((i) => i.id === selector);
    if (!matches.length)
      matches = items.filter(
        (i) =>
          (i.title || i.name || "").toLowerCase() === selector.toLowerCase(),
      );
    if (!matches.length) {
      const prefix = selector.replace(/^TL-/i, "").toLowerCase();
      if (prefix.length >= 4)
        matches = items.filter((i) => i.id.toLowerCase().startsWith(prefix));
    }
    if (matches.length !== 1)
      throw Error(
        matches.length
          ? "Ambiguous " + label + ": " + matches.map((i) => i.id).join(", ")
          : label + " not found: " + selector,
      );
    return matches[0];
  }
  async function project(selector = v.project) {
    if (selector) return find(state.projects, selector, "project");
    const cwd = process.cwd();
    let root = cwd;
    try {
      const result = await exec(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd },
      );
      root = dirname(result.stdout.trim());
    } catch {}
    const candidates = state.projects
      .filter((p) =>
        [root, cwd].some(
          (path) =>
            path === p.workspaceRoot || path.startsWith(p.workspaceRoot + "/"),
        ),
      )
      .sort((a, b) => b.workspaceRoot.length - a.workspaceRoot.length);
    if (!candidates.length)
      throw Error(
        "No project matches this workspace; pass --project ID or NAME",
      );
    return candidates[0];
  }
  const policy = (p: Project): Partial<Settings> =>
    state.projectSettings.find(
      (s) => s.id === p.id || s.id === "project:" + p.id,
    ) || { autoStart: true, concurrencyLimit: 2 };
  const mode = (p: Project) =>
    policy(p).autoStart === false ? "paused" : "active";
  let stdinUsed = false;
  async function stdinText() {
    if (stdinUsed) throw Error("Stdin can only supply one field");
    stdinUsed = true;
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  async function text(
    key: "prompt" | "context" | "criteria",
    required = false,
  ) {
    const file = v[`${key}-file`];
    if (v[key] !== undefined && file !== undefined)
      throw Error("Use either --" + key + " or --" + key + "-file");
    const value =
      file === undefined
        ? v[key]
        : file === "-"
          ? await stdinText()
          : await readFile(resolve(file), "utf8");
    if (required && !value?.trim())
      throw Error("Provide --" + key + " or --" + key + "-file");
    return value;
  }
  function executionPatch() {
    const patch: Partial<Settings & Epic> = {};
    if (v.mode !== undefined) patch.mode = v.mode;
    if (v.active) patch.mode = "active";
    if (v.paused) patch.mode = "paused";
    if (v.limit !== undefined) patch.concurrencyLimit = Number(v.limit);
    if (v.base) patch.baseRef = v.base;
    if (v.model) patch.model = v.model;
    if (v.provider) patch.instanceId = v.provider;
    return patch;
  }
  return {
    state,
    projectThreads,
    taskTarget,
    blockerIds,
    planningPatch,
    find,
    project,
    policy,
    mode,
    text,
    executionPatch,
    v,
    api,
    emit,
  };
}
export type CliContext = Awaited<ReturnType<typeof createContext>>;
