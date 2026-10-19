import type React from "react";

export function IconButton({
  children,
  onClick,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  title: string;
  className?: string;
}) {
  return (
    <button
      className={"icon-button " + className}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
