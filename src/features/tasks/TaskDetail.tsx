import { ArrowUpRight, Check, ChevronRight, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { priorities } from "../../../server/task-planning.js";
import { asError } from "../../../shared/errors.js";
import type {
  AppState,
  Priority,
  Task,
  TaskDetail as TaskDetailData,
} from "../../../shared/types.js";
import { IconButton } from "../../components/IconButton.js";
import { api } from "../../lib/api.js";
import { columns, label, time } from "../../lib/task-presentation.js";
import { BlockerPicker } from "./BlockerPicker.js";
import { TaskOverview } from "./TaskOverview.js";
import { ValidationImages } from "./ValidationImages.js";

export function TaskDetail({
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
  }, [id, task?.updatedAt, task?.reportState, onError]);
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
            <TaskOverview
              task={task}
              busy={busy}
              answers={answers}
              setAnswers={setAnswers}
              revision={revision}
              setRevision={setRevision}
              action={action}
            />
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
