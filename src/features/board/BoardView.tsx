import { CircleDot, Layers, Plus, Search } from "lucide-react";
import { compareTaskPriority } from "../../../server/task-planning.js";
import { IconButton } from "../../components/IconButton.js";
import { columns } from "../../lib/task-presentation.js";
import { TaskCard } from "../tasks/TaskCard.js";

import { useWorkspaceContext } from "../../app/workspace-context.js";
export function BoardView() {
  const {
    state,
    project,
    group,
    setGroup,
    search,
    setSearch,
    setComposer,
    setDetail,
    setEpicEditor,
    view,
    epicPanel,
    setEpicPanel,
    rememberSelection,
    showError,
    drop,
    filtered,
    selectedGroup,
    selectedProject,
    projectGroups,
    policy,
  } = useWorkspaceContext();
  return (
    <>
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
                      groupId: e.target.value === "all" ? null : e.target.value,
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
    </>
  );
}
