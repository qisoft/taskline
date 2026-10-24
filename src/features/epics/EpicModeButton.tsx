import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { asError } from "../../../shared/errors.js";
import type { Epic } from "../../../shared/types.js";
import { api } from "../../lib/api.js";

export function EpicModeButton({
  group,
  onRefresh,
  onError,
}: {
  group: Epic;
  onRefresh: () => Promise<unknown>;
  onError: (error: Error) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (group.status === "done") return null;
  const paused = group.mode === "paused";
  return (
    <button
      className="button"
      disabled={busy}
      aria-label={(paused ? "Activate epic " : "Pause epic ") + group.name}
      title="Epic scheduling is independent of its project. Running tasks continue when paused."
      onClick={async () => {
        setBusy(true);
        try {
          await api(
            "/groups/" + group.id,
            { mode: paused ? "active" : "paused" },
            "PATCH",
          );
          await onRefresh();
        } catch (error) {
          onError(asError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {paused ? <Pause size={14} /> : <Play size={14} />}
      {paused ? "Paused" : "Active"}
    </button>
  );
}
