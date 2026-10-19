import { stateFixture, taskFixture } from "./helpers.js";
import { seed } from "./helpers.js";
import { tcpPort } from "./helpers.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { startServer } from "../server/index.js";
import { recordTargetUsage } from "../server/target-history.js";
import {
  defaultProject,
  projectTargets,
  recentProjects,
  recentThreads,
} from "../src/task-targets.js";

const state = () =>
  stateFixture({
    projects: [
      { id: "a", title: "a", workspaceRoot: "/fixture/a" },
      { id: "b", title: "b", workspaceRoot: "/fixture/b" },
      { id: "empty", title: "empty", workspaceRoot: "/fixture/empty" },
    ],
    threads: [
      {
        id: "a-old",
        projectId: "a",
        latestUserMessageAt: "2026-10-10T10:00:00Z",
        updatedAt: "2026-10-15T10:00:00Z",
      },
      { id: "a-last", projectId: "a", lastVisitedAt: "2026-10-12T10:00:00Z" },
      {
        id: "b-last",
        projectId: "b",
        latestUserAuthoredMessageAt: "2026-10-13T10:00:00Z",
      },
      {
        id: "child",
        projectId: "a",
        updatedAt: "2026-10-20T10:00:00Z",
        lineage: { relationshipToParent: "subagent" },
      },
      {
        id: "archived",
        projectId: "a",
        updatedAt: "2026-10-20T10:00:00Z",
        archivedAt: "2026-10-20",
      },
    ],
    tasks: [],
    groups: [
      { id: "a-epic", projectId: "a", status: "active" },
      { id: "b-epic", projectId: "b", status: "active" },
    ],
    settings: { id: "app" },
  });
test("sorts by user activity and restores project-scoped selections", () => {
  const s = state();
  assert.deepEqual(
    recentProjects(s).map((p) => p.id),
    ["b", "a", "empty"],
  );
  assert.deepEqual(
    recentThreads(s, "a").map((t) => t.id),
    ["a-last", "a-old"],
  );
  assert.equal(defaultProject(s), "b");
  assert.equal(defaultProject(s, "a"), "a");
  assert.equal(projectTargets(s, "a").threadId, "a-last");
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "a", threadId: "a-old", groupId: "a-epic" },
    "2026-10-14T10:00:00Z",
  );
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "b", threadId: "b-last", groupId: "b-epic" },
    "2026-10-15T10:00:00Z",
  );
  assert.deepEqual(projectTargets(s, "a"), {
    threadId: "a-old",
    groupId: "a-epic",
  });
  assert.deepEqual(projectTargets(s, "b"), {
    threadId: "b-last",
    groupId: "b-epic",
  });
  assert.equal(defaultProject(s), "b");
});
test("preserves New thread and No epic while recovering the thread created by a later task", () => {
  const s = state();
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "a", threadId: null, groupId: null },
    "2026-10-16T10:00:00Z",
  );
  assert.deepEqual(projectTargets(s, "a"), { threadId: "", groupId: "" });
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "b" },
    "2026-10-17T10:00:00Z",
  );
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "a" },
    "2026-10-18T10:00:00Z",
  );
  assert.deepEqual(projectTargets(s, "a"), { threadId: "", groupId: "" });
  s.tasks.push(
    taskFixture({
      projectId: "a",
      threadId: "a-last",
      groupId: null,
      createdAt: "2026-10-16T10:00:00Z",
    }),
  );
  assert.equal(projectTargets(s, "a").threadId, "a-last");
});
test("legacy defaults, invalid references and empty projects remain safe", () => {
  const s = state();
  s.settings = {
    ...s.settings,
    lastProjectId: "a",
    lastThreadId: "a-old",
    lastGroupId: "b-epic",
  };
  assert.equal(defaultProject(s), "b");
  assert.deepEqual(projectTargets(s, "a"), { threadId: "a-last", groupId: "" });
  s.settings = recordTargetUsage(s.settings, {
    projectId: "a",
    threadId: "archived",
    groupId: "missing",
  });
  assert.deepEqual(projectTargets(s, "a"), { threadId: "a-last", groupId: "" });
  assert.deepEqual(projectTargets(s, "empty"), { threadId: "", groupId: "" });
  s.tasks.push(
    taskFixture({
      projectId: "b",
      groupId: "b-epic",
      createdAt: "2026-10-13T12:00:00Z",
    }),
  );
  assert.equal(projectTargets(s, "b").groupId, "b-epic");
});
test("selection API persists separate project histories and rejects foreign targets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-history-"));
  const runtime = await startServer({ port: 0, dataDir: directory });
  runtime.scheduler.stop();
  const s = state();
  runtime.scheduler.projects = s.projects;
  runtime.scheduler.threads = s.threads;
  for (const group of s.groups) seed(runtime.store, "groups", group);
  const origin = "http://127.0.0.1:" + tcpPort(runtime.server);
  const select = (input: import("../shared/types.js").SelectionInput) =>
    fetch(origin + "/api/selection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  let reopened;
  try {
    assert.equal(
      (await select({ projectId: "a", threadId: "b-last" })).status,
      400,
    );
    assert.equal(
      (await select({ projectId: "a", threadId: "archived" })).status,
      400,
    );
    assert.equal(
      (await select({ projectId: "a", threadId: "child" })).status,
      400,
    );
    assert.equal(
      (await select({ projectId: "a", groupId: "b-epic" })).status,
      400,
    );
    assert.equal(
      (await select({ projectId: "a", threadId: "a-old", groupId: "a-epic" }))
        .status,
      200,
    );
    assert.equal(
      (await select({ projectId: "b", threadId: "b-last", groupId: "b-epic" }))
        .status,
      200,
    );
    assert.equal((await select({ projectId: "a" })).status, 200);
    const task = await fetch(origin + "/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "b",
        threadId: "b-last",
        groupId: "b-epic",
        prompt: "Persist task target without running an agent",
      }),
    });
    assert.equal(task.status, 201);
    const settings = runtime.store.settings("app");
    assert.equal(settings.lastProjectId, "b");
    assert.equal(settings.targetHistory!.a.lastThreadId, "a-old");
    assert.equal(settings.targetHistory!.b.lastGroupId, "b-epic");
    runtime.close();
    reopened = new Store(directory);
    assert.deepEqual(
      reopened.settings("app").targetHistory,
      settings.targetHistory,
    );
  } finally {
    if (reopened) reopened.close();
    else runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("future thread selections restore before creation and remain singular after materialization", () => {
  const s = state();
  s.threadTargets = [
    {
      id: "future",
      projectId: "a",
      key: "api",
      createdAt: "2026-10-16T10:00:00Z",
      materializedAt: null,
    },
    {
      id: "foreign-future",
      projectId: "b",
      key: "api",
      createdAt: "2026-10-16T10:00:00Z",
      materializedAt: null,
    },
  ];
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "a", threadId: "future", groupId: "a-epic" },
    "2026-10-17T10:00:00Z",
  );
  assert.deepEqual(projectTargets(s, "a"), {
    threadId: "future",
    groupId: "a-epic",
  });
  assert.equal(
    recentThreads(s, "a").filter((t) => t.id === "future").length,
    1,
  );
  assert.equal(
    recentThreads(s, "a").some((t) => t.id === "foreign-future"),
    false,
  );
  s.threads.push({
    id: "future",
    projectId: "a",
    title: "API",
    status: "idle",
  });
  s.threadTargets[0].materializedAt = "2026-10-18T10:00:00Z";
  assert.equal(
    recentThreads(s, "a").filter((t) => t.id === "future").length,
    1,
  );
  s.settings = recordTargetUsage(
    s.settings,
    { projectId: "a", threadId: null },
    "2026-10-19T10:00:00Z",
  );
  assert.equal(projectTargets(s, "a").threadId, "");
});
