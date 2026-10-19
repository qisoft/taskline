import assert from "node:assert/strict";
import type { Server } from "node:net";
import type { T3Client } from "../server/t3.js";
import type { Store } from "../server/store.js";
import type {
  T3RpcRequests,
  T3RpcResults,
  Project,
  StoreTables,
  AppState,
  AppSettings,
  Task,
  Thread,
  ProjectPolicy,
  ModelSelection,
} from "../shared/types.js";

export function tcpPort(server: Server) {
  const address = server.address();
  assert.ok(
    address && typeof address !== "string",
    "Fixture must listen on TCP",
  );
  return address.port;
}

export function mockProjectCreation(
  client: T3Client,
  create = async (
    input: T3RpcRequests["projects.mutate"],
  ): Promise<Project> => ({
    id: input.projectId,
    title: input.title,
    workspaceRoot: input.workspaceRoot,
  }),
) {
  client.call = async <K extends keyof T3RpcResults>(
    tag: K,
    input: T3RpcRequests[K],
  ): Promise<T3RpcResults[K]> => {
    assert.equal(tag, "projects.mutate");
    return (await create(
      input as T3RpcRequests["projects.mutate"],
    )) as T3RpcResults[K];
  };
}

// Persist intentionally incomplete records to exercise legacy data and API defaults.
export function seed<K extends keyof StoreTables>(
  store: Store,
  table: K,
  row: Partial<StoreTables[K]> & { id: string },
) {
  return store.put(table, row as StoreTables[K]);
}

export function taskFixture(input: Partial<Task>): Task {
  return {
    id: "fixture",
    title: "Fixture",
    projectId: "p",
    prompt: "Fixture",
    status: "todo",
    executionState: "idle",
    attachments: [],
    questions: [],
    rank: 1,
    paused: false,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    ...input,
  };
}
export function settingsFixture(input: Partial<AppSettings> = {}): AppSettings {
  return {
    id: "app",
    paused: false,
    textShortcut: "CommandOrControl+Shift+1",
    screenshotShortcut: "CommandOrControl+Shift+2",
    boardShortcut: "CommandOrControl+Shift+0",
    showInDock: true,
    launchAtLogin: false,
    ...input,
  };
}
type StateInput = Omit<
  Partial<AppState>,
  | "tasks"
  | "threads"
  | "projects"
  | "groups"
  | "projectSettings"
  | "settings"
  | "connection"
> & {
  tasks?: Partial<Task>[];
  threads?: (Omit<Partial<Thread>, "modelSelection"> & {
    modelSelection?: Partial<ModelSelection> | null;
  })[];
  projects?: Partial<Project>[];
  groups?: Partial<StoreTables["groups"]>[];
  projectSettings?: Partial<ProjectPolicy>[];
  settings?: Partial<AppSettings>;
  connection?: Partial<AppState["connection"]>;
};
export function stateFixture(input: StateInput = {}): AppState {
  return {
    dataDir: "/fixture",
    models: [],
    threadTargets: [],
    ...input,
    tasks: (input.tasks ?? []).map(taskFixture),
    projects: (input.projects ?? []).map((p) => ({
      id: "p",
      title: "Project",
      workspaceRoot: "/fixture",
      ...p,
    })),
    threads: (input.threads ?? []).map(({ modelSelection, ...t }) => ({
      id: "t",
      projectId: "p",
      title: "Thread",
      ...t,
      ...(modelSelection
        ? {
            modelSelection: {
              instanceId: t.providerInstanceId ?? "codex",
              model: "gpt-6-luna",
              ...modelSelection,
            },
          }
        : {}),
    })),
    groups: (input.groups ?? []).map((g) => ({
      id: "g",
      name: "Epic",
      status: "active",
      context: "",
      contextVersion: 1,
      createdAt: "2026-10-12T00:00:00Z",
      ...g,
    })),
    projectSettings: (input.projectSettings ?? []).map((p) => ({
      id: "p",
      autoStart: true,
      concurrencyLimit: 2,
      model: "gpt-6-luna",
      instanceId: "codex",
      baseRef: "main",
      runtimeMode: "full-access",
      mode: "active",
      ...p,
    })),
    settings: settingsFixture(input.settings),
    connection: {
      origin: null,
      error: null,
      connected: false,
      ...input.connection,
    },
  };
}
