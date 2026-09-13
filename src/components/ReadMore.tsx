"use client";

import { useState } from "react";

export function ReadMore({
  text,
  limit = 110,
  className = "",
}: {
  text: string;
  limit?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const needsClamp = text.length > limit;
  const shown = !needsClamp || open ? text : `${text.slice(0, limit).trimEnd()}…`;

  return (
    <div className={className}>
      <p className="text-sm leading-relaxed text-[var(--muted)]">{shown}</p>
      {needsClamp && (
        <button
          type="button"
          className="mt-1.5 text-xs font-bold text-[var(--accent)] underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
