"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* ignore */
    }
  }
  return (
    <button type="button" onClick={copy} className="sc-btn-ghost text-xs">
      {done ? "Copied" : label}
    </button>
  );
}
