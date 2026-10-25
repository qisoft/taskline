export interface LabelChanges {
  labels?: unknown;
  addLabels?: unknown;
  removeLabels?: unknown;
}
export const labelFields = ["labels", "addLabels", "removeLabels"];
export const labelKey = (label: string) => label.normalize("NFC").toLowerCase();

export function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) throw Error("Labels must be a list of strings");
  const unique = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== "string")
      throw Error("Labels must be a list of strings");
    const label = item.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!label || label.length > 64)
      throw Error("Each label must contain 1–64 characters");
    if (!unique.has(labelKey(label))) unique.set(labelKey(label), label);
  }
  if (unique.size > 20) throw Error("Use at most 20 labels");
  return [...unique.values()];
}

export function labelPatch(
  current: string[] | undefined,
  input: LabelChanges,
): { labels?: string[] } {
  if (!labelFields.some((key) => key in input)) return {};
  if ("labels" in input && ("addLabels" in input || "removeLabels" in input))
    throw Error("Replace labels or add/remove labels, not both");
  let labels = normalizeLabels(
    "labels" in input ? input.labels : (current ?? []),
  );
  if ("removeLabels" in input) {
    const removed = new Set(normalizeLabels(input.removeLabels).map(labelKey));
    labels = labels.filter((label) => !removed.has(labelKey(label)));
  }
  if ("addLabels" in input)
    labels = normalizeLabels([...labels, ...normalizeLabels(input.addLabels)]);
  return { labels };
}

export function matchesLabels(
  labels: string[] | undefined,
  required: string[],
) {
  const keys = new Set((labels ?? []).map(labelKey));
  return required.every((label) => keys.has(labelKey(label)));
}

export function availableLabels(items: { labels?: string[] }[]) {
  const unique = new Map<string, string>();
  for (const item of items)
    for (const label of item.labels ?? [])
      if (!unique.has(labelKey(label))) unique.set(labelKey(label), label);
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

export function labelDelta(previous: string[] | undefined, next: string[]) {
  return {
    addLabels: next.filter((label) => !matchesLabels(previous, [label])),
    removeLabels: (previous ?? []).filter(
      (label) => !matchesLabels(next, [label]),
    ),
  };
}
