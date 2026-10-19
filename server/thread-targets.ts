import type { Store } from "./store.js";
import type { Thread } from "../shared/types.js";
import { randomUUID } from "node:crypto";

// A key is project-scoped. Reserve the T3 ID locally; launch only on admission.
// Call inside the transaction that saves the task so failed edits leave no binding.
export function taskThreadTarget(
  store: Store,
  threads: Thread[],
  projectId: string,
  input: { threadKey?: string | null; threadId?: string | null },
) {
  if (input.threadKey != null && typeof input.threadKey !== "string")
    throw Error("Thread key must be text");
  const key = input.threadKey?.trim();
  if (input.threadKey != null && (!key || key.length > 120))
    throw Error("Use a thread key between 1 and 120 characters");
  if (key && input.threadId)
    throw Error("Choose either a thread ID or a thread key");
  if (key) {
    let target = store
      .list("threadTargets")
      .find((t) => t.projectId === projectId && t.key === key);
    if (!target)
      target = store.put("threadTargets", {
        id: randomUUID(),
        projectId,
        key,
        createdAt: new Date().toISOString(),
        materializedAt: null,
      });
    return { threadId: target.id, threadKey: target.key };
  }
  if (!input.threadId) return { threadId: null, threadKey: null };
  const target = store.get("threadTargets", input.threadId);
  if (target?.projectId === projectId)
    return { threadId: target.id, threadKey: target.key };
  const thread = threads.find(
    (t) =>
      t.id === input.threadId &&
      t.projectId === projectId &&
      !t.archivedAt &&
      !t.deletedAt &&
      (t.lineage?.relationshipToParent ?? t.relationshipToParent) !==
        "subagent",
  );
  if (!thread) throw Error("Choose a thread in this project");
  return { threadId: thread.id, threadKey: null };
}
