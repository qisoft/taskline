import {
  ChevronDown,
  Inbox,
  Layers,
  LayoutGrid,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { IconButton } from "../components/IconButton.js";
import { api } from "../lib/api.js";
import { projectTargets, recentProjects } from "../task-targets.js";

import { useWorkspaceContext } from "./workspace-context.js";
export function Sidebar() {
  const {
    state,
    project,
    setProject,
    setGroup,
    setSettings,
    view,
    setView,
    setEpicPanel,
    refresh,
    rememberSelection,
    showError,
  } = useWorkspaceContext();
  return (
    <>
      <aside className="sidebar">
        <div className="workspace">
          <span className="brand-mark">T</span>
          <strong>Taskline</strong>
          <ChevronDown size={14} />
        </div>
        <button
          className="sidebar-search"
          onClick={() =>
            document
              .querySelector<HTMLInputElement>('[aria-label="Search tasks"]')
              ?.focus()
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
              setGroup("all");
              setView("board");
            }}
          >
            <Inbox size={15} />
            All projects
          </button>
          {recentProjects(state).map((p) => (
            <button
              key={p.id}
              className={project === p.id ? "active" : ""}
              onClick={() => {
                setProject(p.id);
                setGroup(projectTargets(state, p.id).groupId || "all");
                setView("board");
                rememberSelection({ projectId: p.id }).catch(showError);
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
    </>
  );
}
