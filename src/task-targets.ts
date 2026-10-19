import type { AppState, Thread } from "../shared/types.js";
const timestamp = (value: string | null | undefined) =>
  Date.parse(value ?? "") || 0;
const latest = (...values: (string | undefined)[]) =>
  Math.max(0, ...values.map(timestamp));
export const selectableThread = (thread: Thread) =>
  !thread.archivedAt &&
  !thread.deletedAt &&
  (thread.lineage?.relationshipToParent ?? thread.relationshipToParent) !==
    "subagent";
export function threadUsedAt(state: AppState, thread: Thread) {
  const history = state.settings.targetHistory?.[thread.projectId];
  const activity = latest(
    thread.lastVisitedAt,
    thread.latestUserAuthoredMessageAt,
    thread.latestUserMessageAt,
  );
  return Math.max(
    activity || latest(thread.updatedAt, thread.createdAt),
    timestamp(history?.threads?.[thread.id]),
    ...state.tasks
      .filter(
        (t) => t.threadId === thread.id && t.projectId === thread.projectId,
      )
      .map((t) => timestamp(t.createdAt)),
  );
}
export function recentThreads(state: AppState, projectId: string) {
  const threads = state.threads.filter(
    (t) => t.projectId === projectId && selectableThread(t),
  );
  const planned = (state.threadTargets ?? [])
    .filter(
      (t) =>
        t.projectId === projectId &&
        !threads.some((thread) => thread.id === t.id),
    )
    .map((t) => ({
      ...t,
      title: t.key,
      status: t.materializedAt ? "missing or archived" : "planned",
    }));
  return [...threads, ...planned]
    .filter((t) => t.projectId === projectId && selectableThread(t))
    .map((thread) => ({ thread, usedAt: threadUsedAt(state, thread) }))
    .sort((a, b) => b.usedAt - a.usedAt)
    .map(({ thread }) => thread);
}
export function recentProjects(state: AppState) {
  const usage = new Map(
    state.projects.map((p) => [
      p.id,
      timestamp(state.settings.targetHistory?.[p.id]?.lastUsedAt),
    ]),
  );
  const track = (projectId: string, usedAt: number) =>
    usage.set(projectId, Math.max(usage.get(projectId) || 0, usedAt));
  for (const task of state.tasks)
    track(task.projectId, timestamp(task.createdAt));
  for (const thread of state.threads) {
    if (!selectableThread(thread)) continue;
    const activity = latest(
      thread.lastVisitedAt,
      thread.latestUserAuthoredMessageAt,
      thread.latestUserMessageAt,
    );
    track(
      thread.projectId,
      Math.max(
        activity || latest(thread.updatedAt, thread.createdAt),
        timestamp(
          state.settings.targetHistory?.[thread.projectId]?.threads?.[
            thread.id
          ],
        ),
      ),
    );
  }
  const legacy = !Object.keys(state.settings.targetHistory ?? {}).length
    ? state.settings.lastProjectId
    : null;
  return [...state.projects].sort(
    (a, b) =>
      (usage.get(b.id) || 0) - (usage.get(a.id) || 0) ||
      Number(b.id === legacy) - Number(a.id === legacy),
  );
}
export function projectTargets(
  state: AppState,
  projectId: string,
  initialGroupId?: string,
) {
  const history = state.settings.targetHistory?.[projectId];
  const threads = recentThreads(state, projectId);
  const tasks = state.tasks
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
  const legacy = state.settings.lastProjectId === projectId;
  let threadId = threads[0]?.id || "";
  if (
    history &&
    !history.threadSelectedAt &&
    threads.some(
      (t) =>
        t.id === history.lastThreadId &&
        threadUsedAt(state, t) === threadUsedAt(state, threads[0]),
    )
  )
    threadId = history.lastThreadId || "";
  if (
    !history &&
    legacy &&
    threads.some(
      (t) =>
        t.id === state.settings.lastThreadId &&
        threadUsedAt(state, t) === threadUsedAt(state, threads[0]),
    )
  )
    threadId = state.settings.lastThreadId || "";
  if (
    history?.lastThreadId === null &&
    timestamp(history.threadSelectedAt) >
      (threads[0] ? threadUsedAt(state, threads[0]) : 0)
  )
    threadId = "";
  const groups = state.groups.filter(
    (g) => g.projectId === projectId && g.status !== "done",
  );
  const rememberedGroup =
    history && "lastGroupId" in history
      ? history.lastGroupId
      : tasks[0] && "groupId" in tasks[0]
        ? tasks[0].groupId
        : legacy
          ? state.settings.lastGroupId
          : null;
  const groupId =
    [initialGroupId, rememberedGroup].find((id) =>
      groups.some((g) => g.id === id),
    ) || "";
  return { threadId, groupId };
}
export function defaultProject(state: AppState, initialProjectId?: string) {
  return initialProjectId &&
    state.projects.some((p) => p.id === initialProjectId)
    ? initialProjectId
    : recentProjects(state)[0]?.id || "";
}
