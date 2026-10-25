import { X } from "lucide-react";
import { useId, useState } from "react";
import { asError } from "../../../shared/errors.js";
import { matchesLabels, normalizeLabels } from "../../../shared/labels.js";

export function LabelEditor({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  name,
}: {
  value: string[];
  onChange: (patch: {
    addLabels?: string[];
    removeLabels?: string[];
  }) => unknown;
  suggestions?: string[];
  disabled?: boolean;
  name: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(patch: {
    addLabels?: string[];
    removeLabels?: string[];
  }) {
    setBusy(true);
    setError("");
    try {
      await onChange(patch);
      if (patch.addLabels) setDraft("");
    } catch (caught) {
      setError(asError(caught).message);
    } finally {
      setBusy(false);
    }
  }
  function add() {
    try {
      const labels = normalizeLabels([draft]);
      normalizeLabels([...value, ...labels]);
      void change({ addLabels: labels });
    } catch (caught) {
      setError(asError(caught).message);
    }
  }
  return (
    <div className="label-editor">
      <label htmlFor={id}>Labels</label>
      <div className="item-labels">
        {value.map((label) => (
          <button
            type="button"
            className="item-label"
            key={label}
            disabled={disabled || busy}
            aria-label={"Remove label " + label}
            onClick={() => change({ removeLabels: [label] })}
          >
            {label}
            <X size={12} />
          </button>
        ))}
      </div>
      <div className="label-entry">
        <input
          id={id}
          aria-label={name}
          value={draft}
          list={id + "-suggestions"}
          placeholder="Add a label…"
          disabled={disabled || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (draft.trim()) add();
            }
          }}
        />
        <datalist id={id + "-suggestions"}>
          {suggestions
            .filter((label) => !matchesLabels(value, [label]))
            .map((label) => (
              <option key={label} value={label} />
            ))}
        </datalist>
        <button
          type="button"
          className="button"
          disabled={disabled || busy || !draft.trim()}
          onClick={add}
        >
          Add label
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
