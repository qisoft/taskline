export function LabelList({ labels }: { labels?: string[] }) {
  if (!labels?.length) return null;
  return (
    <div className="item-labels" aria-label="Labels">
      {labels.map((label) => (
        <span className="item-label" key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}
