import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { sportyOpenUrl } from "@/lib/sporty";
import { PageHeader } from "@/components/PageHeader";
import { CodeActions } from "@/components/CodeActions";
import { ReadMore } from "@/components/ReadMore";
import { GoalBurst, SportChip, TrackStrip } from "@/components/SureArena";

export const dynamic = "force-dynamic";

type SureCodeRow = {
  id: string;
  slot: number;
  code: string;
  share_url: string | null;
  total_odds: number | null;
  confidence: number | null;
  outcome?: string | null;
  legs: {
    home: string;
    away: string;
    pickLabel: string;
    odds: number;
    kickoff?: number;
    sport?: string;
    sportLabel?: string;
  }[];
  rationale: string | null;
};

function formatKick(ms?: number) {
  if (!ms) return null;
  try {
    return new Date(ms).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function isWon(o?: string | null) {
  const u = String(o || "").toUpperCase();
  return u === "WON" || u === "WIN";
}
function isLost(o?: string | null) {
  const u = String(o || "").toUpperCase();
  return u === "LOST" || u === "LOSS";
}

export default async function HomePage() {
  const supabase = await createClient();
  const day = lagosDay();
  const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);

  const [{ data: codes }, { data: history }] = await Promise.all([
    supabase.from(T.sureCodes).select("*").eq("day", day).order("slot", { ascending: true }),
    supabase
      .from(T.sureCodes)
      .select("outcome,total_odds")
      .gte("day", since)
      .in("outcome", ["WON", "LOST", "WIN", "LOSS", "PENDING"]),
  ]);

  const rows = (codes ?? []) as SureCodeRow[];
  const hist = history ?? [];
  const won = hist.filter((r) => isWon(r.outcome)).length;
  const lost = hist.filter((r) => isLost(r.outcome)).length;
  const pending = hist.filter((r) => String(r.outcome).toUpperCase() === "PENDING").length;
  const settled = won + lost;
  const winRate = settled ? Math.round((won / settled) * 1000) / 10 : null;
  const latest = rows[0];

  return (
    <div className="sure-home">
      <PageHeader
        kicker="Max-hit · all sports"
        title="Sure codes"
        subtitle={`${day} · Singles only across football, basketball, tennis & more — full AI analysis on every slip.`}
      />

      <TrackStrip won={won} lost={lost} pending={pending} winRate={winRate} />

      {latest && (
        <div className="hero-panel hero-sport sc-rise mb-6">
          <span className="hero-aurora" aria-hidden />
          <span className="hero-ring" aria-hidden />
          <div className="hero-arena">
            <GoalBurst />
          </div>
          <div className="relative z-[2] p-6 pr-[200px] max-[900px]:pr-6 sm:p-8 sm:pr-[220px]">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Top sure single · slip {latest.slot}
              {latest.confidence != null
                ? ` · ~${Math.round(Number(latest.confidence) * 100)}% model`
                : ""}
            </p>
            <p className="mt-3 font-mono text-3xl font-extrabold tracking-[0.14em] text-[var(--ink)] sm:text-5xl">
              {latest.code}
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {(latest.legs ?? [])[0]?.sportLabel || (latest.legs ?? [])[0]?.sport || "Multi-sport"}{" "}
              · odds{" "}
              <span className="font-semibold text-[var(--ink)]">
                {latest.total_odds != null ? Number(latest.total_odds).toFixed(2) : "—"}
              </span>
            </p>
            <div className="mt-5">
              <CodeActions
                code={latest.code}
                openUrl={latest.share_url || sportyOpenUrl(latest.code)}
                sureCodeId={latest.id}
              />
            </div>
          </div>
        </div>
      )}

      {!rows.length && (
        <div className="sc-empty sc-rise">
          <p className="font-display text-lg font-bold text-[var(--ink)]">Arena warming up</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
            Scanning all SportyBet sports for the surest singles. Run a crawl if this stays empty.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {rows.map((c, idx) => {
          const openUrl = c.share_url || sportyOpenUrl(c.code);
          const conf = c.confidence != null ? Math.round(Number(c.confidence) * 100) : null;
          const leg0 = (c.legs ?? [])[0];
          return (
            <article
              key={c.id}
              className="sc-card sure-slip sc-rise overflow-hidden p-0"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                      Slip {c.slot}
                      {conf != null ? ` · ${conf}%` : ""}
                    </p>
                    <SportChip sport={leg0?.sportLabel || leg0?.sport} />
                  </div>
                  <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-wider text-[var(--ink)]">
                    {c.code}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Odds{" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {c.total_odds != null ? Number(c.total_odds).toFixed(2) : "—"}
                    </span>
                    {" · "}single
                  </p>
                </div>
                <CodeActions code={c.code} openUrl={openUrl} sureCodeId={c.id} />
              </div>
              <ul className="space-y-3 px-5 py-4 sm:px-6">
                {(c.legs ?? []).map((leg, i) => {
                  const kick = formatKick(leg.kickoff);
                  return (
                    <li
                      key={i}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-[var(--ink)]">
                          {leg.home}{" "}
                          <span className="font-normal text-[var(--muted)]">vs</span> {leg.away}
                        </p>
                        <p className="mt-0.5 text-[var(--muted)]">
                          {leg.pickLabel}
                          {kick ? ` · ${kick}` : ""}
                        </p>
                      </div>
                      <span className="font-mono text-base font-bold text-[var(--accent-deep)]">
                        {Number(leg.odds).toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {c.rationale && (
                <div className="analysis-panel mx-5 mb-5 sm:mx-6">
                  <p className="analysis-kicker">Full AI analysis</p>
                  <ReadMore text={c.rationale} limit={160} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
