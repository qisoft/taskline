import { CheckCircle2, Circle, CircleDot, CircleHelp } from "lucide-react";

export const columns = [
  { id: "todo", title: "To Do", icon: Circle },
  { id: "doing", title: "In Progress", icon: CircleDot },
  { id: "review", title: "Review", icon: CircleHelp },
  { id: "done", title: "Done", icon: CheckCircle2 },
];
export const time = (value: string | number | Date) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
export const label: Record<string, string> = {
  reserved: "Starting",
  preparing: "Preparing workspace",
  starting: "Starting",
  running: "Running",
  waiting: "Needs input",
  queued: "Queued in T3",
  recovering: "Reconnecting",
  collecting: "Saving screenshots",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  queued_on_board: "Queued on board",
};
