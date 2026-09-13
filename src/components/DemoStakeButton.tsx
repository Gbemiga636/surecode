"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DemoStakeButton({
  sureCodeId,
  code,
}: {
  sureCodeId: string;
  code: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function stake() {
    const raw = window.prompt("Virtual stake in ₦ (min 100)", "1000");
    if (raw == null) return;
    const stake = Number(raw);
    if (!Number.isFinite(stake) || stake < 100) {
      setMsg("Minimum stake is ₦100");
      return;
    }
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/demo/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sureCodeId, stake }),
    });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setMsg(json.error || "Failed");
      return;
    }
    setMsg(`Demo bet placed on ${code}`);
    router.push("/demo");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={stake} disabled={loading} className="sc-btn-ghost">
        {loading ? "…" : "Demo ₦"}
      </button>
      {msg && <span className="max-w-[12rem] text-right text-xs text-slate-500">{msg}</span>}
    </div>
  );
}
