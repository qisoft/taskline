import type { Epic } from "../shared/types.js";

export function validateEpicMode(mode: unknown) {
  if (mode === undefined || mode === "active" || mode === "paused") return mode;
  throw Error("Epic mode must be active or paused");
}

export function schedulingPauseReason(epic: Epic | null, autoStart: boolean) {
  if (epic?.status === "done") return "Epic is closed";
  if (epic) return epic.mode === "paused" ? "Epic is paused" : null;
  return autoStart ? null : "Project is paused";
}
