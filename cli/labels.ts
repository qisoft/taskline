import { normalizeLabels } from "../shared/labels.js";
import type { CliValues } from "./options.js";

export function cliLabelPatch(values: CliValues) {
  if (
    (values.label || values["clear-labels"]) &&
    (values["add-label"] || values["remove-label"])
  )
    throw Error("Use --label/--clear-labels or --add-label/--remove-label");
  if (values.label && values["clear-labels"])
    throw Error("Use --label or --clear-labels");
  return {
    ...(values.label ? { labels: normalizeLabels(values.label) } : {}),
    ...(values["clear-labels"] ? { labels: [] } : {}),
    ...(values["add-label"]
      ? { addLabels: normalizeLabels(values["add-label"]) }
      : {}),
    ...(values["remove-label"]
      ? { removeLabels: normalizeLabels(values["remove-label"]) }
      : {}),
  };
}
