import { AlertCircle, Command, X } from "lucide-react";
import { IconButton } from "../components/IconButton.js";
import { BoardView } from "../features/board/BoardView.js";
import { EpicEditor } from "../features/epics/EpicEditor.js";
import { EpicsView } from "../features/epics/EpicsView.js";
import { SettingsDialog } from "../features/settings/SettingsDialog.js";
import { Composer } from "../features/tasks/Composer.js";
import { TaskDetail } from "../features/tasks/TaskDetail.js";
import { Sidebar } from "./Sidebar.js";
import { useWorkspace } from "./useWorkspace.js";
import { WorkspaceContext } from "./workspace-context.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";

export function App() {
  const workspace = useWorkspace();
  const {
    state,
    project,
    group,
    search,
    composer,
    setComposer,
    detail,
    setDetail,
    settings,
    setSettings,
    epicEditor,
    setEpicEditor,
    error,
    setError,
    captureOnly,
    refresh,
    rememberSelection,
    showError,
  } = workspace;
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
        [
          t.title,
          t.prompt,
          ...(t.labels ?? []),
          state.groups.find((g) => g.id === t.groupId)?.name,
        ]
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
  return (
    <WorkspaceContext.Provider
      value={{
        ...workspace,
        state,
        filtered,
        selectedGroup,
        selectedProject,
        projectGroups,
        policy,
      }}
    >
      <div className="app-shell">
        <Sidebar />

        <main className="main">
          <WorkspaceHeader />
          <BoardView />
          <EpicsView />
          <footer className="app-footer">
            <span>
              <Command size={12} />{" "}
              {state.settings.textShortcut.replace("CommandOrControl", "⌘")} ·
              Capture task
            </span>
            <span>
              {state.settings.screenshotShortcut.replace(
                "CommandOrControl",
                "⌘",
              )}{" "}
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
            labelledItems={[...state.tasks, ...state.groups]}
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
    </WorkspaceContext.Provider>
  );
}
