import { ImagePlus, Mic, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { priorities } from "../../../server/task-planning.js";
import { asError } from "../../../shared/errors.js";
import type {
  AppState,
  ImageAttachment,
  SelectionInput,
  Task,
} from "../../../shared/types.js";
import { IconButton } from "../../components/IconButton.js";
import { Modal } from "../../components/Modal.js";
import { projectModel } from "../../composer-defaults.js";
import { api } from "../../lib/api.js";
import {
  defaultProject,
  projectTargets,
  recentProjects,
  recentThreads,
} from "../../task-targets.js";
import { EpicEditor } from "../epics/EpicEditor.js";
import { ImagePreview } from "../images/ImageViewer.js";
import { BlockerPicker } from "./BlockerPicker.js";

export function Composer({
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
  const threads = useMemo(
    () => recentThreads(state, projectId),
    [state, projectId],
  );
  const remember = (input: Partial<SelectionInput>) =>
    onSelection({ projectId, ...input }).catch((e) => setError(e.message));
  useEffect(() => {
    if (
      threadId &&
      threadId !== "__named__" &&
      !threads.some((t) => t.id === threadId)
    )
      // A target removed by the server must no longer be selected.
      // oxlint-disable-next-line react/set-state-in-effect
      setThread("");
  }, [threadId, threads]);
  const groups = useMemo(
    () =>
      state.groups.filter(
        (g) => g.projectId === projectId && g.status !== "done",
      ),
    [state.groups, projectId],
  );
  useEffect(() => {
    // Reconcile the selection when an epic is closed or deleted externally.
    // oxlint-disable-next-line react/set-state-in-effect
    if (groupId && !groups.some((g) => g.id === groupId)) setGroup("");
  }, [groups, groupId]);
  useEffect(() => {
    sessionStorage.setItem("taskline-draft", prompt);
  }, [prompt]);
  useEffect(() => {
    if (captureOnly && window.taskline)
      window.taskline.pendingCapture().then((a) => {
        if (a) setAttachments([a]);
      });
  }, [captureOnly]);
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
