import { test } from "node:test";
import assert from "node:assert/strict";
import { projectModel } from "../src/composer-defaults.mjs";

const state = () => ({
  projectSettings: [{ id: "p", instanceId: "codex", model: "gpt-6.1" }],
  tasks: [],
  threads: [
    {
      id: "t",
      projectId: "p",
      providerInstanceId: "claude",
      modelSelection: { model: "opus-5.5" },
      updatedAt: "2026-10-12T12:00:00Z",
    },
  ],
});
test("project model uses the newest project history, with selected thread precedence", () => {
  const s = state();
  assert.equal(projectModel(s, "p"), "claude::opus-5.5");
  s.tasks.push({
    projectId: "p",
    instanceId: "codex",
    model: "gpt-6-luna",
    createdAt: "2026-10-13T12:00:00Z",
  });
  assert.equal(projectModel(s, "p"), "codex::gpt-6-luna");
  assert.equal(projectModel(s, "p", "t"), "claude::opus-5.5");
  s.threads[0].updatedAt = "2026-10-14T12:00:00Z";
  assert.equal(projectModel(s, "p"), "claude::opus-5.5");
});
test("foreign, archived, child and incomplete threads cannot change the project model", () => {
  const s = state();
  s.threads = [
    { ...s.threads[0], projectId: "q" },
    { ...s.threads[0], archivedAt: "2026-10-13" },
    { ...s.threads[0], lineage: { relationshipToParent: "subagent" } },
    { ...s.threads[0], relationshipToParent: "subagent" },
    { ...s.threads[0], modelSelection: null },
  ];
  s.tasks.push({ projectId: "q", model: "opus-5.5", instanceId: "claude" });
  assert.equal(projectModel(s, "p"), "codex::gpt-6.1");
  assert.equal(projectModel(s, "empty"), "codex::gpt-6-luna");
});
