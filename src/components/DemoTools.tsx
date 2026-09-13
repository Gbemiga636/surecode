"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoTools() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function autoGen() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/demo/auto-generate", { method: "POST" });
    const json = await res.json();
    setBusy(false);
    setMsg(json.ok ? `Placed: ${(json.placed || []).join(", ") || "none"}` : json.error);
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={autoGen} className="sc-btn">
        {busy ? "Building…" : "AI auto slips"}
      </button>
      {msg && <span className="text-sm text-ink/55">{msg}</span>}
    </div>
  );
}
