import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler } from "../server/scheduler.js";
import { Store } from "../server/store.js";
import { T3Client } from "../server/t3.js";
import type {
  OrchestrationCommand,
  Projection,
  T3RpcResults,
  ThreadLaunchInput,
} from "../shared/types.js";
import { seed } from "./helpers.js";
class FakeT3 extends T3Client {
  projections = new Map<string, Projection>();
  launches: ThreadLaunchInput[] = [];
  dispatches: Extract<OrchestrationCommand, { type: "message.dispatch" }>[] =
    [];
  uncertain = false;
  constructor() {
    super({ token: "test" });
  }
  async projects() {
    return {
      projects: [{ id: "p", title: "Test", workspaceRoot: "/project" }],
    };
  }
  async shell() {
    return {
      threads: [...this.projections.values()].map((p) => ({
        ...p.thread,
        status: p.runs.at(-1)?.status ?? "idle",
        activeRunId: p.runs.some((r) => r.status === "running")
          ? p.runs.at(-1)!.id
          : null,
      })),
    };
  }
  async http<T>() {
    return { environmentId: "test" } as T;
  }
  async call<K extends keyof T3RpcResults>() {
    return { providers: [] } as T3RpcResults[K];
  }
  async subscribe() {
    return () => {};
  }
  async launch(input: ThreadLaunchInput) {
    this.launches.push(input);
    const p: Projection = {
      thread: {
        id: input.threadId,
        projectId: "p",
        title: "Fixture",
        worktreePath: "/worktrees/" + input.threadId,
      },
      runs: [
        {
          id: "run-" + input.threadId,
          userMessageId: input.initialMessage.messageId,
          status: "running",
        },
      ],
      turnItems: [],
      messages: [],
      subagents: [],
      runtimeRequests: [],
      checkpoints: [],
    };
    this.projections.set(input.threadId, p);
    if (this.uncertain) {
      this.uncertain = false;
      throw Error("T3 disconnected");
    }
    return { projection: p };
  }
  async dispatch(command: OrchestrationCommand) {
    assert.equal(command.type, "message.dispatch");
    if (command.type !== "message.dispatch") throw Error("Unexpected command");
    this.dispatches.push(command);
    const p = this.projection(command.threadId);
    p.runs.push({
      id: "run-" + command.messageId,
      userMessageId: command.messageId,
      status: "running",
    });
  }
  async snapshot(id: string) {
    const p = this.projections.get(id);
    if (!p) throw Error("Thread not found");
    return p;
  }
  projection(id: string | null | undefined) {
    assert.ok(id);
    const projection = this.projections.get(id);
    assert.ok(projection);
    return projection;
  }
  close() {}
}
export function fixture() {
  const path = mkdtempSync(join(tmpdir(), "taskline-test-"));
  const store = new Store(path);
  const t3 = new FakeT3();
  const scheduler = new Scheduler(store, t3, () => {});
  scheduler.reports.enqueue = () => {};
  const add = (id: string, threadId: string | null = null) =>
    seed(store, "tasks", {
      id,
      title: id,
      prompt: "Work",
      projectId: "p",
      threadId,
      status: "todo",
      createdAt: new Date().toISOString(),
      rank: Number(id.slice(-1)) || 1,
      attachments: [],
    });
  return {
    store,
    t3,
    scheduler,
    add,
    close: () => {
      scheduler.stop();
      store.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
