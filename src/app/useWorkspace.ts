import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { recordTargetUsage } from "../../server/target-history.js";
import { asError } from "../../shared/errors.js";
import type {
  AppSettings,
  AppState,
  DesktopInfo,
  Epic,
  SelectionInput,
} from "../../shared/types.js";
import { api } from "../lib/api.js";
import { defaultProject, projectTargets } from "../task-targets.js";

export function useWorkspace() {
  const [state, setState] = useState<AppState | null>(null);
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  const [project, setProject] = useState("all");
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [epicEditor, setEpicEditor] = useState<Epic | Partial<Epic> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [view, setView] = useState("board");
  const [projectModeBusy, setProjectModeBusy] = useState(false);
  const [epicPanel, setEpicPanel] = useState(false);
  const selectionQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSelections = useRef(0);
  const latestSettings = useRef<AppSettings | null>(null);
  const initialized = useRef(false);
  const captureOnly = new URLSearchParams(location.search).has("capture");
  useEffect(() => {
    const check = () => window.taskline?.desktopInfo().then(setDesktop);
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  const refresh = useCallback(async () => {
    const s = await api<AppState>("/state");
    if (pendingSelections.current && latestSettings.current)
      s.settings = latestSettings.current;
    else latestSettings.current = s.settings;
    if (!initialized.current && s.projects.length) {
      initialized.current = true;
      const initialProject = defaultProject(s);
      setProject(initialProject || "all");
      setGroup(projectTargets(s, initialProject).groupId || "all");
    }
    setState(s);
    return s;
  }, []);
  function rememberSelection(input: SelectionInput) {
    if (!state) return Promise.resolve();
    latestSettings.current = recordTargetUsage(
      latestSettings.current || state.settings,
      input,
    );
    setProject(input.projectId);
    setGroup(
      projectTargets(
        { ...state, settings: latestSettings.current },
        input.projectId,
      ).groupId || "all",
    );
    setState((previous) =>
      previous && latestSettings.current
        ? { ...previous, settings: latestSettings.current }
        : previous,
    );
    pendingSelections.current++;
    const pending = selectionQueue.current.then(() => api("/selection", input));
    selectionQueue.current = pending
      .catch(() => {})
      .finally(() => {
        pendingSelections.current--;
      });
    return pending;
  }
  const showError = useCallback((e: unknown) => {
    setError(asError(e).message);
    setTimeout(() => setError(""), 9000);
  }, []);
  useEffect(() => {
    // Fetch and subscribe to the external board state on mount.
    // oxlint-disable-next-line react/set-state-in-effect
    refresh().catch(showError);
    const events = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout>;
    events.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refresh().catch(showError), 150);
    };
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector(".image-viewer")) return;
      if (e.key === "Escape") {
        setComposer(false);
        setDetail(null);
        setSettings(false);
        if (captureOnly) window.taskline?.closeCapture();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="Search tasks"]')
          ?.focus();
      }
      if (
        e.key === "c" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName ?? "",
        )
      )
        setComposer(true);
    };
    document.addEventListener("keydown", handler);
    return () => {
      events.close();
      clearTimeout(timer);
      document.removeEventListener("keydown", handler);
    };
  }, [captureOnly, refresh, showError]);
  async function drop(event: React.DragEvent, column: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/taskline");
    const task = state?.tasks.find((t) => t.id === id);
    if (!task) return;
    try {
      if (column === "todo" && task.status === "failed")
        await api("/tasks/" + id + "/retry", {});
      else if (column === "done" && task.status === "review")
        await api("/tasks/" + id, { status: "done" }, "PATCH");
      else if (column === "todo" && task.status === "todo")
        await api("/tasks/" + id, { rank: Date.now() }, "PATCH");
      else
        throw Error(
          "Running state is controlled by T3. Use the task actions to retry or request changes.",
        );
      await refresh();
    } catch (caught) {
      const e = asError(caught);
      showError(e);
    }
  }
  return {
    state,
    desktop,
    project,
    setProject,
    group,
    setGroup,
    search,
    setSearch,
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
    view,
    setView,
    projectModeBusy,
    setProjectModeBusy,
    epicPanel,
    setEpicPanel,
    captureOnly,
    refresh,
    rememberSelection,
    showError,
    drop,
  };
}
