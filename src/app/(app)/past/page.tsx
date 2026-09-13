import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { sportyOpenUrl } from "@/lib/sporty";
import { PageHeader } from "@/components/PageHeader";

export default async function PastPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from(T.pastCodes)
    .select("*")
    .order("day", { ascending: false })
    .limit(40);

  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        kicker="Track record"
        title="Past codes"
        subtitle="Published slips and settle results when matches finish."
      />
      {!rows.length && <div className="sc-empty text-sm text-ink/55">No past codes yet.</div>}
      <div className="space-y-2.5">
        {rows.map((r) => {
          const outcome = r.outcome || "PENDING";
          const tone =
            outcome === "WON"
              ? "bg-emerald-100 text-emerald-900"
              : outcome === "LOST"
                ? "bg-rose-100 text-rose-900"
                : outcome === "VOID"
                  ? "bg-slate-100 text-slate-700"
                  : "bg-amber-100 text-amber-950";
          return (
            <div key={r.id} className="sc-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs text-ink/40">{r.day}</p>
                <p className="font-mono text-lg font-extrabold tracking-wide">{r.code}</p>
                <p className="text-sm text-ink/55">
                  Odds {r.total_odds != null ? Number(r.total_odds).toFixed(2) : "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${tone}`}>
                  {outcome}
                </span>
                <a
                  className="sc-btn-ghost text-xs"
                  href={r.share_url || sportyOpenUrl(r.code)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
