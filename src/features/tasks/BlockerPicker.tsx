import { X } from "lucide-react";
import type { AppState } from "../../../shared/types.js";

export function BlockerPicker({
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
