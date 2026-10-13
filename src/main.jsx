import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Plus,
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
import "@fontsource-variable/inter";
if (window.taskline) document.body.classList.add("desktop");

const api = async (
  path,
  body,
  method = body === undefined ? "GET" : "POST",
) => {
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
const time = (value) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
const label = {
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
function IconButton({ children, onClick, title, className = "" }) {
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
function Modal({ title, children, onClose, className = "" }) {
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

function Composer({
  state,
  onClose,
  onCreated,
  onRefresh,
  captureOnly = false,
  initialAttachments = [],
}) {
  const [projectId, setProject] = useState(
    state.settings.lastProjectId || state.projects[0]?.id || "",
  );
  const [threadId, setThread] = useState(state.settings.lastThreadId || "");
  const [epicEditor, setEpicEditor] = useState(false);
  const [groupId, setGroup] = useState(state.settings.lastGroupId || "");
  const [prompt, setPrompt] = useState(
    () => sessionStorage.getItem("taskline-draft") || "",
  );
  const [model, setModel] = useState(() => {
    const p = state.projectSettings.find(
      (s) => s.id === "project:" + projectId || s.id === projectId,
    );
    return (p?.instanceId || "codex") + "::" + (p?.model || "gpt-6-luna");
  });
  const [attachments, setAttachments] = useState(initialAttachments);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threads = state.threads.filter(
    (t) =>
      t.projectId === projectId &&
      !t.archivedAt &&
      (t.lineage?.relationshipToParent ?? t.relationshipToParent) !==
        "subagent",
  );
  useEffect(() => {
    if (threadId && !threads.some((t) => t.id === threadId)) setThread("");
  }, [projectId, state.threads]);
  useEffect(() => {
    sessionStorage.setItem("taskline-draft", prompt);
  }, [prompt]);
  useEffect(() => {
    if (captureOnly && window.taskline)
      window.taskline.pendingCapture().then((a) => {
        if (a) setAttachments([a]);
      });
  }, []);
  async function attach(files) {
    try {
      for (const file of files) {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        const a = await api("/attachments", {
          base64,
          name: file.name,
          mimeType: file.type,
        });
        setAttachments((previous) => [...previous, a]);
      }
    } catch (e) {
      setError(e.message);
    }
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const task = await api("/tasks", {
        prompt,
        projectId,
        threadId: threadId || null,
        groupId: groupId || null,
        model: model.split("::")[1],
        instanceId: model.split("::")[0],
        attachments,
      });
      sessionStorage.removeItem("taskline-draft");
      onCreated(task);
      if (captureOnly) window.taskline?.closeCapture();
      else onClose();
    } catch (e) {
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
                <img src={a.url} alt={a.name} />
                <button
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
                setProject(e.target.value);
                setThread("");
                const p = state.projectSettings.find(
                  (s) =>
                    s.id === "project:" + e.target.value ||
                    s.id === e.target.value,
                );
                setModel(
                  (p?.instanceId || "codex") +
                    "::" +
                    (p?.model || "gpt-6-luna"),
                );
              }}
            >
              {state.projects.map((p) => (
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
                const thread = threads.find((t) => t.id === e.target.value);
                if (thread)
                  setModel(
                    thread.providerInstanceId +
                      "::" +
                      thread.modelSelection.model,
                  );
              }}
            >
              <option value="">New thread · separate worktree</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.status}
                </option>
              ))}
            </select>
          </label>
        </div>
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
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">No epic</option>
              {state.groups
                .filter((g) => g.status !== "done")
                .map((g) => (
                  <option value={g.id} key={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Model
            <select
              aria-label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
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
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
      {epicEditor && (
        <EpicEditor
          onClose={() => setEpicEditor(false)}
          onSave={async (group) => {
            await onRefresh();
            setGroup(group.id);
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
              onChange={(e) => attach(Array.from(e.target.files))}
            />
          </label>
          <IconButton
            title="Dictate using your system dictation shortcut"
            onClick={() =>
              document.querySelector('[aria-label="Task prompt"]')?.focus()
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

function ValidationImages({ record }) {
  if (!record.validationImages?.length && !record.validationImageIssues?.length)
    return null;
  return (
    <div className="validation-images">
      <h4>Screenshots from T3</h4>
      <div className="validation-gallery">
        {record.validationImages?.map((image) => (
          <figure key={image.id}>
            <a href={image.url} target="_blank" rel="noreferrer">
              <img loading="lazy" src={image.url} alt={image.name} />
            </a>
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

function TaskCard({ task, state, onOpen, onDragStart }) {
  const project = state.projects.find((p) => p.id === task.projectId);
  const group = state.groups.find((g) => g.id === task.groupId);
  const questions =
    (task.questions?.length ?? 0) + (task.report?.questions?.length ?? 0);
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
        <MoreHorizontal size={15} />
      </div>
      <h3>{task.title}</h3>
      {task.attachments?.[0] && (
        <img
          className="card-image"
          src={task.attachments[0].url}
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
      {task.waitReason && task.status === "todo" && (
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
function TaskDetail({ id, state, onClose, onRefresh, onError }) {
  const [detail, setDetail] = useState(null);
  const [answers, setAnswers] = useState({});
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("overview");
  const task = state.tasks.find((t) => t.id === id);
  useEffect(() => {
    api("/tasks/" + id)
      .then(setDetail)
      .catch(onError);
  }, [id, task?.updatedAt, task?.reportState]);
  if (!task) return null;
  const attempt =
    detail?.attempts.find((a) => a.id === task.currentAttemptId) ||
    detail?.attempts.at(-1);
  async function action(name, data = {}) {
    setBusy(true);
    try {
      await api("/tasks/" + id + "/" + name, data);
      await onRefresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const project = state.projects.find((p) => p.id === task.projectId);
  const report = task.report;
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
            <IconButton
              title="Open in T3 Code"
              onClick={() =>
                window.taskline
                  ? window.taskline.openThread(task.threadId)
                  : window.open("http://127.0.0.1:3773", "_blank")
              }
            >
              <ArrowUpRight size={17} />
            </IconButton>
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
            <span>Model</span>
            <strong>{task.model}</strong>
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
                } catch (e) {
                  onError(e);
                }
              }}
            >
              <option value="">No epic</option>
              {state.groups.map((g) => (
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
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                    <img className="detail-image" src={a.url} alt={a.name} />
                  </a>
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
                              {question.options?.length > 0 && (
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
                                  {question.options.map((o) => (
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
                      {item.payload.input && item.payload.input + "\n\n"}
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
function EpicEditor({ group, onClose, onSave }) {
  const [name, setName] = useState(group?.name || "");
  const [context, setContext] = useState(group?.context || "");
  const [criteria, setCriteria] = useState(group?.acceptanceCriteria || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={group ? "Edit epic" : "New epic"} onClose={onClose}>
      <div className="form-body">
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
          disabled={!name.trim() || busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const saved = await api(
                group ? "/groups/" + group.id : "/groups",
                { name, context, acceptanceCriteria: criteria },
                group ? "PATCH" : "POST",
              );
              await onSave(saved);
              onClose();
            } catch (e) {
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
function SettingsDialog({ state, onClose, onRefresh, onError }) {
  const [desktop, setDesktop] = useState(null);
  useEffect(() => {
    window.taskline?.desktopInfo().then(setDesktop);
  }, []);
  const [origin, setOrigin] = useState(state.connection.origin || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(state.settings);
  const [autoOverrides, setAutoOverrides] = useState({});
  async function connect(local) {
    setBusy(true);
    try {
      await api(
        local ? "/connect/local" : "/connect",
        local ? {} : { origin, token },
      );
      await onRefresh();
      setToken("");
    } catch (e) {
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
        <h3>Global capture</h3>
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
                onClick={() => window.taskline.openScreenPermissions()}
              >
                Enable screen recording
              </button>
            )}
          </div>
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
                      } catch (e) {
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
                    } catch (e) {
                      onError(e);
                    }
                  }}
                />
              </label>
              <label className="checkbox small">
                <input
                  type="checkbox"
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
                    } catch (e) {
                      onError(e);
                    } finally {
                      setAutoOverrides((current) => ({
                        ...current,
                        [p.id]: undefined,
                      }));
                    }
                  }}
                />
                Auto
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
          onClick={async () => {
            try {
              await api("/settings", settings, "PATCH");
              if (window.taskline) await window.taskline.configure(settings);
              onRefresh();
              onClose();
            } catch (e) {
              onError(e);
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
  const [state, setState] = useState(null);
  const [desktop, setDesktop] = useState(null);
  const [project, setProject] = useState("all");
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
  const [detail, setDetail] = useState(null);
  const [settings, setSettings] = useState(false);
  const [epicEditor, setEpicEditor] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("board");
  const [epicPanel, setEpicPanel] = useState(false);
  const captureOnly = new URLSearchParams(location.search).has("capture");
  useEffect(() => {
    const check = () => window.taskline?.desktopInfo().then(setDesktop);
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  async function refresh() {
    const s = await api("/state");
    setState(s);
    return s;
  }
  const showError = (e) => {
    setError(e.message || String(e));
    setTimeout(() => setError(""), 9000);
  };
  useEffect(() => {
    refresh().catch(showError);
    const events = new EventSource("/api/events");
    let timer;
    events.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refresh().catch(showError), 150);
    };
    const handler = (e) => {
      if (e.key === "Escape") {
        setComposer(false);
        setDetail(null);
        setSettings(false);
        if (captureOnly) window.taskline?.closeCapture();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector('[aria-label="Search tasks"]')?.focus();
      }
      if (
        e.key === "c" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement.tagName,
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
  const policy = state.projectSettings.find(
    (s) => s.id === "project:" + project || s.id === project,
  );
  async function drop(event, column) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/taskline");
    const task = state.tasks.find((t) => t.id === id);
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
    } catch (e) {
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
            document.querySelector('[aria-label="Search tasks"]')?.focus()
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
              setView("board");
            }}
          >
            <Inbox size={15} />
            All projects
          </button>
          {state.projects.map((p) => (
            <button
              key={p.id}
              className={project === p.id ? "active" : ""}
              onClick={() => {
                setProject(p.id);
                setView("board");
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
              onClick={() => window.taskline.openScreenPermissions()}
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
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option value="all">All epics</option>
                  {state.groups.map((g) => (
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
                      ? ["todo", "failed", "cancelled"].includes(t.status)
                      : t.status === column.id,
                  )
                  .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
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
            {state.groups.map((g) => {
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
                      {[
                        ["Open questions", g.summary.openQuestions],
                        ["Blockers", g.summary.blockers],
                        ["Testing coverage", g.summary.validationCoverage],
                        ["Next actions", g.summary.suggestedNextActions],
                      ].map(
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
            {state.groups.length === 0 && (
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
          onClose={() => setComposer(false)}
          onCreated={refresh}
          onRefresh={refresh}
        />
      )}
      {detail && (
        <TaskDetail
          id={detail}
          state={state}
          onClose={() => setDetail(null)}
          onRefresh={refresh}
          onError={showError}
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
createRoot(document.getElementById("root")).render(<App />);
