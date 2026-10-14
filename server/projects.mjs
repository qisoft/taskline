import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export function projectPolicy(input) {
  const patch = {};
  if (input.mode !== undefined) {
    if (!["active", "paused"].includes(input.mode))
      throw Error("Project mode must be active or paused");
    patch.autoStart = input.mode === "active";
  }
  if (input.autoStart !== undefined) {
    if (typeof input.autoStart !== "boolean")
      throw Error("autoStart must be a boolean");
    if (input.mode !== undefined && input.autoStart !== patch.autoStart)
      throw Error("Conflicting project mode and autoStart");
    patch.autoStart = input.autoStart;
  }
  if (input.concurrencyLimit !== undefined) {
    const limit = Number(input.concurrencyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 16)
      throw Error("Parallel limit must be 1–16");
    patch.concurrencyLimit = limit;
  }
  for (const key of ["baseRef", "model", "instanceId", "runtimeMode"])
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string" || !input[key].trim())
        throw Error(key + " must be non-empty");
      patch[key] = input[key].trim();
    }
  return patch;
}
export class ProjectService {
  constructor(store, scheduler, notify) {
    this.store = store;
    this.scheduler = scheduler;
    this.notify = notify;
  }
  update(id, input) {
    if (!this.scheduler.projects.some((p) => p.id === id))
      throw Error("Project not found");
    const settings = {
      ...this.scheduler.projectSettings(id),
      ...projectPolicy(input),
      id: "project:" + id,
    };
    delete settings.mode;
    this.store.put("settings", settings);
    this.notify();
    this.scheduler.signal();
    return {
      ...settings,
      mode: settings.autoStart === false ? "paused" : "active",
    };
  }
  async create(input) {
    if (!input.title?.trim()) throw Error("Enter a project name");
    if (!input.workspaceRoot || !isAbsolute(input.workspaceRoot))
      throw Error("Choose an absolute workspace path");
    const id = input.projectId || randomUUID();
    const commandId = input.commandId || randomUUID();
    // The pause policy exists before T3 publishes the new project to any client.
    const existing = this.store.get("settings", "project:" + id);
    const settings = {
      ...(existing ?? {}),
      autoStart: false,
      ...projectPolicy(input),
      id: "project:" + id,
    };
    delete settings.mode;
    this.store.put("settings", settings);
    try {
      const project = await this.scheduler.t3.call("projects.mutate", {
        type: "project.create",
        commandId,
        projectId: id,
        title: input.title.trim(),
        workspaceRoot: input.workspaceRoot,
        createWorkspaceRootIfMissing:
          input.createWorkspaceRootIfMissing === true,
      });
      this.scheduler.projects = [
        ...this.scheduler.projects.filter((p) => p.id !== project.id),
        project,
      ];
      this.notify();
      this.scheduler.signal();
      return {
        ...project,
        mode: settings.autoStart === false ? "paused" : "active",
        policy: this.scheduler.projectSettings(id),
      };
    } catch (error) {
      // Preserve the same IDs/policy on unknown outcomes so retries stay paused.
      if (!/timed out|disconnected|unknown/i.test(error.message)) {
        if (existing) this.store.put("settings", existing);
        else this.store.remove("settings", "project:" + id);
      }
      throw Error(
        error.message +
          " (projectId: " +
          id +
          ", commandId: " +
          commandId +
          ")",
      );
    }
  }
}
