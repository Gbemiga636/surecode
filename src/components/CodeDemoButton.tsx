"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CodeDemoButton({ codeId }: { codeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function stake() {
    const raw = window.prompt("Virtual stake in ₦ (min 100)", "1000");
    if (raw == null) return;
    const stakeAmt = Number(raw);
    if (!Number.isFinite(stakeAmt) || stakeAmt < 100) return;
    setBusy(true);
    const res = await fetch("/api/demo/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeId, stake: stakeAmt, origin: "codes" }),
    });
    setBusy(false);
    const json = await res.json();
    if (json.ok) {
      router.push("/demo");
      router.refresh();
    } else {
      window.alert(json.error || "Failed");
    }
  }

  return (
    <button type="button" disabled={busy} onClick={stake} className="sc-btn-ghost">
      {busy ? "…" : "Demo ₦"}
    </button>
  );
}
