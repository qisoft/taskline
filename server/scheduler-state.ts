export const activeStates = new Set([
  "reserved",
  "preparing",
  "starting",
  "queued",
  "running",
  "waiting",
  "recovering",
  "collecting",
]);
export const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
]);
