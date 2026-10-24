import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { CliContext } from "./context.js";
import { priorityLevels } from "./options.js";
export async function runTaskCommand(
  kind: string,
  action: string,
  id: string | undefined,
  context: CliContext,
) {
  const {
    state,
    taskTarget,
    blockerIds,
    planningPatch,
    find,
    project,
    policy,
    text,
    v,
    api,
    emit,
  } = context;
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
          (t) => (t.priority ?? "normal") === v.priority!.toLowerCase(),
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
      return true;
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
        const mimeType = (
          {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
          } as Record<string, string>
        )[extname(path).toLowerCase()];
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
      return true;
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
      return true;
    }
    if (action === "block" || action === "unblock") {
      if (!v.by?.length)
        throw Error("Specify --by TASK (repeat for multiple blockers)");
      emit(await api(path + "/" + action, { blockerIds: blockerIds(v.by) }));
      return true;
    }
    if (action === "update") {
      const patch = planningPatch();
      if (v.status !== undefined) {
        const status = (
          ["todo", "review", "done", "cancelled", "failed"] as const
        ).find((status) => status === v.status);
        if (!status)
          throw Error("Choose status: todo, review, done, cancelled or failed");
        patch.status = status;
      }
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
          "Specify --title, --prompt, --epic, --thread, --thread-key, --priority, --blocked-by or --status",
        );
      emit(await api(path, patch, "PATCH"));
      return true;
    }
    if (action === "pause" || action === "resume") {
      emit(await api(path, { paused: action === "pause" }, "PATCH"));
      return true;
    }
    if (action === "accept") {
      emit(await api(path, { status: "done" }, "PATCH"));
      return true;
    }
    if (action === "delete") {
      emit(await api(path, {}, "DELETE"));
      return true;
    }
    if (
      ["cancel", "retry", "report", "revise", "answer", "approve"].includes(
        action,
      )
    ) {
      let body: Record<string, unknown> = {};
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
      return true;
    }
  }
  return false;
}
