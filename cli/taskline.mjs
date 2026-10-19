#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, extname } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile);
const priorityLevels = ["urgent", "high", "normal", "low", "none"];
const options = Object.fromEntries(
  [
    "url",
    "project",
    "epic",
    "thread",
    "thread-key",
    "prompt",
    "prompt-file",
    "title",
    "name",
    "path",
    "mode",
    "limit",
    "base",
    "model",
    "provider",
    "context",
    "context-file",
    "criteria",
    "criteria-file",
    "status",
    "priority",
    "request",
    "answers",
    "decision",
    "id",
    "request-id",
  ].map((key) => [key, { type: "string" }]),
);
for (const key of [
  "json",
  "help",
  "paused",
  "active",
  "mkdir",
  "all",
  "blocked",
  "clear-blockers",
])
  options[key] = { type: "boolean" };
options.image = { type: "string", multiple: true };
options["blocked-by"] = { type: "string", multiple: true };
options.by = { type: "string", multiple: true };
const usage = `Taskline — local task board for T3 Code

Usage: taskline <resource> <command> [id] [options]

project list | show [id] | create --name NAME --path DIR [--paused|--active]
project pause [id] | activate [id] | set [id] [--mode paused|active] [--limit N]
thread list [--project PROJECT]
model list
epic list | show ID | add --name NAME [--project PROJECT] [--context-file FILE]
epic update ID [--name NAME] [--context TEXT] [--criteria TEXT]
epic summarize ID | close ID | reopen ID | delete ID
task list [--project PROJECT] [--epic EPIC] [--status STATUS] [--priority LEVEL] [--blocked] [--all]
task add [--project PROJECT] [--epic EPIC] [--thread ID|new | --thread-key KEY] --prompt TEXT
         [--prompt-file FILE|-] [--title TITLE] [--image FILE] [--model MODEL]
         [--priority urgent|high|normal|low|none] [--blocked-by TASK ...]
task show ID | update ID [--title TITLE] [--prompt TEXT] [--epic ID|none] [--thread ID|new | --thread-key KEY]
         [--priority LEVEL] [--blocked-by TASK ... | --clear-blockers]
task block ID --by TASK [--by TASK] | unblock ID --by TASK [--by TASK]
task pause ID | resume ID | cancel ID | accept ID | retry ID | delete ID
task revise ID --prompt TEXT | report ID
task answer ID --request ID --answers '{"question_id":{"answers":["answer"]}}'
task approve ID --request ID --decision DECISION
status | pause | resume | start

Projects default to Paused when created. Activate a project explicitly to execute
its queue. Pausing stops new starts; running T3 turns continue. New threads use
separate Git worktrees, so use a Git workspace when creating a project.
Tasks with the same --thread-key in one project share one future thread, created
when the first task starts. They run sequentially, independently of epic membership.
Projects may be addressed by ID, unique name or ID prefix. Task codes TL-ABCD
are accepted when unique. Without --project, the current Git workspace is used.
Use --json for structured output. --prompt-file - reads stdin.
Priority defaults to normal. Higher priorities start first among unblocked tasks.
Repeat --blocked-by to wait for multiple tasks; all must reach Review or Done.
Failed/cancelled tasks remain blockers. Blockers can belong to other projects.
On update, --blocked-by replaces the list; block/unblock adds/removes individual links.
TASKLINE_URL / --url override http://127.0.0.1:4318. Taskline must be running.
`;
async function main() {
  const { values: v, positionals: args } = parseArgs({
    options,
    allowPositionals: true,
  });
  if (v.help || !args.length) {
    console.log(usage);
    return;
  }
  if (v.paused && v.active) throw Error("Choose either --paused or --active");
  if (
    v.priority !== undefined &&
    !priorityLevels.includes(v.priority.toLowerCase())
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
  async function api(path, body, method = body === undefined ? "GET" : "POST") {
    let response;
    try {
      response = await fetch(base + "/api" + path, {
        method,
        headers:
          body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(65000),
      });
    } catch (error) {
      throw Error(
        "Taskline is unavailable at " +
          base +
          ". Open Taskline or run taskline start. " +
          error.message,
      );
    }
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "HTTP " + response.status);
    return data;
  }
  const emit = (data) =>
    console.log(
      v.json
        ? JSON.stringify(data, null, 2)
        : Array.isArray(data)
          ? data.length
            ? data
                .map((row) =>
                  [
                    row.code || row.id,
                    row.mode || row.status || "",
                    ...(row.priority
                      ? [
                          row.priority,
                          row.blockingTaskIds?.length
                            ? "blocked by " +
                              row.blockingTaskIds
                                .map(
                                  (id) => "TL-" + id.slice(0, 4).toUpperCase(),
                                )
                                .join(",")
                            : "",
                        ]
                      : []),
                    row.title || row.name || "",
                  ].join("\t"),
                )
                .join("\n")
            : "No items"
          : JSON.stringify(data, null, 2),
    );
  let [kind, action = "list", id] = args;
  kind =
    { projects: "project", tasks: "task", epics: "epic", threads: "thread" }[
      kind
    ] || kind;
  if (["status", "pause", "resume"].includes(kind)) {
    if (kind !== "status")
      await api("/settings", { paused: kind === "pause" }, "PATCH");
    const state = await api("/state");
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
  const state = await api("/state");
  const projectThreads = (projectId) => {
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
  const taskTarget = (projectId) => {
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
  const blockerIds = (values) => [
    ...new Set(
      values
        .flatMap((value) => value.split(","))
        .map((value) => find(state.tasks, value.trim(), "blocking task").id),
    ),
  ];
  const planningPatch = () => {
    if (v["blocked-by"] && v["clear-blockers"])
      throw Error("Use either --blocked-by or --clear-blockers");
    return {
      ...(v.priority !== undefined
        ? { priority: v.priority.toLowerCase() }
        : {}),
      ...(v["blocked-by"] ? { blockedBy: blockerIds(v["blocked-by"]) } : {}),
      ...(v["clear-blockers"] ? { blockedBy: [] } : {}),
    };
  };
  function find(items, selector, label) {
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
  const policy = (p) =>
    state.projectSettings.find(
      (s) => s.id === p.id || s.id === "project:" + p.id,
    ) || { autoStart: true, concurrencyLimit: 2 };
  const mode = (p) => (policy(p).autoStart === false ? "paused" : "active");
  let stdinUsed = false;
  async function stdinText() {
    if (stdinUsed) throw Error("Stdin can only supply one field");
    stdinUsed = true;
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  }
  async function text(key, required = false) {
    const file = v[key + "-file"];
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
    const patch = {};
    if (v.mode !== undefined) patch.mode = v.mode;
    if (v.active) patch.mode = "active";
    if (v.paused) patch.mode = "paused";
    if (v.limit !== undefined) patch.concurrencyLimit = Number(v.limit);
    if (v.base) patch.baseRef = v.base;
    if (v.model) patch.model = v.model;
    if (v.provider) patch.instanceId = v.provider;
    return patch;
  }
  if (kind === "project") {
    if (action === "list") {
      emit(
        state.projects.map((p) => ({ ...p, mode: mode(p), policy: policy(p) })),
      );
      return;
    }
    if (action === "create" || action === "add") {
      if (!v.path || !v.name)
        throw Error("Use project create --name NAME --path WORKSPACE");
      const ids = {
        projectId: v.id || randomUUID(),
        commandId: v["request-id"] || randomUUID(),
      };
      try {
        emit(
          await api("/projects", {
            ...ids,
            title: v.name,
            workspaceRoot: resolve(v.path),
            createWorkspaceRootIfMissing: v.mkdir === true,
            mode: "paused",
            ...executionPatch(),
          }),
        );
      } catch (error) {
        throw Error(
          error.message +
            "; retry with --id " +
            ids.projectId +
            " --request-id " +
            ids.commandId,
        );
      }
      return;
    }
    const p = await project(id || v.project);
    if (action === "show") {
      emit({
        ...p,
        mode: mode(p),
        policy: policy(p),
        tasks: state.tasks.filter((t) => t.projectId === p.id),
      });
      return;
    }
    if (["pause", "activate", "resume", "set", "update"].includes(action)) {
      const patch = executionPatch();
      if (action === "pause") patch.mode = "paused";
      if (["activate", "resume"].includes(action)) patch.mode = "active";
      if (!Object.keys(patch).length)
        throw Error("Specify --mode, --limit, --base, --model or --provider");
      emit(await api("/projects/" + encodeURIComponent(p.id), patch, "PATCH"));
      return;
    }
  }
  if (kind === "model" && action === "list") {
    emit(state.models);
    return;
  }
  if (kind === "thread" && action === "list") {
    const p = await project();
    emit(projectThreads(p.id));
    return;
  }
  if (kind === "epic") {
    if (action === "list") {
      const p = v.all ? null : await project();
      emit(state.groups.filter((g) => !p || g.projectId === p.id));
      return;
    }
    if (action === "add" || action === "create") {
      if (!v.name) throw Error("Specify --name");
      const p = await project();
      emit(
        await api("/groups", {
          projectId: p.id,
          name: v.name,
          context: (await text("context")) || "",
          acceptanceCriteria: (await text("criteria")) || "",
        }),
      );
      return;
    }
    const groups = v.project
      ? state.groups.filter(
          (g) => g.projectId === find(state.projects, v.project, "project").id,
        )
      : state.groups;
    const g = find(groups, id, "epic"),
      path = "/groups/" + g.id;
    if (action === "show") {
      emit({ ...g, tasks: state.tasks.filter((t) => t.groupId === g.id) });
      return;
    }
    if (action === "summarize") {
      emit(await api(path + "/summarize", {}));
      return;
    }
    if (action === "delete") {
      emit(await api(path, {}, "DELETE"));
      return;
    }
    if (["update", "close", "reopen"].includes(action)) {
      const patch = {};
      if (v.name) patch.name = v.name;
      const context = await text("context"),
        criteria = await text("criteria");
      if (context !== undefined) patch.context = context;
      if (criteria !== undefined) patch.acceptanceCriteria = criteria;
      if (v.status) patch.status = v.status;
      if (action === "close") patch.status = "done";
      if (action === "reopen") patch.status = "active";
      if (!Object.keys(patch).length)
        throw Error("Specify an epic field to update");
      emit(await api(path, patch, "PATCH"));
      return;
    }
  }
  if (kind === "task") {
    if (action === "list") {
      const p = v.all ? null : await project();
      let rows = state.tasks.filter((t) => !p || t.projectId === p.id);
      if (v.epic) {
        const g = find(
          state.groups.filter((g) => !p || g.projectId === p.id),
          v.epic,
          "epic",
        );
        rows = rows.filter((t) => t.groupId === g.id);
      }
      if (v.status) rows = rows.filter((t) => t.status === v.status);
      if (v.priority)
        rows = rows.filter(
          (t) => (t.priority ?? "normal") === v.priority.toLowerCase(),
        );
      if (v.blocked) rows = rows.filter((t) => t.blockingTaskIds?.length);
      rows.sort(
        (a, b) =>
          priorityLevels.indexOf(a.priority ?? "normal") -
            priorityLevels.indexOf(b.priority ?? "normal") ||
          (a.rank ?? 0) - (b.rank ?? 0),
      );
      emit(
        rows.map((t) => ({
          ...t,
          code: "TL-" + t.id.slice(0, 4).toUpperCase(),
        })),
      );
      return;
    }
    if (action === "add" || action === "create") {
      const p = await project(),
        groupId =
          v.epic && v.epic !== "none"
            ? find(
                state.groups.filter((g) => g.projectId === p.id),
                v.epic,
                "epic",
              ).id
            : null;
      const target = taskTarget(p.id);
      const attachments = [];
      for (const path of v.image || []) {
        const bytes = await readFile(resolve(path));
        const mimeType = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
        }[extname(path).toLowerCase()];
        if (!mimeType) throw Error("Use PNG, JPEG or WebP images");
        attachments.push(
          await api("/attachments", {
            base64: bytes.toString("base64"),
            name: path.split("/").at(-1),
            mimeType,
          }),
        );
      }
      const prompt = await text("prompt", true),
        defaults = policy(p),
        selectedThread = state.threads.find((t) => t.id === target.threadId);
      emit(
        await api("/tasks", {
          projectId: p.id,
          groupId,
          ...target,
          ...planningPatch(),
          prompt,
          title: v.title,
          model:
            v.model || selectedThread?.modelSelection?.model || defaults.model,
          instanceId:
            v.provider ||
            selectedThread?.providerInstanceId ||
            defaults.instanceId,
          attachments,
        }),
      );
      return;
    }
    const t = find(
        v.project
          ? state.tasks.filter(
              (t) =>
                t.projectId === find(state.projects, v.project, "project").id,
            )
          : state.tasks,
        id,
        "task",
      ),
      path = "/tasks/" + t.id;
    if (action === "show") {
      emit(await api(path));
      return;
    }
    if (action === "block" || action === "unblock") {
      if (!v.by?.length)
        throw Error("Specify --by TASK (repeat for multiple blockers)");
      emit(await api(path + "/" + action, { blockerIds: blockerIds(v.by) }));
      return;
    }
    if (action === "update") {
      const patch = planningPatch();
      if (v.thread !== undefined || v["thread-key"] !== undefined)
        Object.assign(patch, taskTarget(t.projectId));
      if (v.title) patch.title = v.title;
      const prompt = await text("prompt");
      if (prompt !== undefined) patch.prompt = prompt;
      if (v.epic !== undefined)
        patch.groupId =
          v.epic === "none"
            ? null
            : find(
                state.groups.filter((g) => g.projectId === t.projectId),
                v.epic,
                "epic",
              ).id;
      if (!Object.keys(patch).length)
        throw Error(
          "Specify --title, --prompt, --epic, --thread, --thread-key, --priority or --blocked-by",
        );
      emit(await api(path, patch, "PATCH"));
      return;
    }
    if (action === "pause" || action === "resume") {
      emit(await api(path, { paused: action === "pause" }, "PATCH"));
      return;
    }
    if (action === "accept") {
      emit(await api(path, { status: "done" }, "PATCH"));
      return;
    }
    if (action === "delete") {
      emit(await api(path, {}, "DELETE"));
      return;
    }
    if (
      ["cancel", "retry", "report", "revise", "answer", "approve"].includes(
        action,
      )
    ) {
      let body = {};
      if (action === "revise") body.prompt = await text("prompt", true);
      if (["answer", "approve"].includes(action) && !v.request)
        throw Error("Specify --request");
      if (action === "answer") {
        if (!v.answers) throw Error("Specify --answers JSON");
        body = { requestId: v.request, answers: JSON.parse(v.answers) };
      }
      if (action === "approve") {
        if (!v.decision) throw Error("Specify --decision");
        body = { requestId: v.request, decision: v.decision };
      }
      emit(
        await api(
          path + "/" + (action === "revise" ? "revision" : action),
          body,
        ),
      );
      return;
    }
  }
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
