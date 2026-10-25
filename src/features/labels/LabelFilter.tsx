import { availableLabels, labelKey } from "../../../shared/labels.js";

export function LabelFilter({
  items,
  value,
  onChange,
  name,
}: {
  items: { labels?: string[] }[];
  value: string;
  onChange: (value: string) => void;
  name: string;
}) {
  const labels = availableLabels([...items, { labels: value ? [value] : [] }]);
  return (
    <select
      aria-label={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All labels</option>
      {labels.map((label) => (
        <option key={labelKey(label)} value={labelKey(label)}>
          {label}
        </option>
      ))}
    </select>
  );
}
