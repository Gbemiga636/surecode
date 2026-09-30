"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icons";

export function DemoTools() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(true);
  const [busy, setBusy] = useState(false);

  async function autoGen() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/auto-generate", { method: "POST" });
      const json = await res.json();
      const placed: string[] = json.placed || [];
      setOk(Boolean(json.ok));
      setMsg(
        json.ok
          ? placed.length
            ? `Placed ${placed.length} slip${placed.length === 1 ? "" : "s"}: ${placed.join(", ")}`
            : "No slips placed. Balance may be too low or no picks are ready yet."
          : json.error || "Could not build slips",
      );
      router.refresh();
    } catch {
      setOk(false);
      setMsg("Could not build slips. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dw-tools">
      <button type="button" disabled={busy} onClick={autoGen} className="dw-auto">
        <span className="dw-auto-ic">
          <Icon name={busy ? "clock" : "bolt"} size={18} />
        </span>
        <span className="dw-auto-text">
          <strong>{busy ? "Building slips…" : "AI auto slips"}</strong>
          <span>Places 2x, 5x, 10x and 20x+ practice slips</span>
        </span>
        <Icon name="arrowRight" size={16} className="dw-auto-go" />
      </button>
      {msg && <p className={`dw-msg${ok ? "" : " is-bad"}`}>{msg}</p>}
    </div>
  );
}
