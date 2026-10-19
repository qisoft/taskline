import type {
  SelectionInput,
  Settings,
  TargetHistory,
} from "../shared/types.js";
export function recordTargetUsage<S extends Settings>(
  settings: S,
  input: SelectionInput,
  now = new Date().toISOString(),
) {
  let history = settings.targetHistory ?? {};
  if (!Object.keys(history).length && settings.lastProjectId) {
    const legacy: TargetHistory = {};
    if ("lastThreadId" in settings) legacy.lastThreadId = settings.lastThreadId;
    if ("lastGroupId" in settings) legacy.lastGroupId = settings.lastGroupId;
    history = { [settings.lastProjectId]: legacy };
  }
  const previous = history[input.projectId] ?? {};
  const entry = { ...previous, lastUsedAt: now };
  const update = { ...settings, lastProjectId: input.projectId };
  if ("threadId" in input) {
    entry.lastThreadId = input.threadId || null;
    entry.threadSelectedAt = now;
    if (input.threadId)
      entry.threads = { ...previous.threads, [input.threadId]: now };
    update.lastThreadId = entry.lastThreadId;
  }
  if ("groupId" in input) {
    entry.lastGroupId = input.groupId || null;
    if (input.groupId)
      entry.groups = { ...previous.groups, [input.groupId]: now };
    update.lastGroupId = entry.lastGroupId;
  }
  return { ...update, targetHistory: { ...history, [input.projectId]: entry } };
}
