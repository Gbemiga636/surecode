"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icons";

export function CodeActions({
  code,
  openUrl,
  sureCodeId,
  codeId,
}: {
  code: string;
  openUrl: string;
  sureCodeId?: string;
  codeId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function placeDemo() {
    const n = Math.round(Number(stake) || 0);
    if (n < 100) {
      setErr("Minimum ₦100");
      return;
    }
    setBusy(true);
    setErr(null);
    const body = sureCodeId
      ? { sureCodeId, stake: n }
      : codeId
        ? { codeId, stake: n }
        : null;
    if (!body) return;
    const res = await fetch("/api/demo/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setErr(json.error || "Failed");
      return;
    }
    setOpen(false);
    router.push("/demo");
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <a href={openUrl} target="_blank" rel="noopener noreferrer" className="sc-btn">
          <Icon name="external" size={15} />
          Open SportyBet
        </a>
        <button type="button" className="sc-btn-ghost" onClick={copy}>
          <Icon name="copy" size={15} />
          {copied ? "Copied" : "Copy"}
        </button>
        {(sureCodeId || codeId) && (
          <button type="button" className="sc-btn-ghost" onClick={() => setOpen(true)}>
            <Icon name="wallet" size={15} />
            Demo ₦
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(29,29,31,0.35)] p-4 backdrop-blur-sm sm:items-center">
          <div className="sc-card w-full max-w-sm p-6">
            <p className="font-display text-lg font-bold tracking-tight">Demo stake</p>
            <p className="mt-1 font-mono text-sm text-[var(--accent)]">{code}</p>
            <label className="mt-4 block text-sm font-semibold">
              Amount (₦)
              <input
                className="sc-input"
                inputMode="numeric"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
              />
            </label>
            {err && <p className="mt-2 text-sm text-[var(--bad)]">{err}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" className="sc-btn-ghost flex-1" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="sc-btn flex-1" disabled={busy} onClick={placeDemo}>
                {busy ? "…" : "Place demo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
