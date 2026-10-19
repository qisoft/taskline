import { createContext, useContext } from "react";
import type {
  AppState,
  Epic,
  Project,
  ProjectPolicy,
  Task,
} from "../../shared/types.js";
import type { useWorkspace } from "./useWorkspace.js";

type Workspace = ReturnType<typeof useWorkspace> & {
  state: AppState;
  filtered: Task[];
  selectedGroup?: Epic;
  selectedProject?: Project;
  projectGroups: Epic[];
  policy?: ProjectPolicy;
};
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspaceContext() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw Error("Workspace is not loaded");
  return workspace;
}
