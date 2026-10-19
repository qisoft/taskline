import type {
  AppState,
  AppSettings,
  Task,
  Epic,
  ImageAttachment,
  ValidationArtifacts,
  TaskDetail as TaskDetailData,
  SelectionInput,
  DesktopInfo,
  Priority,
} from "../shared/types.js";
import { asError } from "../shared/errors.js";
import React, {
  useState,
  useEffect,
  useMemo,
  useContext,
  useRef,
  createContext,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Plus,
  ZoomIn,
  ZoomOut,
  Search,
  ChevronDown,
  ChevronRight,
  X,
  Settings,
  Circle,
  CheckCircle2,
  CircleDot,
  Layers,
  Inbox,
  ArrowUpRight,
  ImagePlus,
  Mic,
  Pause,
  Play,
  RefreshCw,
  MoreHorizontal,
  Check,
  AlertCircle,
  Paperclip,
  Command,
  LayoutGrid,
  Clock,
  Send,
  Trash2,
  ArrowDown,
  CircleHelp,
} from "lucide-react";
import "./style.css";
import { projectModel } from "./composer-defaults.js";
import {
  defaultProject,
  projectTargets,
  recentProjects,
  recentThreads,
} from "./task-targets.js";
import { recordTargetUsage } from "../server/target-history.js";
import {
  priorities,
  compareTaskPriority,
  pendingBlockers,
} from "../server/task-planning.js";
import "@fontsource-variable/inter";
if (window.taskline) document.body.classList.add("desktop");

const api = async <T = unknown,>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> => {
  const res = await fetch("/api" + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "Request failed");
  return data;
};
const columns = [
  { id: "todo", title: "To Do", icon: Circle },
  { id: "doing", title: "In Progress", icon: CircleDot },
  { id: "review", title: "Review", icon: CircleHelp },
  { id: "done", title: "Done", icon: CheckCircle2 },
];
const time = (value: string | number | Date) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
const label: Record<string, string> = {
  reserved: "Starting",
  preparing: "Preparing workspace",
  starting: "Starting",
  running: "Running",
  waiting: "Needs input",
  queued: "Queued in T3",
  recovering: "Reconnecting",
  collecting: "Saving screenshots",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  queued_on_board: "Queued on board",
};
function IconButton({
  children,
  onClick,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  title: string;
  className?: string;
}) {
  return (
    <button
      className={"icon-button " + className}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={"modal " + className}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

const ImageViewerContext = createContext<
  ((image: ImageAttachment) => void) | null
>(null);
function ImageViewerProvider({ children }: { children: React.ReactNode }) {
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const viewer = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!image) return;
    const previousFocus = document.activeElement;
    const root = document.getElementById("root")!;
    const wasInert = root.inert;
    root.inert = true;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setImage(null);
      }
      if (event.key === "Tab") {
        const buttons = [...viewer.current!.querySelectorAll("button")];
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        event.preventDefault();
        buttons[
          (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        ].focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      root.inert = wasInert;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [image]);
  return (
    <ImageViewerContext.Provider
      value={(image) => {
        setActualSize(false);
        setImage(image);
      }}
    >
      {children}
      {image &&
        createPortal(
          <div
            className="image-viewer-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setImage(null);
            }}
          >
            <section
              ref={viewer}
              role="dialog"
              aria-modal="true"
              aria-label="Image viewer"
              className="image-viewer"
              onKeyDown={(e) => e.stopPropagation()}
            >
              <header>
                <strong>{image.name || "Screenshot"}</strong>
                <div className="row">
                  <button
                    className="button"
                    aria-label={
                      actualSize
                        ? "Fit image to window"
                        : "View image at actual size"
                    }
                    onClick={() => setActualSize(!actualSize)}
                  >
                    {actualSize ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
                    {actualSize ? "Fit" : "100%"}
                  </button>
                  <button
                    ref={closeButton}
                    className="icon-button"
                    aria-label="Close image viewer"
                    onClick={() => setImage(null)}
                  >
                    <X size={20} />
                  </button>
                </div>
              </header>
              <div
                className={
                  "image-viewer-stage" + (actualSize ? " actual-size" : "")
                }
              >
                <img src={image.url} alt={image.name || "Screenshot"} />
              </div>
            </section>
          </div>,
          document.body,
        )}
    </ImageViewerContext.Provider>
  );
}
function ImagePreview({
  image,
  className,
  lazy = false,
  alt,
}: {
  image: ImageAttachment;
  className?: string;
  lazy?: boolean;
  alt?: string;
}) {
  const openImage = useContext(ImageViewerContext);
  return (
    <button
      type="button"
      className="image-preview-button"
      aria-label={"View image: " + (image.name || "Screenshot")}
      onClick={(event) => {
        event.stopPropagation();
        openImage?.(image);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          openImage?.(image);
        }
      }}
    >
      <img
        className={className}
        loading={lazy ? "lazy" : undefined}
        src={image.url}
        alt={alt || image.name}
      />
    </button>
  );
}

function BlockerPicker({
  state,
  value,
  onChange,
  excludeId,
  disabled = false,
  onOpenTask,
}: {
  state: AppState;
  value: string[];
  onChange: (value: string[]) => void;
  excludeId?: string;
  disabled?: boolean;
  onOpenTask?: (id: string) => void;
}) {
  return (
    <div className="blocker-picker">
      {value.map((id) => {
        const blocker = state.tasks.find((t) => t.id === id);
        const resolved = ["review", "done"].includes(blocker?.status ?? "");
        const text =
          "TL-" +
          id.slice(0, 4).toUpperCase() +
          " · " +
          (blocker?.title || "Missing task") +
          " · " +
          (blocker?.status || "missing");
        return (
          <div
            className={"blocker-item" + (resolved ? " resolved" : "")}
            key={id}
          >
            {onOpenTask && blocker ? (
              <button
                type="button"
                className="text-button blocker-link"
                onClick={() => onOpenTask(id)}
              >
                {text}
              </button>
            ) : (
              <span>{text}</span>
            )}
            <button
              type="button"
              className="icon-button"
              disabled={disabled}
              aria-label={"Remove blocker TL-" + id.slice(0, 4).toUpperCase()}
              onClick={() => onChange(value.filter((item) => item !== id))}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <select
        aria-label="Add blocking task"
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">Add blocking task…</option>
        {state.tasks
          .filter((t) => t.id !== excludeId && !value.includes(t.id))
          .map((t) => (
            <option value={t.id} key={t.id}>
              TL-{t.id.slice(0, 4).toUpperCase()} · {t.title} ·{" "}
              {state.projects.find((p) => p.id === t.projectId)?.title} ·{" "}
              {t.status}
            </option>
          ))}
      </select>
      <small className="muted">
        All blockers must reach Review or Done before this task starts.
      </small>
    </div>
  );
}
function Composer({
  state,
  onClose,
  onCreated,
  onRefresh,
  captureOnly = false,
  initialAttachments = [],
  initialProjectId,
  initialGroupId,
  onSelection,
}: {
  state: AppState;
  onClose: () => void;
  onCreated: (task: Task) => void;
  onRefresh: () => Promise<unknown>;
  captureOnly?: boolean;
  initialAttachments?: ImageAttachment[];
  initialProjectId?: string;
  initialGroupId?: string;
  onSelection: (input: SelectionInput) => Promise<unknown>;
}) {
  const [projectId, setProject] = useState(() =>
    defaultProject(state, initialProjectId),
  );
  const [threadId, setThread] = useState(
    () => projectTargets(state, projectId).threadId,
  );
  const [epicEditor, setEpicEditor] = useState(false);
  const [threadKey, setThreadKey] = useState("");
  const [groupId, setGroup] = useState(
    () => projectTargets(state, projectId, initialGroupId).groupId,
  );
  const [prompt, setPrompt] = useState(
    () => sessionStorage.getItem("taskline-draft") || "",
  );
  const [model, setModel] = useState(() =>
    projectModel(state, projectId, threadId),
  );
  const [attachments, setAttachments] = useState(initialAttachments);
  const [priority, setPriority] = useState("normal");
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threads = recentThreads(state, projectId);
  const remember = (input: Partial<SelectionInput>) =>
    onSelection({ projectId, ...input }).catch((e) => setError(e.message));
  useEffect(() => {
    if (
      threadId &&
      threadId !== "__named__" &&
      !threads.some((t) => t.id === threadId)
    )
      setThread("");
  }, [projectId, state.threads, state.threadTargets]);
  const groups = state.groups.filter(
    (g) => g.projectId === projectId && g.status !== "done",
  );
  useEffect(() => {
    if (groupId && !groups.some((g) => g.id === groupId)) setGroup("");
  }, [projectId, state.groups, groupId]);
  useEffect(() => {
    sessionStorage.setItem("taskline-draft", prompt);
  }, [prompt]);
  useEffect(() => {
    if (captureOnly && window.taskline)
      window.taskline.pendingCapture().then((a) => {
        if (a) setAttachments([a]);
      });
  }, []);
  async function attach(files: Iterable<File>) {
    try {
      for (const file of files) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(file);
        });
        const a = await api<ImageAttachment>("/attachments", {
          base64,
          name: file.name,
          mimeType: file.type,
        });
        setAttachments((previous) => [...previous, a]);
      }
    } catch (caught) {
      const e = asError(caught);
      setError(e.message);
    }
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const task = await api<Task>("/tasks", {
        prompt,
        projectId,
        ...(threadId === "__named__"
          ? { threadKey }
          : { threadId: threadId || null }),
        groupId: groupId || null,
        model: model.split("::")[1],
        instanceId: model.split("::")[0],
        attachments,
        priority,
        blockedBy,
      });
      sessionStorage.removeItem("taskline-draft");
      onCreated(task);
      if (captureOnly) window.taskline?.closeCapture();
      else onClose();
    } catch (caught) {
      const e = asError(caught);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const content = (
    <>
      <div className="composer-body">
        <textarea
          autoFocus
          aria-label="Task prompt"
          placeholder="What needs to be done? Type or dictate a task…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") onClose();
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (files.length) {
              e.preventDefault();
              attach(files);
            }
          }}
        />
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((a) => (
              <div className="attachment-preview" key={a.id}>
                <ImagePreview image={a} />
                <button
                  className="remove-attachment"
                  aria-label="Remove attachment"
                  onClick={() =>
                    setAttachments(attachments.filter((x) => x.id !== a.id))
                  }
                >
                  <X size={12} />
                </button>
                <span>{a.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="composer-targets">
          <label>
            Project
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => {
                const nextProject = e.target.value;
                const targets = projectTargets(state, nextProject);
                setProject(nextProject);
                setThread(targets.threadId);
                setThreadKey("");
                setGroup(targets.groupId);
                setModel(projectModel(state, nextProject, targets.threadId));
                remember({ projectId: nextProject });
              }}
            >
              {recentProjects(state).map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thread
            <select
              aria-label="Thread"
              value={threadId}
              onChange={(e) => {
                setThread(e.target.value);
                setModel(projectModel(state, projectId, e.target.value));
                if (e.target.value !== "__named__")
                  remember({ threadId: e.target.value || null });
              }}
            >
              <option value="">New thread · separate worktree</option>
              <option value="__named__">Named thread · create or reuse</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.status}
                </option>
              ))}
            </select>
          </label>
        </div>
        {threadId === "__named__" && (
          <label className="named-thread-field">
            Thread key
            <input
              aria-label="Thread key"
              value={threadKey}
              maxLength={120}
              placeholder="e.g. checkout-api"
              onChange={(e) => setThreadKey(e.target.value)}
            />
            <small>
              Tasks with the same key in this project run in one thread. It is
              created when the first task starts.
            </small>
          </label>
        )}
        <div className="composer-targets">
          <label>
            <span className="epic-field-label">
              Epic
              <button
                type="button"
                className="text-button"
                aria-label="Create new epic"
                onClick={() => setEpicEditor(true)}
              >
                <Plus size={12} /> New epic
              </button>
            </span>
            <select
              aria-label="Epic"
              value={groupId}
              onChange={(e) => {
                setGroup(e.target.value);
                remember({ groupId: e.target.value || null });
              }}
            >
              <option value="">No epic</option>
              {groups.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="epic-field-label">Model</span>
            <select
              aria-label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {!state.models?.some(
                (m) => m.instanceId + "::" + m.id === model,
              ) && <option value={model}>{model.split("::")[1]}</option>}
              {(state.models?.length
                ? state.models
                : [
                    {
                      instanceId: "codex",
                      id: "gpt-6-luna",
                      label: "Codex · GPT-6 Luna",
                    },
                  ]
              ).map((m) => (
                <option
                  value={m.instanceId + "::" + m.id}
                  key={m.instanceId + "::" + m.id}
                >
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="composer-targets task-planning-fields">
          <label>
            Priority
            <select
              aria-label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {priorities.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="field-label">Blocked by</span>
            <BlockerPicker
              state={state}
              value={blockedBy}
              onChange={setBlockedBy}
            />
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
      {epicEditor && (
        <EpicEditor
          projects={state.projects}
          projectId={projectId}
          onClose={() => setEpicEditor(false)}
          onSave={async (group) => {
            await onRefresh();
            setGroup(group.id);
            remember({ groupId: group.id });
          }}
        />
      )}
      <footer className="composer-footer">
        <div className="composer-tools">
          <label className="icon-button" title="Attach screenshot">
            <ImagePlus size={18} />
            <input
              hidden
              type="file"
              accept="image/*"
              multiple
              aria-label="Attach screenshot"
              onChange={(e) => attach(Array.from(e.target.files ?? []))}
            />
          </label>
          <IconButton
            title="Dictate using your system dictation shortcut"
            onClick={() =>
              document
                .querySelector<HTMLTextAreaElement>(
                  '[aria-label="Task prompt"]',
                )
                ?.focus()
            }
          >
            <Mic size={18} />
          </IconButton>
          <span className="muted small">Type or use system dictation</span>
        </div>
        <button
          className="primary-button"
          disabled={!prompt.trim() || !projectId || busy}
          onClick={submit}
        >
          {busy ? "Saving…" : "Create task"}
          <span className="key-hint">⌘ ↵</span>
        </button>
      </footer>
    </>
  );
  if (captureOnly)
    return (
      <section className="capture-surface">
        <header>
          <div>
            <span className="brand-mark">T</span> <strong>New task</strong>
          </div>
          <IconButton title="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        {content}
      </section>
    );
  return (
    <Modal title="New task" onClose={onClose} className="composer-modal">
      {content}
    </Modal>
  );
}

function ValidationImages({ record }: { record: ValidationArtifacts }) {
  if (!record.validationImages?.length && !record.validationImageIssues?.length)
    return null;
  return (
    <div className="validation-images">
      <h4>Screenshots from T3</h4>
      <div className="validation-gallery">
        {record.validationImages?.map((image) => (
          <figure key={image.id}>
            <ImagePreview image={image} lazy />
            <figcaption>{image.name}</figcaption>
            <details>
              <summary className="small muted">
                Original references · {image.sources.length}
              </summary>
              {image.sources.map((source, i) => (
                <p className="small preserve-text" key={i}>
                  {source.reference}
                </p>
              ))}
            </details>
          </figure>
        ))}
      </div>
      {record.validationImageIssues?.map((issue, i) => (
        <p className="small muted preserve-text" key={i}>
          Screenshot unavailable: {issue.reference}
          {issue.message}
        </p>
      ))}
    </div>
  );
}

function TaskCard({
  task,
  state,
  onOpen,
  onDragStart,
}: {
  task: Task;
  state: AppState;
  onOpen: (id: string) => void;
  onDragStart?: (id: string) => void;
}) {
  const project = state.projects.find((p) => p.id === task.projectId);
  const group = state.groups.find((g) => g.id === task.groupId);
  const questions =
    (task.questions?.length ?? 0) + (task.report?.questions?.length ?? 0);
  const blockers =
    task.blockingTaskIds ??
    pendingBlockers(task, {
      get: (id) => state.tasks.find((t) => t.id === id),
    });
  const priority = priorities.find(
    (p) => p.value === (task.priority ?? "normal"),
  );
  return (
    <article
      className={"task-card " + (task.status === "failed" ? "failed" : "")}
      draggable={task.status !== "doing"}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/taskline", task.id);
        onDragStart?.(task.id);
      }}
      onClick={() => onOpen(task.id)}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen(task.id)}
      aria-label={task.title}
    >
      <div className="card-top">
        <span className="task-code">
          TL-{task.id.slice(0, 4).toUpperCase()}
        </span>
        <span
          className={"priority-badge priority-" + priority?.value}
          aria-label={"Priority: " + priority?.label}
        >
          {priority?.label}
        </span>
        <MoreHorizontal size={15} />
      </div>
      <h3>{task.title}</h3>
      {task.attachments?.[0] && (
        <ImagePreview
          image={task.attachments[0]}
          className="card-image"
          alt="Attached screenshot"
        />
      )}
      {group && (
        <span className="epic-tag">
          <Layers size={11} />
          {group.name}
        </span>
      )}
      {task.status === "doing" && (
        <div
          className={
            "execution-label " +
            (task.executionState === "waiting" ? "attention" : "")
          }
        >
          <span className="live-dot" />
          {label[task.executionState] || task.executionState}
        </div>
      )}
      {task.status === "failed" && (
        <div className="execution-label attention">
          <AlertCircle size={12} />
          Needs attention
        </div>
      )}
      {task.status === "cancelled" && (
        <div className="execution-label">Cancelled</div>
      )}
      {task.paused && (
        <div className="execution-label">
          <Pause size={12} />
          Paused
        </div>
      )}
      {blockers.length > 0 && task.status === "todo" && (
        <div className="execution-label attention" aria-label="Task is blocked">
          <AlertCircle size={12} />
          Blocked by {blockers.length}{" "}
          {blockers.length === 1 ? "task" : "tasks"}
        </div>
      )}
      {task.waitReason &&
        !task.waitReason.startsWith("Blocked by ") &&
        task.status === "todo" && (
          <div className="small muted">{task.waitReason}</div>
        )}
      <div className="card-bottom">
        <span className="project-tag">{project?.title || "Project"}</span>
        <div className="card-meta">
          {questions > 0 && (
            <span className="question-count">
              <CircleHelp size={12} />
              {questions}
            </span>
          )}
          {task.attachments?.length > 0 && (
            <span>
              <Paperclip size={12} />
              {task.attachments.length}
            </span>
          )}
          <span className="model-avatar" title={task.model}>
            L
          </span>
        </div>
      </div>
    </article>
  );
}
function TaskDetail({
  id,
  state,
  onClose,
  onRefresh,
  onError,
  onOpenTask,
}: {
  id: string;
  state: AppState;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
  onError: (error: unknown) => void;
  onOpenTask: (id: string) => void;
}) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("overview");
  const task = state.tasks.find((t) => t.id === id);
  useEffect(() => {
    api<TaskDetailData>("/tasks/" + id)
      .then(setDetail)
      .catch(onError);
  }, [id, task?.updatedAt, task?.reportState]);
  if (!task) return null;
  const attempt =
    detail?.attempts.find((a) => a.id === task.currentAttemptId) ||
    detail?.attempts.at(-1);
  async function action(name: string, data: unknown = {}) {
    setBusy(true);
    try {
      await api("/tasks/" + id + "/" + name, data);
      await onRefresh();
    } catch (caught) {
      const e = asError(caught);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const project = state.projects.find((p) => p.id === task.projectId);
  const report = task.report;
  const target = state.threadTargets?.find((t) => t.id === task.threadId);
  async function updatePlanning(patch: Partial<Task>) {
    setBusy(true);
    try {
      await api("/tasks/" + id, patch, "PATCH");
      await onRefresh();
    } catch (caught) {
      const e = asError(caught);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const dependents = state.tasks.filter((t) => t.blockedBy?.includes(id));
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        className="task-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
      >
        <header>
          <div className="breadcrumb">
            <span>{project?.title}</span>
            <ChevronRight size={13} />
            <span>TL-{id.slice(0, 4).toUpperCase()}</span>
          </div>
          <div className="row">
            {task.threadId && (!target || target.materializedAt) && (
              <IconButton
                title="Open in T3 Code"
                onClick={() =>
                  window.taskline
                    ? window.taskline.openThread(task!.threadId!)
                    : window.open("http://127.0.0.1:3773", "_blank")
                }
              >
                <ArrowUpRight size={17} />
              </IconButton>
            )}
            <IconButton title="Close details" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        </header>
        <div className="drawer-content">
          <div className={"status-pill status-" + task.status}>
            {columns.find((c) => c.id === task.status)?.title || task.status}
          </div>
          <h1>{task.title}</h1>
          <div className="detail-properties">
            <span>Project</span>
            <strong>{project?.title}</strong>
            <span>Thread</span>
            <strong>
              {task.threadKey
                ? task.threadKey +
                  (target?.materializedAt ? "" : " · created on first start")
                : state.threads.find((t) => t.id === task.threadId)?.title ||
                  "New thread · separate worktree"}
            </strong>
            <span>Model</span>
            <strong>{task.model}</strong>
            <span>Priority</span>
            <select
              aria-label="Task priority"
              value={task.priority ?? "normal"}
              disabled={busy}
              onChange={(e) =>
                updatePlanning({ priority: e.target.value as Priority })
              }
            >
              {priorities.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <span>Blocked by</span>
            <BlockerPicker
              state={state}
              value={task.blockedBy ?? []}
              excludeId={id}
              disabled={busy || task.status === "doing"}
              onChange={(blockedBy) => updatePlanning({ blockedBy })}
              onOpenTask={onOpenTask}
            />
            {dependents.length > 0 && (
              <>
                <span>Blocks</span>
                <div className="dependent-tasks">
                  {dependents.map((t) => (
                    <button
                      type="button"
                      className="text-button blocker-link"
                      key={t.id}
                      onClick={() => onOpenTask(t.id)}
                    >
                      TL-{t.id.slice(0, 4).toUpperCase()} · {t.title}
                    </button>
                  ))}
                </div>
              </>
            )}
            <span>Epic</span>
            <select
              aria-label="Task epic"
              value={task.groupId || ""}
              onChange={async (e) => {
                try {
                  await api(
                    "/tasks/" + id,
                    { groupId: e.target.value || null },
                    "PATCH",
                  );
                  onRefresh();
                } catch (caught) {
                  const e = asError(caught);
                  onError(e);
                }
              }}
            >
              <option value="">No epic</option>
              {state.groups
                .filter(
                  (g) =>
                    g.projectId === task.projectId &&
                    (g.status !== "done" || g.id === task.groupId),
                )
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
            <span>Created</span>
            <strong>{time(task.createdAt)}</strong>
            {attempt?.workspace && (
              <>
                <span>Workspace</span>
                <code className="workspace-path">{attempt.workspace}</code>
              </>
            )}
          </div>
          <div className="detail-tabs">
            <button
              className={tab === "overview" ? "active" : ""}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              className={tab === "evidence" ? "active" : ""}
              onClick={() => setTab("evidence")}
            >
              Evidence & changes
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              Attempts · {detail?.attempts.length ?? 0}
            </button>
          </div>
          {tab === "overview" && (
            <>
              <section className="detail-section">
                <h3>Original prompt</h3>
                <p className="preserve-text">
                  {task.originalPrompt || task.prompt}
                </p>
                {task.attachments?.map((a) => (
                  <ImagePreview key={a.id} image={a} className="detail-image" />
                ))}
              </section>
              {task.questions?.length > 0 && (
                <section className="detail-section question-section">
                  <h3>
                    <CircleHelp size={15} /> T3 needs your input
                  </h3>
                  {task.questions.map((q) => (
                    <div key={q.requestId}>
                      {q.type === "approval_request" ? (
                        <>
                          <p>
                            {q.prompt || "Permission requested by the agent"}
                          </p>
                          <div className="row">
                            <button
                              className="primary-button"
                              onClick={() =>
                                action("approve", {
                                  requestId: q.requestId,
                                  decision: "accept",
                                })
                              }
                            >
                              Allow once
                            </button>
                            <button
                              className="button"
                              onClick={() =>
                                action("approve", {
                                  requestId: q.requestId,
                                  decision: "decline",
                                })
                              }
                            >
                              Decline
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {q.questions.map((question) => (
                            <div className="question-field" key={question.id}>
                              <label>{question.question}</label>
                              {(question.options?.length ?? 0) > 0 && (
                                <select
                                  aria-label={
                                    question.header || question.question
                                  }
                                  value={answers[question.id] || ""}
                                  onChange={(e) =>
                                    setAnswers({
                                      ...answers,
                                      [question.id]: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">Choose…</option>
                                  {question.options?.map((o) => (
                                    <option
                                      key={o.label}
                                      value={o.value ?? o.label}
                                    >
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <input
                                placeholder="Your answer…"
                                value={answers[question.id] || ""}
                                onChange={(e) =>
                                  setAnswers({
                                    ...answers,
                                    [question.id]: e.target.value,
                                  })
                                }
                              />
                            </div>
                          ))}
                          <button
                            className="primary-button"
                            disabled={
                              busy ||
                              q.questions.some(
                                (question) =>
                                  question.required !== false &&
                                  !answers[question.id]?.length,
                              )
                            }
                            onClick={() =>
                              action("answer", {
                                requestId: q.requestId,
                                answers: Object.fromEntries(
                                  q.questions.map((question) => [
                                    question.id,
                                    answers[question.id] || "",
                                  ]),
                                ),
                              })
                            }
                          >
                            Send answer to T3 <Send size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </section>
              )}
              {task.error && <div className="error">{task.error}</div>}
              {report && (
                <>
                  <section className="detail-section">
                    <h3>
                      Result{" "}
                      <span className="small muted">
                        {task.reportState === "pending"
                          ? "Summarizing…"
                          : task.reportState === "error"
                            ? "Summary needs retry"
                            : "GPT-6 Luna"}
                      </span>
                    </h3>
                    <p className="preserve-text">{report.summary}</p>
                    {report.changes?.length > 0 && (
                      <ul>
                        {report.changes.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                    {task.reportError && (
                      <details>
                        <summary className="attention">Summary error</summary>
                        <p className="small">{task.reportError}</p>
                      </details>
                    )}
                    <button
                      className="text-button"
                      onClick={() => action("report")}
                    >
                      Regenerate report
                    </button>
                  </section>
                  {report.questions?.length > 0 && (
                    <section className="detail-section">
                      <h3>Questions for you</h3>
                      {report.questions.map((q, i) => (
                        <div className="report-question" key={i}>
                          <p>{q.text}</p>
                          <span className="small muted">
                            {q.scope === "group"
                              ? "Epic decision"
                              : "Task decision"}{" "}
                            · {q.blocking ? "Blocking" : "Follow-up"}
                          </span>
                        </div>
                      ))}
                    </section>
                  )}
                  <section className="detail-section">
                    <h3>How it was tested</h3>
                    {report.validation?.map((v, i) => (
                      <div className="validation-row" key={i}>
                        <span className={"validation-indicator " + v.outcome}>
                          {v.outcome === "passed" ? (
                            <Check size={13} />
                          ) : v.outcome === "failed" ? (
                            <X size={13} />
                          ) : (
                            <Circle size={12} />
                          )}
                        </span>
                        <div>
                          <strong>{v.label}</strong>
                          {v.command && <code>{v.command}</code>}
                          <span className="small muted">
                            {v.outcome.replaceAll("_", " ")} ·{" "}
                            {v.basis === "observed_output"
                              ? "Execution evidence"
                              : v.basis === "agent_reported"
                                ? "Reported by agent"
                                : "No evidence"}
                            {v.sourceRefs?.length > 0
                              ? " · " + v.sourceRefs.length + " sources"
                              : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                    <ValidationImages record={task} />
                  </section>
                  {report.remainingWork?.length > 0 && (
                    <section className="detail-section">
                      <h3>Remaining work</h3>
                      <ul>
                        {report.remainingWork.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
              {["review", "failed", "done", "cancelled"].includes(
                task.status,
              ) && (
                <section className="detail-section">
                  <h3>Request changes</h3>
                  <textarea
                    aria-label="Revision prompt"
                    placeholder="Describe the follow-up or answer remaining questions…"
                    value={revision}
                    onChange={(e) => setRevision(e.target.value)}
                  />
                  <button
                    className="button"
                    disabled={!revision.trim() || busy}
                    onClick={() => action("revision", { prompt: revision })}
                  >
                    Queue follow-up in this thread <ArrowUpRight size={14} />
                  </button>
                </section>
              )}
            </>
          )}
          {tab === "evidence" && (
            <>
              {attempt?.fileChanges?.map((f, i) => (
                <section className="detail-section" key={i}>
                  <h3>{f.fileName}</h3>
                  <pre>{f.diff || JSON.stringify(f.changes, null, 2)}</pre>
                </section>
              ))}
              {attempt?.evidence
                ?.filter((i) =>
                  [
                    "command_execution",
                    "tool_call",
                    "assistant_message",
                  ].includes(i.type),
                )
                .map((item) => (
                  <details className="evidence-item" key={item.id}>
                    <summary>
                      {item.type.replaceAll("_", " ")} ·{" "}
                      {item.title || item.id.slice(0, 20)}
                    </summary>
                    <pre>
                      {item.payload.input
                        ? String(item.payload.input) + "\n\n"
                        : null}
                      {typeof item.text === "string"
                        ? item.text
                        : JSON.stringify(item.text)}
                    </pre>
                    <span className="small muted">Source: {item.id}</span>
                  </details>
                ))}
            </>
          )}
          {tab === "history" && (
            <>
              {detail?.attempts.map((a, i) => (
                <details
                  className="evidence-item"
                  key={a.id}
                  open={i === detail.attempts.length - 1}
                >
                  <summary>
                    Attempt {i + 1} · {label[a.state] || a.state} ·{" "}
                    {time(a.createdAt)}
                  </summary>
                  <p>Context version: {a.contextVersion ?? "No epic"}</p>
                  <p className="preserve-text">{a.compiledPrompt}</p>
                  {a.result && (
                    <p className="preserve-text">{a.result.summary}</p>
                  )}
                  <ValidationImages record={a} />
                  <code>{a.runId}</code>
                </details>
              ))}
            </>
          )}
        </div>
        <footer className="drawer-footer">
          <div className="row">
            {task.status !== "doing" && (
              <IconButton
                title="Delete task"
                onClick={async () => {
                  if (confirm("Delete this task?")) {
                    await api("/tasks/" + id, {}, "DELETE");
                    onClose();
                    onRefresh();
                  }
                }}
              >
                <Trash2 size={16} />
              </IconButton>
            )}
            {task.status === "todo" && (
              <button
                className="button"
                onClick={async () => {
                  await api("/tasks/" + id, { paused: !task.paused }, "PATCH");
                  onRefresh();
                }}
              >
                {task.paused ? "Resume" : "Pause"}
              </button>
            )}
            {["doing", "todo"].includes(task.status) && (
              <button className="button" onClick={() => action("cancel")}>
                Stop task
              </button>
            )}
            {["failed", "cancelled"].includes(task.status) && (
              <button className="button" onClick={() => action("retry")}>
                Retry
              </button>
            )}
          </div>
          {task.status === "review" && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={async () => {
                await api("/tasks/" + id, { status: "done" }, "PATCH");
                onRefresh();
              }}
            >
              Accept result <Check size={15} />
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
function EpicEditor({
  group,
  projects,
  projectId,
  onClose,
  onSave,
}: {
  group?: Partial<Epic> | null;
  projects: AppState["projects"];
  projectId?: string;
  onClose: () => void;
  onSave: (group: Epic) => unknown;
}) {
  const [selectedProject, setSelectedProject] = useState(
    group?.projectId || projectId || "",
  );
  const [name, setName] = useState(group?.name || "");
  const [context, setContext] = useState(group?.context || "");
  const [criteria, setCriteria] = useState(group?.acceptanceCriteria || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={group ? "Edit epic" : "New epic"} onClose={onClose}>
      <div className="form-body">
        <label>
          Project
          <select
            aria-label="Epic project"
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            disabled={!!group?.projectId}
          >
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            aria-label="Epic name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A goal that spans several tasks"
          />
        </label>
        <label>
          Shared context
          <textarea
            aria-label="Shared context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Background, requirements, constraints and decisions…"
          />
        </label>
        <label>
          Acceptance criteria
          <textarea
            aria-label="Acceptance criteria"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="How will you know this epic is complete?"
          />
        </label>
        {error && <div className="error">{error}</div>}
      </div>
      <footer>
        <button
          className="primary-button"
          disabled={!name.trim() || !selectedProject || busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const saved = await api<Epic>(
                group ? "/groups/" + group.id : "/groups",
                {
                  name,
                  context,
                  acceptanceCriteria: criteria,
                  projectId: selectedProject,
                },
                group ? "PATCH" : "POST",
              );
              await onSave(saved);
              onClose();
            } catch (caught) {
              const e = asError(caught);
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save epic"}
        </button>
      </footer>
    </Modal>
  );
}
function SettingsDialog({
  state,
  onClose,
  onRefresh,
  onError,
}: {
  state: AppState;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    window.taskline?.desktopInfo().then(setDesktop);
  }, []);
  const [origin, setOrigin] = useState(state.connection.origin || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(state.settings);
  const [autoOverrides, setAutoOverrides] = useState<
    Record<string, boolean | undefined>
  >({});
  async function connect(local: boolean) {
    setBusy(true);
    try {
      await api(
        local ? "/connect/local" : "/connect",
        local ? {} : { origin, token },
      );
      await onRefresh();
      setToken("");
    } catch (caught) {
      const e = asError(caught);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="form-body">
        <h3>T3 Code connection</h3>
        <p className="muted small">
          Projects and threads are synced from your T3 environment.
        </p>
        <div className="row">
          <span
            className={
              "connection-dot " +
              (state.connection.connected ? "connected" : "")
            }
          />
          {state.connection.connected ? "Connected" : "Disconnected"}
          <button
            className="button"
            disabled={busy}
            onClick={() => connect(true)}
          >
            Connect local T3
          </button>
        </div>
        <label>
          Server address
          <input
            aria-label="T3 server address"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="http://127.0.0.1:3773"
          />
        </label>
        <label>
          Scoped T3 access token
          <input
            type="password"
            aria-label="T3 access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter a token for another environment"
          />
        </label>
        <button
          className="button"
          disabled={busy || !origin || !token}
          onClick={() => connect(false)}
        >
          Connect environment
        </button>
        <hr />
        <h3>Desktop and global shortcuts</h3>
        {desktop && (
          <div className="row small">
            <span>
              Screen recording:{" "}
              {desktop.screenRecording === "granted"
                ? "allowed"
                : "permission needed"}
            </span>
            {desktop.screenRecording !== "granted" && (
              <button
                className="button"
                onClick={() => window.taskline?.openScreenPermissions()}
              >
                Enable screen recording
              </button>
            )}
          </div>
        )}
        <label>
          Board shortcut
          <input
            aria-label="Board shortcut"
            value={settings.boardShortcut ?? "CommandOrControl+Shift+0"}
            onChange={(e) =>
              setSettings({ ...settings, boardShortcut: e.target.value })
            }
          />
        </label>
        {desktop?.boardRegistered === false && (
          <p className="muted small">
            Board shortcut is unavailable. Choose another combination.
          </p>
        )}
        <label>
          Text shortcut
          <input
            aria-label="Text shortcut"
            value={settings.textShortcut}
            onChange={(e) =>
              setSettings({ ...settings, textShortcut: e.target.value })
            }
          />
        </label>
        <label>
          Screenshot shortcut
          <input
            aria-label="Screenshot shortcut"
            value={settings.screenshotShortcut}
            onChange={(e) =>
              setSettings({ ...settings, screenshotShortcut: e.target.value })
            }
          />
        </label>
        {desktop?.platform === "darwin" && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.showInDock !== false}
              onChange={(e) =>
                setSettings({ ...settings, showInDock: e.target.checked })
              }
            />
            Always show Taskline in the Dock
          </label>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) =>
              setSettings({ ...settings, launchAtLogin: e.target.checked })
            }
          />
          Start at login
        </label>
        <p className="muted small">
          Text entry accepts system dictation and your existing voice typing
          tool.
        </p>
        <hr />
        <h3>Project execution</h3>
        {state.projects.map((p) => {
          const policy = state.projectSettings.find(
            (s) => s.id === "project:" + p.id || s.id === p.id,
          );
          return (
            <div className="project-setting" key={p.id}>
              <span>{p.title}</span>
              <label className="small">
                Base
                <input
                  aria-label={"Base branch for " + p.title}
                  defaultValue={policy?.baseRef ?? "main"}
                  onBlur={async (e) => {
                    if (e.target.value.trim())
                      try {
                        await api(
                          "/projects/" + encodeURIComponent(p.id),
                          { baseRef: e.target.value.trim() },
                          "PATCH",
                        );
                        onRefresh();
                      } catch (caught) {
                        const e = asError(caught);
                        onError(e);
                      }
                  }}
                />
              </label>
              <label className="small">
                Parallel
                <input
                  type="number"
                  min="1"
                  max="16"
                  aria-label={"Parallel tasks for " + p.title}
                  defaultValue={policy?.concurrencyLimit ?? 2}
                  onBlur={async (e) => {
                    try {
                      await api(
                        "/projects/" + encodeURIComponent(p.id),
                        { concurrencyLimit: Number(e.target.value) },
                        "PATCH",
                      );
                      onRefresh();
                    } catch (caught) {
                      const e = asError(caught);
                      onError(e);
                    }
                  }}
                />
              </label>
              <label className="checkbox small">
                <input
                  type="checkbox"
                  aria-label={"Active project " + p.title}
                  checked={autoOverrides[p.id] ?? policy?.autoStart !== false}
                  disabled={autoOverrides[p.id] !== undefined}
                  onChange={async (e) => {
                    const autoStart = e.target.checked;
                    setAutoOverrides((current) => ({
                      ...current,
                      [p.id]: autoStart,
                    }));
                    try {
                      await api(
                        "/projects/" + encodeURIComponent(p.id),
                        { autoStart },
                        "PATCH",
                      );
                      await onRefresh();
                    } catch (caught) {
                      const e = asError(caught);
                      onError(e);
                    } finally {
                      setAutoOverrides((current) => ({
                        ...current,
                        [p.id]: undefined,
                      }));
                    }
                  }}
                />
                {(autoOverrides[p.id] ?? policy?.autoStart !== false)
                  ? "Active"
                  : "Paused"}
              </label>
            </div>
          );
        })}
        <p className="muted small">
          Local SQLite database
          <br />
          <code>{state.dataDir}</code>
        </p>
      </div>
      <footer>
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (window.taskline) await window.taskline.configure(settings);
              try {
                await api("/settings", settings, "PATCH");
              } catch (caught) {
                const e = asError(caught);
                if (window.taskline)
                  await window.taskline.configure(state.settings);
                throw e;
              }
              onRefresh();
              onClose();
            } catch (caught) {
              const e = asError(caught);
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save settings
        </button>
      </footer>
    </Modal>
  );
}
function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  const [project, setProject] = useState("all");
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [epicEditor, setEpicEditor] = useState<Epic | Partial<Epic> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [view, setView] = useState("board");
  const [projectModeBusy, setProjectModeBusy] = useState(false);
  const [epicPanel, setEpicPanel] = useState(false);
  const selectionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSelections = useRef(0);
  const latestSettings = useRef<AppSettings | null>(null);
  const initialized = useRef(false);
  const captureOnly = new URLSearchParams(location.search).has("capture");
  useEffect(() => {
    const check = () => window.taskline?.desktopInfo().then(setDesktop);
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  async function refresh() {
    const s = await api<AppState>("/state");
    if (pendingSelections.current && latestSettings.current)
      s.settings = latestSettings.current;
    else latestSettings.current = s.settings;
    if (!initialized.current && s.projects.length) {
      initialized.current = true;
      const initialProject = defaultProject(s);
      setProject(initialProject || "all");
      setGroup(projectTargets(s, initialProject).groupId || "all");
    }
    setState(s);
    return s;
  }
  function rememberSelection(input: SelectionInput) {
    if (!state) return Promise.resolve();
    latestSettings.current = recordTargetUsage(
      latestSettings.current || state.settings,
      input,
    );
    setProject(input.projectId);
    setGroup(
      projectTargets(
        { ...state, settings: latestSettings.current },
        input.projectId,
      ).groupId || "all",
    );
    setState((previous) =>
      previous && latestSettings.current
        ? { ...previous, settings: latestSettings.current }
        : previous,
    );
    pendingSelections.current++;
    const pending = selectionQueue.current.then(() => api("/selection", input));
    selectionQueue.current = pending
      .catch(() => {})
      .finally(() => {
        pendingSelections.current--;
      });
    return pending;
  }
  const showError = (e: unknown) => {
    setError(asError(e).message);
    setTimeout(() => setError(""), 9000);
  };
  useEffect(() => {
    refresh().catch(showError);
    const events = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout>;
    events.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refresh().catch(showError), 150);
    };
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector(".image-viewer")) return;
      if (e.key === "Escape") {
        setComposer(false);
        setDetail(null);
        setSettings(false);
        if (captureOnly) window.taskline?.closeCapture();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="Search tasks"]')
          ?.focus();
      }
      if (
        e.key === "c" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName ?? "",
        )
      )
        setComposer(true);
    };
    document.addEventListener("keydown", handler);
    return () => {
      events.close();
      clearTimeout(timer);
      document.removeEventListener("keydown", handler);
    };
  }, []);
  if (!state)
    return (
      <div className="loading">
        <span className="brand-mark">T</span>
        <p>Opening your workspace…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  if (captureOnly)
    return (
      <Composer
        state={state}
        captureOnly
        onClose={() => window.taskline?.closeCapture()}
        onCreated={refresh}
        onRefresh={refresh}
        onSelection={rememberSelection}
      />
    );
  const filtered = state.tasks.filter(
    (t) =>
      (project === "all" || t.projectId === project) &&
      (group === "all" || t.groupId === group) &&
      (!search ||
        [t.title, t.prompt, state.groups.find((g) => g.id === t.groupId)?.name]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const selectedGroup = state.groups.find((g) => g.id === group);
  const selectedProject = state.projects.find((p) => p.id === project);
  const projectGroups = state.groups.filter(
    (g) => project === "all" || g.projectId === project,
  );
  const policy = state.projectSettings.find(
    (s) => s.id === "project:" + project || s.id === project,
  );
  async function drop(event: React.DragEvent, column: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/taskline");
    const task = state?.tasks.find((t) => t.id === id);
    if (!task) return;
    try {
      if (column === "todo" && task.status === "failed")
        await api("/tasks/" + id + "/retry", {});
      else if (column === "done" && task.status === "review")
        await api("/tasks/" + id, { status: "done" }, "PATCH");
      else if (column === "todo" && task.status === "todo")
        await api("/tasks/" + id, { rank: Date.now() }, "PATCH");
      else
        throw Error(
          "Running state is controlled by T3. Use the task actions to retry or request changes.",
        );
      await refresh();
    } catch (caught) {
      const e = asError(caught);
      showError(e);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="workspace">
          <span className="brand-mark">T</span>
          <strong>Taskline</strong>
          <ChevronDown size={14} />
        </div>
        <button
          className="sidebar-search"
          onClick={() =>
            document
              .querySelector<HTMLInputElement>('[aria-label="Search tasks"]')
              ?.focus()
          }
        >
          <Search size={15} />
          <span>Search tasks</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav>
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => {
              setView("board");
              setEpicPanel(false);
            }}
          >
            <LayoutGrid size={16} />
            My tasks
            <span className="nav-count">
              {
                state.tasks.filter(
                  (t) => !["done", "cancelled"].includes(t.status),
                ).length
              }
            </span>
          </button>
          <button
            className={view === "epics" ? "active" : ""}
            onClick={() => {
              setView("epics");
              setGroup("all");
            }}
          >
            <Layers size={16} />
            Epics<span className="nav-count">{state.groups.length}</span>
          </button>
        </nav>
        <div className="sidebar-heading">
          Projects
          <IconButton
            title="Refresh projects"
            onClick={() => api("/refresh", {}).then(refresh).catch(showError)}
          >
            <RefreshCw size={12} />
          </IconButton>
        </div>
        <nav className="project-nav">
          <button
            className={project === "all" ? "active" : ""}
            onClick={() => {
              setProject("all");
              setGroup("all");
              setView("board");
            }}
          >
            <Inbox size={15} />
            All projects
          </button>
          {recentProjects(state).map((p) => (
            <button
              key={p.id}
              className={project === p.id ? "active" : ""}
              onClick={() => {
                setProject(p.id);
                setGroup(projectTargets(state, p.id).groupId || "all");
                setView("board");
                rememberSelection({ projectId: p.id }).catch(showError);
              }}
            >
              <span className="project-symbol" aria-hidden="true">
                {p.title.slice(0, 1).toUpperCase()}
              </span>
              <span>{p.title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setSettings(true)}>
            <Settings size={15} />
            Settings
          </button>
          <div className="connection-status">
            <span
              className={
                "connection-dot " +
                (state.connection.connected ? "connected" : "")
              }
            />
            {state.connection.connected
              ? "T3 Code connected"
              : "T3 Code offline"}
          </div>
          <span className="small muted">Local-first · SQLite</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{selectedProject?.title || "Workspace"}</span>
            <ChevronRight size={13} />
            <strong>
              {view === "epics" ? "Epics" : selectedGroup?.name || "My tasks"}
            </strong>
          </div>
          <div className="row">
            {selectedProject && (
              <button
                className="button project-mode-button"
                disabled={projectModeBusy}
                aria-label={
                  (policy?.autoStart === false
                    ? "Activate project "
                    : "Pause project ") + selectedProject.title
                }
                title="Paused projects keep queued tasks; running turns continue."
                onClick={async () => {
                  setProjectModeBusy(true);
                  try {
                    await api(
                      "/projects/" + encodeURIComponent(selectedProject.id),
                      {
                        mode: policy?.autoStart === false ? "active" : "paused",
                      },
                      "PATCH",
                    );
                    await refresh();
                  } catch (caught) {
                    const error = asError(caught);
                    showError(error);
                  } finally {
                    setProjectModeBusy(false);
                  }
                }}
              >
                {policy?.autoStart === false ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}{" "}
                {policy?.autoStart === false ? "Paused" : "Active"}
              </button>
            )}
            <IconButton
              title={
                state.settings.paused ? "Resume scheduler" : "Pause scheduler"
              }
              onClick={() =>
                api(
                  "/settings",
                  { paused: !state.settings.paused },
                  "PATCH",
                ).then(refresh)
              }
            >
              {state.settings.paused ? <Play size={16} /> : <Pause size={16} />}
            </IconButton>
            <button
              className="primary-button compact"
              onClick={() => setComposer(true)}
            >
              <Plus size={15} />
              New task
            </button>
          </div>
        </header>
        <div className="page-title">
          <div>
            <h1>
              {view === "epics"
                ? "Epics"
                : selectedGroup?.name || selectedProject?.title || "My tasks"}
            </h1>
            <p>
              {view === "epics"
                ? "Shared context, decisions, and progress across your tasks."
                : state.settings.paused
                  ? "Scheduler paused. Existing work continues."
                  : "Capture an idea. Let your agents take it from here."}
            </p>
          </div>
          {view === "epics" ? (
            <button className="button" onClick={() => setEpicEditor({})}>
              <Plus size={14} />
              New epic
            </button>
          ) : (
            <div className="view-label">
              <LayoutGrid size={14} />
              Board
            </div>
          )}
        </div>
        {!state.connection.connected && (
          <div className="connection-banner">
            <AlertCircle size={16} />
            <span>
              {state.connection.error ||
                "Connect T3 Code to load projects and run tasks."}
            </span>
            <button
              className="text-button"
              onClick={() =>
                api("/connect/local", {}).then(refresh).catch(showError)
              }
            >
              Connect local T3
            </button>
          </div>
        )}
        {desktop && desktop.screenRecording !== "granted" && (
          <div className="connection-banner">
            <ImagePlus size={16} />
            <span>
              Allow Taskline screen recording to capture a screen region.
            </span>
            <button
              className="text-button"
              onClick={() => window.taskline?.openScreenPermissions()}
            >
              Enable screen recording
            </button>
          </div>
        )}
        {view === "board" && (
          <>
            <div className="board-toolbar">
              <div className="filters">
                <select
                  aria-label="Filter by epic"
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value);
                    if (selectedProject)
                      rememberSelection({
                        projectId: project,
                        groupId:
                          e.target.value === "all" ? null : e.target.value,
                      }).catch(showError);
                  }}
                >
                  <option value="all">All epics</option>
                  {projectGroups.map((g) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <span className="toolbar-divider" />
                <Search size={14} />
                <input
                  aria-label="Search tasks"
                  placeholder="Search tasks…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="row muted small">
                {selectedProject && (
                  <>
                    <CircleDot size={13} />
                    {
                      state.tasks.filter(
                        (t) => t.projectId === project && t.status === "doing",
                      ).length
                    }{" "}
                    / {policy?.concurrencyLimit ?? 2} active
                  </>
                )}
                {selectedGroup && (
                  <button
                    className="text-button"
                    onClick={() => setEpicPanel(!epicPanel)}
                  >
                    <Layers size={13} />
                    Epic context
                  </button>
                )}
              </div>
            </div>
            {selectedGroup && epicPanel && (
              <div className="inline-epic">
                <div className="row space-between">
                  <h3>Shared context · v{selectedGroup.contextVersion}</h3>
                  <button
                    className="text-button"
                    onClick={() => setEpicEditor(selectedGroup)}
                  >
                    Edit
                  </button>
                </div>
                <p className="preserve-text">
                  {selectedGroup.context || "Add shared context for this epic."}
                </p>
                {selectedGroup.summary && (
                  <p className="muted">{selectedGroup.summary.overview}</p>
                )}
              </div>
            )}
            <div className="kanban">
              {columns.map((column) => {
                const tasks = filtered
                  .filter((t) =>
                    column.id === "todo"
                      ? ["todo", "failed"].includes(t.status)
                      : column.id === "done"
                        ? ["done", "cancelled"].includes(t.status)
                        : t.status === column.id,
                  )
                  .sort(compareTaskPriority);
                const Icon = column.icon;
                return (
                  <section
                    className={"kanban-column column-" + column.id}
                    key={column.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, column.id)}
                  >
                    <header>
                      <div>
                        <Icon size={15} />
                        <strong>{column.title}</strong>
                        <span>{tasks.length}</span>
                      </div>
                      <IconButton
                        title={"Add task to " + column.title}
                        onClick={() => setComposer(true)}
                      >
                        <Plus size={15} />
                      </IconButton>
                    </header>
                    <div className="column-body">
                      {tasks.map((t) => (
                        <TaskCard
                          key={t.id}
                          task={t}
                          state={state}
                          onOpen={setDetail}
                        />
                      ))}
                      {tasks.length === 0 && (
                        <button
                          className="empty-column"
                          onClick={() => setComposer(true)}
                        >
                          <Plus size={13} />
                          No tasks
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
        {view === "epics" && (
          <div className="epics-grid">
            {projectGroups.map((g) => {
              const tasks = state.tasks.filter((t) => t.groupId === g.id);
              return (
                <article className="epic-card" key={g.id}>
                  <div className="row space-between">
                    <span className="epic-icon">
                      <Layers size={20} />
                    </span>
                    <span className="status-pill">
                      {g.status === "done"
                        ? "Done"
                        : tasks.some((t) => t.status === "doing")
                          ? "In Progress"
                          : tasks.some((t) => t.status === "failed")
                            ? "Needs attention"
                            : tasks.length &&
                                tasks.every((t) =>
                                  ["review", "done", "cancelled"].includes(
                                    t.status,
                                  ),
                                )
                              ? "Review"
                              : "To Do"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setEpicEditor(g)}
                    >
                      Edit
                    </button>
                  </div>
                  <h2>{g.name}</h2>
                  <p>{g.context || "No shared context yet."}</p>
                  <div className="epic-progress">
                    <div
                      style={{
                        width:
                          (tasks.length
                            ? (tasks.filter((t) => t.status === "done").length /
                                tasks.length) *
                              100
                            : 0) + "%",
                      }}
                    />
                  </div>
                  <div className="row space-between small muted">
                    <span>
                      {tasks.filter((t) => t.status === "done").length} /{" "}
                      {tasks.length} accepted
                    </span>
                    <span>Context v{g.contextVersion}</span>
                  </div>
                  {g.summary && (
                    <div className="epic-summary">
                      <h3>
                        Group summary <span className="small muted">Luna</span>
                      </h3>
                      <p>{g.summary.overview}</p>
                      {(
                        [
                          ["Open questions", g.summary.openQuestions],
                          ["Blockers", g.summary.blockers],
                          ["Testing coverage", g.summary.validationCoverage],
                          ["Next actions", g.summary.suggestedNextActions],
                        ] as [string, string[]][]
                      ).map(
                        ([name, items]) =>
                          items?.length > 0 && (
                            <details key={name}>
                              <summary>
                                {name} · {items.length}
                              </summary>
                              <ul>
                                {items.map((x, i) => (
                                  <li key={i}>{x}</li>
                                ))}
                              </ul>
                            </details>
                          ),
                      )}
                    </div>
                  )}
                  {g.summaryError && (
                    <p className="attention small">{g.summaryError}</p>
                  )}
                  <footer>
                    <button
                      className="button"
                      onClick={() => {
                        setGroup(g.id);
                        if (g.projectId)
                          rememberSelection({
                            projectId: g.projectId,
                            groupId: g.id,
                          }).catch(showError);
                        setView("board");
                        setEpicPanel(true);
                      }}
                    >
                      View tasks <ArrowUpRight size={13} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        api("/groups/" + g.id + "/summarize", {})
                          .then(refresh)
                          .catch(showError)
                      }
                    >
                      {g.summaryState === "pending"
                        ? "Summarizing…"
                        : "Refresh summary"}
                    </button>
                    {g.status !== "done" &&
                      tasks.length > 0 &&
                      tasks.every((t) =>
                        ["done", "cancelled"].includes(t.status),
                      ) && (
                        <button
                          className="text-button"
                          onClick={() =>
                            api(
                              "/groups/" + g.id,
                              { status: "done" },
                              "PATCH",
                            ).then(refresh)
                          }
                        >
                          Close epic
                        </button>
                      )}
                  </footer>
                </article>
              );
            })}
            {projectGroups.length === 0 && (
              <div className="empty-state">
                <Layers size={32} />
                <h2>Bring related tasks together</h2>
                <p>
                  Create an epic with shared context. Your agents inherit it,
                  and Luna summarizes the progress.
                </p>
                <button
                  className="primary-button"
                  onClick={() => setEpicEditor({})}
                >
                  Create an epic
                </button>
              </div>
            )}
          </div>
        )}
        <footer className="app-footer">
          <span>
            <Command size={12} />{" "}
            {state.settings.textShortcut.replace("CommandOrControl", "⌘")} ·
            Capture task
          </span>
          <span>
            {state.settings.screenshotShortcut.replace("CommandOrControl", "⌘")}{" "}
            · Capture screenshot
          </span>
        </footer>
      </main>
      {composer && (
        <Composer
          state={state}
          initialProjectId={project}
          initialGroupId={group}
          onClose={() => setComposer(false)}
          onCreated={refresh}
          onRefresh={refresh}
          onSelection={rememberSelection}
        />
      )}
      {detail && (
        <TaskDetail
          key={detail}
          id={detail}
          state={state}
          onClose={() => setDetail(null)}
          onRefresh={refresh}
          onError={showError}
          onOpenTask={setDetail}
        />
      )}
      {settings && (
        <SettingsDialog
          state={state}
          onClose={() => setSettings(false)}
          onRefresh={refresh}
          onError={showError}
        />
      )}
      {epicEditor && (
        <EpicEditor
          group={epicEditor.id ? epicEditor : null}
          projects={state.projects}
          projectId={selectedProject?.id}
          onClose={() => setEpicEditor(null)}
          onSave={refresh}
        />
      )}
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <IconButton title="Dismiss error" onClick={() => setError("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ImageViewerProvider>
    <App />
  </ImageViewerProvider>,
);
