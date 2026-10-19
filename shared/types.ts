export type Priority = "urgent" | "high" | "normal" | "low" | "none";
export type TaskStatus =
  | "todo"
  | "doing"
  | "review"
  | "done"
  | "failed"
  | "cancelled";
export type ReportState = "idle" | "pending" | "ready" | "error";
export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}
export interface ImageReference {
  reference: string;
  evidenceIds: string[];
}
export interface ValidationImage extends ImageAttachment {
  sha256: string;
  sources: (ImageReference & { kind: string })[];
}
export interface ValidationArtifacts {
  validationImages?: ValidationImage[];
  validationImageIssues?: (ImageReference & { message: string })[];
  validationArtifactsCollectedAt?: string | null;
}
export interface SourceRef {
  itemId: string;
  note: string;
}
export interface ReportMetadata {
  generatedAt?: string;
  model?: string;
  inputHash?: string;
}
export interface TaskReport extends ReportMetadata {
  summary: string;
  changes: string[];
  questions: {
    text: string;
    blocking: boolean;
    scope: string;
    sourceRefs: SourceRef[];
  }[];
  validation: {
    label: string;
    command: string | null;
    outcome: string;
    basis: string;
    sourceRefs: SourceRef[];
  }[];
  remainingWork: string[];
  sourceRefs: SourceRef[];
}
export interface GroupReport extends ReportMetadata {
  overview: string;
  achievements: string[];
  openQuestions: string[];
  blockers: string[];
  validationCoverage: string[];
  suggestedNextActions: string[];
  sourceRefs: SourceRef[];
}
export interface Question {
  id: string;
  header?: string;
  question: string;
  options?: { label: string; value?: string; description?: string }[];
  required?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}
export interface RuntimeQuestion {
  requestId: string;
  type: string;
  questions: Question[];
  prompt: string;
  options: string[];
  requestKind?: string;
}
export type Answers = Record<string, { answers: string[] }>;
export interface Task extends ValidationArtifacts {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  originalPrompt?: string;
  threadId?: string | null;
  threadKey?: string | null;
  groupId?: string | null;
  model?: string;
  instanceId?: string;
  attachments: ImageAttachment[];
  status: TaskStatus;
  executionState: string;
  priority?: Priority;
  blockedBy?: string[];
  blockingTaskIds?: string[];
  rank: number;
  createdAt: string;
  updatedAt: string;
  questions: RuntimeQuestion[];
  report?: TaskReport | null;
  reportState?: ReportState;
  reportError?: string | null;
  paused: boolean;
  waitReason?: string | null;
  currentAttemptId?: string | null;
  error?: string | null;
  completedAt?: string;
  resultVersion?: string;
  failureAcknowledged?: boolean;
}
export interface Attempt extends ValidationArtifacts {
  id: string;
  taskId: string;
  projectId: string;
  threadId: string;
  newThread: boolean;
  commandId: string;
  messageId: string;
  runId: string | null;
  runIds?: string[];
  state: string;
  workspace?: string | null;
  compiledPrompt: string;
  contextVersion?: number | null;
  attachments: UploadedImage[];
  createdAt: string;
  updatedAt?: string;
  model: string;
  instanceId: string;
  runtimeMode: string;
  baseRef: string;
  error?: string;
  evidence?: Evidence[];
  questions?: RuntimeQuestion[];
  result?: TaskReport;
  reportState?: ReportState;
  reportError?: string | null;
  completedAt?: string;
  evidenceEnriched?: boolean;
  fileChanges?: FileChange[];
  checkpoints?: Checkpoint[];
}
export interface FileChange {
  id: string;
  fileName?: string;
  diff: string;
  changes: { path?: string; kind?: string }[];
}
export interface Checkpoint {
  id: string;
  runId: string;
  [key: string]: unknown;
}
export interface Epic {
  id: string;
  projectId?: string;
  name: string;
  context: string;
  acceptanceCriteria?: string;
  decisions?: string[];
  contextVersion: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  summary?: GroupReport | null;
  summaryState?: ReportState;
  summaryError?: string | null;
}
export interface ThreadTarget {
  id: string;
  projectId: string;
  key: string;
  createdAt: string;
  materializedAt: string | null;
  updatedAt?: string;
}
export interface ModelSelection {
  instanceId: string;
  model: string;
}
export interface Project {
  id: string;
  title: string;
  workspaceRoot: string;
  defaultModelSelection?: ModelSelection | null;
  createdAt?: string;
  updatedAt?: string;
}
export interface Thread {
  id: string;
  projectId: string;
  title: string;
  status?: string;
  activeRunId?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  relationshipToParent?: string | null;
  lineage?: { relationshipToParent?: string };
  modelSelection?: ModelSelection;
  providerInstanceId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastVisitedAt?: string;
  latestUserAuthoredMessageAt?: string;
  latestUserMessageAt?: string;
}
export interface TargetHistory {
  lastThreadId?: string | null;
  lastGroupId?: string | null;
  lastUsedAt?: string;
  threadSelectedAt?: string;
  threads?: Record<string, string>;
  groups?: Record<string, string>;
}
export interface Settings {
  id: string;
  paused?: boolean;
  textShortcut?: string;
  screenshotShortcut?: string;
  boardShortcut?: string;
  showInDock?: boolean;
  launchAtLogin?: boolean;
  lastProjectId?: string | null;
  lastThreadId?: string | null;
  lastGroupId?: string | null;
  targetHistory?: Record<string, TargetHistory>;
  codexPath?: string;
  reportModel?: string;
  autoStart?: boolean;
  concurrencyLimit?: number;
  model?: string;
  instanceId?: string;
  baseRef?: string;
  runtimeMode?: string;
  mode?: string;
}
export interface AppSettings extends Settings {
  paused: boolean;
  textShortcut: string;
  screenshotShortcut: string;
  boardShortcut: string;
  showInDock: boolean;
  launchAtLogin: boolean;
}
export interface ProjectPolicy extends Settings {
  concurrencyLimit: number;
  autoStart: boolean;
  model: string;
  instanceId: string;
  baseRef: string;
  runtimeMode: string;
  mode: string;
}
export interface ConnectionConfig {
  origin?: string;
  token?: string;
}
export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  detail: unknown;
  createdAt: string;
}
export interface StoreTables {
  tasks: Task;
  attempts: Attempt;
  groups: Epic;
  settings: Settings;
  events: TaskEvent;
  jobs: { id: string };
  threadTargets: ThreadTarget;
}
export interface Model {
  instanceId: string;
  id: string;
  label: string;
}
export interface AppState {
  tasks: Task[];
  groups: Epic[];
  projects: Project[];
  threads: Thread[];
  threadTargets: ThreadTarget[];
  models: Model[];
  projectSettings: ProjectPolicy[];
  settings: AppSettings;
  connection: {
    origin: string | null;
    connected: boolean;
    error: string | null;
    environmentId?: string | null;
  };
  dataDir: string;
}
export interface TaskDetail {
  task: Task;
  attempts: Attempt[];
  events: TaskEvent[];
}
export interface SelectionInput {
  projectId: string;
  threadId?: string | null;
  groupId?: string | null;
}
export interface TurnItem {
  id: string;
  runId: string;
  type: string;
  status?: string;
  title?: string;
  text?: string;
  output?: string;
  description?: string;
  role?: string;
  content?: string;
  requestId?: string;
  questions?: Question[];
  prompt?: string;
  options?: string[];
  requestKind?: string;
  fileName?: string;
  diffStr?: string;
  changes?: { path?: string; kind?: string }[];
  command?: string;
  exitCode?: number | null;
  [key: string]: unknown;
}
export interface Evidence {
  id: string;
  type: string;
  status?: string;
  title?: string | null;
  text: string;
  payload: TurnItem;
}
export interface Run {
  id: string;
  userMessageId: string;
  status: string;
  restartContinuationOfRunId?: string;
  delegatedCompletion?: { parentRunId: string };
}
export interface Projection {
  thread: Thread;
  runs: Run[];
  turnItems: TurnItem[];
  messages: TurnItem[];
  subagents: { runId: string; status: string }[];
  runtimeRequests: { id: string; status: string }[];
  checkpoints: Checkpoint[];
}
export interface UploadedImage {
  type: "image";
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}
export interface T3Config {
  providers: {
    enabled: boolean;
    installed: boolean;
    instanceId: string;
    displayName?: string;
    models: { slug: string; name: string }[];
  }[];
}
export interface T3RpcResults {
  "server.getConfig": T3Config;
  "projects.mutate": Project;
  "attachments.createUploadUrl": { relativeUrl: string; attachmentId: string };
  "orchestration.getThreadProjection": Projection;
  "orchestration.launchThread": { projection: Projection };
  "orchestration.getTurnItem": { item?: TurnItem };
  "orchestration.dispatchCommand": unknown;
}
export interface DesktopInfo {
  cliPath: string | null;
  cliError: string | null;
  platform: NodeJS.Platform;
  boardRegistered: boolean;
  textRegistered: boolean;
  screenshotRegistered: boolean;
  dockVisible: boolean | null;
  screenRecording: string;
  appVersion: string;
  dataDir: string;
}
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RegionImage {
  url: string;
  width: number;
  height: number;
  scaleFactor: number;
}
export interface DesktopBridge {
  regionImage(): Promise<string | null>;
  finishRegion(rectangle: Rectangle): Promise<ImageAttachment | null>;
  cancelRegion(): Promise<void>;
  pendingCapture(): Promise<ImageAttachment | null>;
  closeCapture(): void;
  captureText(): Promise<void>;
  captureRegion(): Promise<void>;
  configure(settings: AppSettings): Promise<void>;
  openThread(id: string): Promise<void>;
  openScreenPermissions(): Promise<void>;
  desktopInfo(): Promise<DesktopInfo>;
}

export interface ThreadLaunchInput {
  commandId: string;
  threadId: string;
  projectId: string;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: string;
  interactionMode: "default";
  workspaceStrategy: {
    type: "worktree";
    baseRef: string;
    branch: string;
    startFromOrigin: boolean;
  };
  initialMessage: {
    messageId: string;
    text: string;
    attachments: UploadedImage[];
  };
}
export type OrchestrationCommand =
  | {
      type: "message.dispatch";
      createdBy: "user";
      creationSource: "web";
      commandId: string;
      threadId: string;
      messageId: string;
      text: string;
      attachments: UploadedImage[];
      modelSelection: ModelSelection;
      dispatchMode: { type: "queue_after_active" };
    }
  | {
      type: "runtime-request.respond";
      commandId: string;
      threadId: string;
      requestId: string;
      answers: Answers;
      decision?: never;
    }
  | {
      type: "runtime-request.respond";
      commandId: string;
      threadId: string;
      requestId: string;
      decision: string;
      answers?: never;
    }
  | { type: "thread.stop"; commandId: string; threadId: string };
export interface T3RpcRequests {
  "server.getConfig": Record<string, never>;
  "projects.mutate": {
    type: "project.create";
    commandId: string;
    projectId: string;
    title: string;
    workspaceRoot: string;
    createWorkspaceRootIfMissing: boolean;
  };
  "attachments.createUploadUrl": {
    type: "image";
    name: string;
    mimeType: string;
    sizeBytes: number;
  };
  "orchestration.getThreadProjection": { threadId: string };
  "orchestration.launchThread": ThreadLaunchInput;
  "orchestration.getTurnItem": { threadId: string; itemId: string };
  "orchestration.dispatchCommand": OrchestrationCommand;
}
