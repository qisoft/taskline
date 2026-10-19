import {
  AlertCircle,
  CircleHelp,
  Layers,
  MoreHorizontal,
  Paperclip,
  Pause,
} from "lucide-react";
import { pendingBlockers, priorities } from "../../../server/task-planning.js";
import type { AppState, Task } from "../../../shared/types.js";
import { label } from "../../lib/task-presentation.js";
import { ImagePreview } from "../images/ImageViewer.js";

export function TaskCard({
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
