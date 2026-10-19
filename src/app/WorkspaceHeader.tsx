import {
  AlertCircle,
  ChevronRight,
  ImagePlus,
  LayoutGrid,
  Pause,
  Play,
  Plus,
} from "lucide-react";
import { asError } from "../../shared/errors.js";
import { IconButton } from "../components/IconButton.js";
import { api } from "../lib/api.js";

import { useWorkspaceContext } from "./workspace-context.js";
export function WorkspaceHeader() {
  const {
    state,
    desktop,
    setComposer,
    setEpicEditor,
    view,
    projectModeBusy,
    setProjectModeBusy,
    refresh,
    showError,
    selectedGroup,
    selectedProject,
    policy,
  } = useWorkspaceContext();
  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <span>{selectedProject?.title || "Workspace"}</span>
          <ChevronRight size={13} />
          <strong>
            {view === "epics" ? "Epics" : selectedGroup?.name || "My tasks"}
          </strong>
        </div>
        <div className="row">
          {selectedProject && (
            <button
              className="button project-mode-button"
              disabled={projectModeBusy}
              aria-label={
                (policy?.autoStart === false
                  ? "Activate project "
                  : "Pause project ") + selectedProject.title
              }
              title="Paused projects keep queued tasks; running turns continue."
              onClick={async () => {
                setProjectModeBusy(true);
                try {
                  await api(
                    "/projects/" + encodeURIComponent(selectedProject.id),
                    {
                      mode: policy?.autoStart === false ? "active" : "paused",
                    },
                    "PATCH",
                  );
                  await refresh();
                } catch (caught) {
                  const error = asError(caught);
                  showError(error);
                } finally {
                  setProjectModeBusy(false);
                }
              }}
            >
              {policy?.autoStart === false ? (
                <Pause size={14} />
              ) : (
                <Play size={14} />
              )}{" "}
              {policy?.autoStart === false ? "Paused" : "Active"}
            </button>
          )}
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
            onClick={() => window.taskline?.openScreenPermissions()}
          >
            Enable screen recording
          </button>
        </div>
      )}
    </>
  );
}
