import type { Priority, Task } from "../shared/types.js";
export const priorities = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];
export function compareTaskPriority(a: Task, b: Task) {
  const order = (task: Task) =>
    priorities.findIndex((p) => p.value === (task.priority ?? "normal"));
  return (
    order(a) - order(b) ||
    (Number(a.rank) || Date.parse(a.createdAt) || 0) -
      (Number(b.rank) || Date.parse(b.createdAt) || 0) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
  );
}
export function pendingBlockers(
  task: Pick<Task, "blockedBy">,
  tasksById: { get(id: string): Pick<Task, "status"> | null | undefined },
) {
  return (task.blockedBy ?? []).filter(
    (id) => !["review", "done"].includes(tasksById.get(id)?.status ?? ""),
  );
}
export function taskPlanningView(task: Task, tasksById: Map<string, Task>) {
  return {
    ...task,
    labels: task.labels ?? [],
    priority: task.priority ?? "normal",
    blockedBy: task.blockedBy ?? [],
    blockingTaskIds: pendingBlockers(task, tasksById),
  };
}
export function validateTaskPlanning(
  task: Pick<Task, "id" | "status">,
  input: { priority?: unknown; blockedBy?: unknown },
  tasks: Task[],
) {
  const patch: { priority?: Priority; blockedBy?: string[] } = {};
  if ("priority" in input) {
    if (!priorities.some((p) => p.value === input.priority))
      throw Error("Choose priority: urgent, high, normal, low or none");
    patch.priority = input.priority as Priority;
  }
  if ("blockedBy" in input) {
    if (task.status === "doing")
      throw Error("Stop the running task before changing blockers");
    if (
      !Array.isArray(input.blockedBy) ||
      input.blockedBy.length > 100 ||
      input.blockedBy.some((id) => typeof id !== "string" || !id)
    )
      throw Error("Blockers must be a list of up to 100 task IDs");
    patch.blockedBy = [...new Set(input.blockedBy)];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const id of patch.blockedBy) {
      if (id === task.id) throw Error("A task cannot block itself");
      if (!byId.has(id)) throw Error("Blocking task not found: " + id);
    }
    const pending = [...patch.blockedBy],
      seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === task.id)
        throw Error("Blockers would create a dependency cycle");
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(byId.get(id)?.blockedBy ?? []));
    }
  }
  return patch;
}
