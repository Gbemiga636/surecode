import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { sportyOpenUrl } from "@/lib/sporty";
import { PageHeader } from "@/components/PageHeader";
import { CodeActions } from "@/components/CodeActions";
import { SoccerBall, GoalPosts } from "@/components/PitchArt";
import { ReadMore } from "@/components/ReadMore";

type SureCodeRow = {
  id: string;
  slot: number;
  code: string;
  share_url: string | null;
  total_odds: number | null;
  confidence: number | null;
  legs: {
    home: string;
    away: string;
    pickLabel: string;
    odds: number;
    kickoff?: number;
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

export default async function HomePage() {
  const supabase = await createClient();
  const day = lagosDay();
  const { data: codes } = await supabase
    .from(T.sureCodes)
    .select("*")
    .eq("day", day)
    .order("slot", { ascending: true });

  const rows = (codes ?? []) as SureCodeRow[];
  const latest = rows[0];

  return (
    <div>
      <PageHeader
        kicker="Today"
        title="Sure codes"
        subtitle={`${day} · High-hit mode: mostly singles / rare 2-folds after full 1X2 + history analysis.`}
      />

      {latest && (
        <div className="hero-panel sc-rise mb-6">
          <span className="hero-aurora" aria-hidden />
          <span className="hero-ring" aria-hidden />
          <span className="spark" style={{ right: 70, top: "22%" }} aria-hidden />
          <span
            className="spark"
            style={{ right: 200, top: "68%", width: 4, height: 4, animationDelay: "1.8s" }}
            aria-hidden
          />
          <div className="absolute right-6 top-1/2 z-[1] -translate-y-1/2 max-[860px]:right-3 max-[860px]:top-4 max-[860px]:translate-y-0">
            <SoccerBall />
          </div>
          <GoalPosts />
          <div className="relative z-[2] p-6 pr-[160px] max-[860px]:pr-6 sm:p-8 sm:pr-[160px]">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Latest sure code · slip {latest.slot} · high-hit
            </p>
            <p className="mt-3 font-mono text-3xl font-extrabold tracking-[0.12em] text-[var(--ink)] sm:text-4xl">
              {latest.code}
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {(latest.legs ?? []).length} games · odds{" "}
              <span className="font-semibold text-[var(--ink)]">
                {latest.total_odds != null ? Number(latest.total_odds).toFixed(2) : "—"}
              </span>
              {latest.confidence != null
                ? ` · ~${Math.round(Number(latest.confidence) * 100)}% model`
                : ""}
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
          <p className="font-display text-lg font-bold text-[var(--ink)]">Codes are warming up</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
            The crawler publishes every ~20 minutes. Run{" "}
            <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-xs text-[var(--ink)]">npm run crawl</code> once
            if this is empty.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {rows.map((c) => {
          const openUrl = c.share_url || sportyOpenUrl(c.code);
          const conf = c.confidence != null ? Math.round(Number(c.confidence) * 100) : null;
          return (
            <article key={c.id} className="sc-card sc-rise overflow-hidden p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
                <div>
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                    Slip {c.slot}
                    {conf != null ? ` · ${conf}% model` : ""}
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-wider text-[var(--ink)]">
                    {c.code}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Odds{" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {c.total_odds != null ? Number(c.total_odds).toFixed(2) : "—"}
                    </span>
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
                          {leg.home} <span className="font-normal text-[var(--muted)]">vs</span>{" "}
                          {leg.away}
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
                <div className="mx-5 mb-5 rounded-2xl bg-[rgba(13,159,110,0.06)] px-4 py-3 sm:mx-6">
                  <ReadMore text={c.rationale} limit={110} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
