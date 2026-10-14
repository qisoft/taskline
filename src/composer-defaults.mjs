export function projectModel(state, projectId, threadId = "") {
  const threads = state.threads.filter(
    (t) =>
      t.projectId === projectId &&
      !t.archivedAt &&
      (t.lineage?.relationshipToParent ?? t.relationshipToParent) !==
        "subagent",
  );
  const selected = threads.find((t) => t.id === threadId);
  const selection = (t) => ({
    instanceId: t.modelSelection?.instanceId || t.providerInstanceId,
    model: t.modelSelection?.model,
  });
  const history = [
    ...threads.map((t) => ({
      ...selection(t),
      date: t.updatedAt || t.createdAt || "",
    })),
    ...state.tasks
      .filter((t) => t.projectId === projectId)
      .map((t) => ({
        instanceId: t.instanceId,
        model: t.model,
        date: t.createdAt || "",
      })),
  ]
    .filter((m) => m.instanceId && m.model)
    .sort((a, b) => b.date.localeCompare(a.date));
  const policy = state.projectSettings.find(
    (s) => s.id === projectId || s.id === "project:" + projectId,
  );
  const model =
    (selected && selection(selected).model && selection(selected).instanceId
      ? selection(selected)
      : history[0]) ||
    policy ||
    {};
  return (model.instanceId || "codex") + "::" + (model.model || "gpt-6-luna");
}
