import { ArrowUpRight, Layers } from "lucide-react";
import { api } from "../../lib/api.js";

import { useWorkspaceContext } from "../../app/workspace-context.js";
export function EpicsView() {
  const {
    state,
    setGroup,
    setEpicEditor,
    view,
    setView,
    setEpicPanel,
    refresh,
    rememberSelection,
    showError,
    projectGroups,
  } = useWorkspaceContext();
  return (
    <>
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
                Create an epic with shared context. Your agents inherit it, and
                Luna summarizes the progress.
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
    </>
  );
}
