import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Epic, Settings } from "../shared/types.js";
import type { CliContext } from "./context.js";
const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));
export async function runProjectCommand(
  kind: string,
  action: string,
  id: string | undefined,
  context: CliContext,
) {
  const {
    state,
    projectThreads,
    find,
    project,
    policy,
    mode,
    text,
    executionPatch,
    v,
    api,
    emit,
  } = context;
  if (kind === "project") {
    if (action === "list") {
      emit(
        state.projects.map((p) => ({ ...p, mode: mode(p), policy: policy(p) })),
      );
      return true;
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
      } catch (caught) {
        const error = asError(caught);
        throw Error(
          error.message +
            "; retry with --id " +
            ids.projectId +
            " --request-id " +
            ids.commandId,
        );
      }
      return true;
    }
    const p = await project(id || v.project);
    if (action === "show") {
      emit({
        ...p,
        mode: mode(p),
        policy: policy(p),
        tasks: state.tasks.filter((t) => t.projectId === p.id),
      });
      return true;
    }
    if (["pause", "activate", "resume", "set", "update"].includes(action)) {
      const patch = executionPatch();
      if (action === "pause") patch.mode = "paused";
      if (["activate", "resume"].includes(action)) patch.mode = "active";
      if (!Object.keys(patch).length)
        throw Error("Specify --mode, --limit, --base, --model or --provider");
      emit(await api("/projects/" + encodeURIComponent(p.id), patch, "PATCH"));
      return true;
    }
  }
  if (kind === "model" && action === "list") {
    emit(state.models);
    return true;
  }
  if (kind === "thread" && action === "list") {
    const p = await project();
    emit(projectThreads(p.id));
    return true;
  }
  if (kind === "epic") {
    if (action === "list") {
      const p = v.all ? null : await project();
      emit(state.groups.filter((g) => !p || g.projectId === p.id));
      return true;
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
      return true;
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
      return true;
    }
    if (action === "summarize") {
      emit(await api(path + "/summarize", {}));
      return true;
    }
    if (action === "delete") {
      emit(await api(path, {}, "DELETE"));
      return true;
    }
    if (["update", "close", "reopen"].includes(action)) {
      const patch: Partial<Settings & Epic> = {};
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
      return true;
    }
  }
  return false;
}
