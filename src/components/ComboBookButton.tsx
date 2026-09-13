"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AppPick } from "@/lib/picks";

export function ComboBookButton({ picks, origin }: { picks: AppPick[]; origin: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function book() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks, origin }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setMsg(json.error || "Failed");
      return;
    }
    setMsg(json.code);
    if (json.code) {
      try {
        await navigator.clipboard.writeText(json.code);
      } catch {
        /* ignore */
      }
    }
    if (json.url) window.open(json.url, "_blank", "noopener,noreferrer");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={busy} onClick={book} className="sc-btn">
        {busy ? "…" : "Open SportyBet"}
      </button>
      {msg && <span className="font-mono text-xs text-ink/50">{msg}</span>}
    </div>
  );
}
