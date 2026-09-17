import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { sportyOpenUrl } from "@/lib/sporty";
import { PageHeader } from "@/components/PageHeader";
import { PastFilters } from "@/components/PastFilters";
import { ReadMore } from "@/components/ReadMore";

export const dynamic = "force-dynamic";

type PastRow = {
  id: string;
  day: string;
  code: string;
  share_url: string | null;
  total_odds: number | null;
  confidence: number | null;
  legs: { home?: string; away?: string; pickLabel?: string; odds?: number }[] | null;
  rationale: string | null;
  outcome: string | null;
  settled_at: string | null;
};

function monthBounds(ym: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${ym}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

export default async function PastPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; month?: string; year?: string; outcome?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Full archive for filter options + stats (kept forever — never deleted by crawl)
  const { data: archive } = await supabase
    .from(T.pastCodes)
    .select("id, day, outcome")
    .order("day", { ascending: false })
    .limit(5000);

  const archiveRows = archive ?? [];
  const months = [
    ...new Set(
      archiveRows
        .map((r) => String(r.day).slice(0, 7))
        .filter(Boolean),
    ),
  ];
  const years = [
    ...new Set(archiveRows.map((r) => String(r.day).slice(0, 4)).filter(Boolean)),
  ];

  let query = supabase
    .from(T.pastCodes)
    .select("*")
    .order("day", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(800);

  if (sp.day) query = query.eq("day", sp.day);
  else if (sp.month) {
    const b = monthBounds(sp.month);
    if (b) query = query.gte("day", b.from).lte("day", b.to);
  } else if (sp.year && /^\d{4}$/.test(sp.year)) {
    query = query.gte("day", `${sp.year}-01-01`).lte("day", `${sp.year}-12-31`);
  }

  if (sp.outcome && ["WON", "LOST", "PENDING", "VOID"].includes(sp.outcome)) {
    if (sp.outcome === "PENDING") {
      query = query.or("outcome.is.null,outcome.eq.PENDING");
    } else {
      query = query.eq("outcome", sp.outcome);
    }
  }

  const { data } = await query;
  const rows = (data ?? []) as PastRow[];

  // Stats over filtered set (or full archive when no list filter beyond what's shown)
  const pool = rows.length ? rows : (archiveRows as PastRow[]);
  const entered = pool.length;
  const won = pool.filter((r) => r.outcome === "WON").length;
  const lost = pool.filter((r) => r.outcome === "LOST").length;
  const voided = pool.filter((r) => r.outcome === "VOID").length;
  const pending = pool.filter(
    (r) => !r.outcome || r.outcome === "PENDING",
  ).length;
  const decided = won + lost;
  const winRate = decided > 0 ? Math.round((won / decided) * 100) : null;

  // Lifetime stats (always from full archive)
  const lifeWon = archiveRows.filter((r) => r.outcome === "WON").length;
  const lifeLost = archiveRows.filter((r) => r.outcome === "LOST").length;
  const lifeDecided = lifeWon + lifeLost;
  const lifeRate =
    lifeDecided > 0 ? Math.round((lifeWon / lifeDecided) * 100) : null;

  return (
    <div>
      <PageHeader
        kicker="Track record"
        title="Past codes"
        subtitle="Permanent archive — filter by day, month, or year. Every code stays forever and trains the AI after settle."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Shown" value={String(entered)} />
        <Stat label="Won" value={String(won)} tone="good" />
        <Stat label="Lost" value={String(lost)} tone="bad" />
        <Stat label="Pending" value={String(pending)} />
        <Stat label="Void" value={String(voided)} />
        <Stat
          label="Win rate"
          value={winRate != null ? `${winRate}%` : "—"}
          tone={winRate != null && winRate >= 55 ? "good" : undefined}
        />
      </div>

      <p className="mb-4 text-xs font-medium text-[var(--muted)]">
        Lifetime archive: <strong className="text-[var(--ink)]">{archiveRows.length}</strong> codes
        · {lifeWon} won · {lifeLost} lost
        {lifeRate != null ? ` · ${lifeRate}% settled win rate` : ""}
        {" · "}feeds AI learning on every crawl
      </p>

      <Suspense fallback={<div className="sc-card mb-5 h-24 animate-pulse" />}>
        <PastFilters months={months} years={years} />
      </Suspense>

      {!rows.length && (
        <div className="sc-empty text-sm text-[var(--muted)]">
          No codes match these filters. Clear filters or wait for the next crawl.
        </div>
      )}

      <div className="space-y-3">
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
          const legs = Array.isArray(r.legs) ? r.legs : [];
          return (
            <article key={r.id} className="sc-card overflow-hidden p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3.5">
                <div>
                  <p className="text-xs font-semibold text-[var(--muted)]">
                    {r.day}
                    {r.settled_at
                      ? ` · settled ${new Date(r.settled_at).toLocaleString("en-NG", {
                          timeZone: "Africa/Lagos",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}`
                      : ""}
                  </p>
                  <p className="mt-1 font-mono text-lg font-extrabold tracking-wide text-[var(--ink)]">
                    {r.code}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {legs.length} game{legs.length === 1 ? "" : "s"} · odds{" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {r.total_odds != null ? Number(r.total_odds).toFixed(2) : "—"}
                    </span>
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
              {legs.length > 0 && (
                <ul className="space-y-2 px-4 py-3 text-sm">
                  {legs.map((leg, i) => (
                    <li key={i} className="flex justify-between gap-2 text-[var(--muted)]">
                      <span>
                        <span className="font-semibold text-[var(--ink)]">
                          {leg.home} vs {leg.away}
                        </span>
                        {leg.pickLabel ? ` — ${leg.pickLabel}` : ""}
                      </span>
                      <span className="font-mono font-bold text-[var(--accent-deep)]">
                        {leg.odds != null ? Number(leg.odds).toFixed(2) : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {r.rationale && (
                <div className="border-t border-[var(--line)] px-4 py-3">
                  <ReadMore text={r.rationale} limit={100} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : "text-[var(--ink)]";
  return (
    <div className="sc-card px-3 py-3 text-center">
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-1 font-display text-xl font-extrabold ${color}`}>{value}</p>
    </div>
  );
}
