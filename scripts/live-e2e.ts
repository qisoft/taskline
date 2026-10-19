import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import type { AppState, Epic, Task, TaskDetail } from "../shared/types.js";
const origin = process.env.TASKLINE_TEST_ORIGIN || "http://127.0.0.1:4318";
const call = async <T = unknown>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) => {
  const response = await fetch(origin + "/api" + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value as T;
};
const initial = await call<AppState>("/state");
const project = initial.projects.find((p) => p.title === "Taskline E2E");
assert(project, "Disposable project must exist");
const seed = initial.tasks.find(
  (t) => t.title === "E2E: multiply with real tests",
);
assert(seed?.threadId, "Initial execution thread must exist");
await call(
  "/projects/" + encodeURIComponent(project.id),
  { concurrencyLimit: 2, autoStart: true },
  "PATCH",
);
const group = await call<Epic>("/groups", {
  name: "E2E Scheduler " + Date.now(),
  context:
    "These are disposable execution tests. Work only in the selected project. Keep files in the current working directory. Do not commit, deploy or create PRs.",
  acceptanceCriteria:
    "Sequential tasks retain context, independent threads run in separate workspaces, and results are attributed to cards.",
});
const task = (title: string, prompt: string, threadId: string | null = null) =>
  call<Task>("/tasks", {
    title,
    prompt,
    projectId: project.id,
    threadId,
    groupId: group.id,
    model: "gpt-6-luna",
  });
const A = await task(
  "E2E scheduler A",
  "Use the terminal to create sequential-a.txt containing TASKLINE-A. Run npm test. Report the exact result. Do not modify arithmetic code.",
  seed.threadId,
);
const B = await task(
  "E2E scheduler B",
  "This task must run after A in the same thread. Use the terminal to verify sequential-a.txt exists and contains TASKLINE-A, then create sequential-b.txt containing TASKLINE-B. Run npm test and report the result.",
  seed.threadId,
);
const C = await task(
  "E2E scheduler C",
  "In this separate workspace create independent-c.txt containing TASKLINE-C. Run npm test. Report the exact result.",
);
const D = await task(
  "E2E scheduler D",
  "In this separate workspace create independent-d.txt containing TASKLINE-D. Run npm test. Report the exact result.",
);
const ids = [A.id, B.id, C.id, D.id],
  samples = [];
let sawParallel = false;
let lastLog = "";
const deadline = Date.now() + 360000;
const controller = new AbortController();
const response = await fetch(origin + "/api/events", {
  signal: controller.signal,
});
const reader = response.body!.getReader();
try {
  while (Date.now() < deadline) {
    const state = await call<AppState>("/state");
    const tasks = state.tasks.filter((t) => ids.includes(t.id));
    const active: Task[] = state.tasks.filter(
      (t) => t.projectId === project.id && t.status === "doing",
    );
    assert(active.length <= 2, "Project cap exceeded");
    const ownedActive = tasks.filter((t) => t.status === "doing");
    if (
      ownedActive.length === 2 &&
      ownedActive[0].threadId !== ownedActive[1].threadId
    )
      sawParallel = true;
    samples.push({
      time: new Date().toISOString(),
      active: active.map((t) => t.id),
      tasks: tasks.map((t) => ({
        id: t.id,
        state: t.status,
        execution: t.executionState,
        threadId: t.threadId,
      })),
    });
    const log = tasks
      .map(
        (t) =>
          t.title.replace("E2E scheduler ", "") +
          ":" +
          t.status +
          "/" +
          (t.reportState ?? ""),
      )
      .join(" ");
    if (log !== lastLog) {
      console.log(log);
      lastLog = log;
    }
    const failed = tasks.find((t) => t.status === "failed");
    if (failed) throw Error(failed.title + ": " + failed.error);
    if (
      tasks.length === 4 &&
      tasks.every((t) => t.status === "review" && t.reportState === "ready")
    )
      break;
    const next = reader.read();
    await Promise.race([
      next,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
  const final = await call<AppState>("/state");
  const tasks = final.tasks.filter((t) => ids.includes(t.id));
  assert(
    tasks.every((t) => t.status === "review" && t.reportState === "ready"),
    "Tasks did not finish with reports",
  );
  const details = await Promise.all(
    ids.map((id) => call<TaskDetail>("/tasks/" + id)),
  );
  const attempts = details.map((d) => d.attempts.at(-1)!);
  assert.equal(attempts[0].threadId, attempts[1].threadId);
  assert.equal(attempts[0].workspace, attempts[1].workspace);
  assert(
    Date.parse(attempts[1].createdAt) >= Date.parse(attempts[0].completedAt!),
    "Same-thread tasks overlapped",
  );
  assert.notEqual(attempts[2].workspace, attempts[3].workspace);
  assert(sawParallel, "Did not observe independent concurrent execution");
  assert(
    attempts[1].evidence!.some((i) =>
      String(i.text).includes(
        "Verified sequential-a.txt exists and contains TASKLINE-A",
      ),
    ),
    "B did not observe A in the same workspace",
  );
  assert.match(
    [
      tasks.find((t) => t.id === B.id)!.report!.summary,
      ...tasks.find((t) => t.id === B.id)!.report!.changes,
    ].join(" "),
    /TASKLINE-A|sequential-a|TASKLINE-B|sequential-b/i,
  );
  assert(
    tasks.every((t) =>
      t.report!.validation.some((v) => v.basis === "observed_output"),
    ),
    "A task report lacks actual test evidence",
  );
  const priorResult = JSON.stringify(details[0].attempts[0].result);
  await call("/tasks/" + A.id, { status: "done" }, "PATCH");
  const priorAfter = await call<TaskDetail>("/tasks/" + A.id);
  assert.equal(
    JSON.stringify(priorAfter.attempts[0].result),
    priorResult,
    "Accepting mutated attempt evidence",
  );
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/live-e2e.json",
    JSON.stringify(
      {
        passed: true,
        projectId: project.id,
        groupId: group.id,
        taskIds: ids,
        sawParallel,
        attempts: attempts.map((a) => ({
          id: a.id,
          threadId: a.threadId,
          runId: a.runId,
          workspace: a.workspace,
          createdAt: a.createdAt,
          completedAt: a.completedAt,
        })),
        samples,
      },
      null,
      2,
    ),
  );
  console.log(
    "LIVE E2E PASSED: project cap, parallel worktree isolation, same-thread FIFO, four real Luna reports, actual test logs and immutable review evidence.",
  );
} finally {
  controller.abort();
}
