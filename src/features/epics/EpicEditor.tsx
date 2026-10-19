import { useState } from "react";
import { asError } from "../../../shared/errors.js";
import type { AppState, Epic } from "../../../shared/types.js";
import { Modal } from "../../components/Modal.js";
import { api } from "../../lib/api.js";

export function EpicEditor({
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
