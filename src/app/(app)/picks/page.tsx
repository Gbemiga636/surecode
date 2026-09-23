import { PickBoard } from "@/components/PickBoard";
import { PageHeader } from "@/components/PageHeader";
import { ComboBookButton } from "@/components/ComboBookButton";
import { loadAnalysis, loadCombos, loadExpertPicks, loadValuePicks } from "@/lib/pools";
import type { AppPick } from "@/lib/picks";

export const dynamic = "force-dynamic";

type Tab = "overall" | "safe" | "goals" | "btts" | "value" | "combos" | "analysis";

function mergeOverall(expert: AppPick[], value: AppPick[], count: number): AppPick[] {
  const tagged = [
    ...expert.map((p) => ({
      ...p,
      reasons: [`Expert · ${(p.confidence * 100).toFixed(0)}%`, ...(p.reasons ?? [])],
    })),
    ...value.map((p) => ({
      ...p,
      reasons: [
        `Value${p.edge != null ? ` · edge ${(p.edge * 100).toFixed(1)}%` : ""}`,
        ...(p.reasons ?? []),
      ],
    })),
  ];
  tagged.sort((a, b) => b.confidence - a.confidence);
  const seen = new Set<string>();
  const out: AppPick[] = [];
  for (const p of tagged) {
    if (seen.has(p.eventId || p.key)) continue;
    seen.add(p.eventId || p.key);
    out.push(p);
    if (out.length >= count) break;
  }
  out.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  return out;
}

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const tab = ((sp.tab as Tab) || "overall") as Tab;
  const count = Math.min(36, Math.max(8, Number(sp.n) || 18));

  const [safe, goals, btts, both, valuePack, combosPack, analysisPack] = await Promise.all([
    loadExpertPicks({ count: 16, days: 5, gameType: "safe", minConfidence: 0.52 }),
    loadExpertPicks({ count: 14, days: 5, gameType: "goals", minConfidence: 0.5 }),
    loadExpertPicks({ count: 14, days: 5, gameType: "btts", minConfidence: 0.5 }),
    loadExpertPicks({ count: 20, days: 5, gameType: "both", minConfidence: 0.5 }),
    loadValuePicks(),
    loadCombos(),
    loadAnalysis(),
  ]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overall", label: "Overall" },
    { id: "safe", label: "Safe" },
    { id: "goals", label: "Goals" },
    { id: "value", label: "Value" },
    { id: "combos", label: "Combos" },
    { id: "analysis", label: "AI analysis" },
  ];

  let subtitle = "";
  let picks: AppPick[] = [];

  if (tab === "combos") {
    subtitle = `Ready-made accumulators · ${combosPack.source}`;
  } else if (tab === "analysis") {
    const board = analysisPack.board;
    picks = board.flatMap((m) => {
      const rows = [
        {
          key: m.key + "|1",
          home: m.home,
          away: m.away,
          pick: `${m.home} win`,
          odds: m.odds.home.toFixed(2),
          confidence: m.probs.home,
          eventId: m.eventId,
          pickCode: "1",
          league: m.league,
          kickoff: m.kickoff,
          market: "1X2",
          reasons: [
            `De-vig home ${Math.round(m.probs.home * 100)}%`,
            m.ou25Hint,
            m.bttsHint,
          ],
        },
        {
          key: m.key + "|X",
          home: m.home,
          away: m.away,
          pick: "Draw",
          odds: m.odds.draw.toFixed(2),
          confidence: m.probs.draw,
          eventId: m.eventId,
          pickCode: "X",
          league: m.league,
          kickoff: m.kickoff,
          market: "1X2",
          reasons: [`De-vig draw ${Math.round(m.probs.draw * 100)}%`],
        },
        {
          key: m.key + "|2",
          home: m.home,
          away: m.away,
          pick: `${m.away} win`,
          odds: m.odds.away.toFixed(2),
          confidence: m.probs.away,
          eventId: m.eventId,
          pickCode: "2",
          league: m.league,
          kickoff: m.kickoff,
          market: "1X2",
          reasons: [`De-vig away ${Math.round(m.probs.away * 100)}%`],
        },
      ];
      const top = [...rows].sort((a, b) => b.confidence - a.confidence)[0];
      return [
        {
          ...top,
          reasons: [
            `AI favourite · model ${Math.round(top.confidence * 100)}%`,
            ...top.reasons,
            `H ${Math.round(m.probs.home * 100)}% / D ${Math.round(m.probs.draw * 100)}% / A ${Math.round(m.probs.away * 100)}%`,
          ],
        },
      ];
    });
    subtitle = `De-vigged 1X2 + Over 2.5 / BTTS context · ${analysisPack.source}`;
  } else if (tab === "value") {
    picks = valuePack.picks.slice(0, count);
    subtitle = `Value edges · ${valuePack.source}`;
  } else if (tab === "safe") {
    picks = safe.picks.slice(0, count);
    subtitle = `Safe markets · ${safe.source}`;
  } else if (tab === "goals") {
    picks = goals.picks.slice(0, count);
    subtitle = `Goals markets · ${goals.source}`;
  } else if (tab === "btts") {
    picks = btts.picks.slice(0, count);
    subtitle = `BTTS · ${btts.source}`;
  } else {
    picks = mergeOverall(both.picks, valuePack.picks, count);
    subtitle = `Overall board — expert + value + AI context in one place`;
  }

  return (
    <div>
      <PageHeader
        kicker="Intelligence hub"
        title="Picks & analysis"
        subtitle={subtitle}
      />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`/picks?tab=${t.id}`}
            className={`sc-nav-link ${tab === t.id ? "sc-nav-link-active" : ""}`}
          >
            {t.label}
          </a>
        ))}
      </div>

      {tab === "combos" ? (
        <div className="space-y-4">
          {combosPack.combos.map((c) => (
            <article key={c.id} className="sc-card overflow-hidden p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] bg-gradient-to-r from-[rgba(13,159,110,0.08)] to-transparent px-5 py-4">
                <div>
                  <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.18em] text-[var(--accent)]">
                    {c.tag}
                  </p>
                  <h2 className="mt-1 font-display text-xl font-extrabold text-[var(--ink)]">
                    {c.name}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Odds {c.totalOdds.toFixed(2)} · ~{Math.round(c.confidence * 100)}%
                  </p>
                </div>
                <ComboBookButton picks={c.picks} origin={`combo-${c.id}`} />
              </div>
              <ul className="space-y-2.5 px-5 py-4 text-sm">
                {c.picks.map((p) => (
                  <li key={p.key + p.pickCode} className="flex justify-between gap-2">
                    <span className="text-[var(--ink)]/80">
                      <span className="font-semibold text-[var(--ink)]">
                        {p.home} vs {p.away}
                      </span>
                      <span className="text-[var(--muted)]"> — {p.pick}</span>
                    </span>
                    <span className="font-mono font-bold text-[var(--accent-deep)]">{p.odds}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {!combosPack.combos.length && (
            <div className="sc-empty text-sm">No combos yet — wait for crawl.</div>
          )}
        </div>
      ) : picks.length ? (
        <PickBoard picks={picks} origin={`picks-${tab}`} />
      ) : (
        <div className="sc-empty text-sm">
          Nothing here yet. Wait for the next crawl or open{" "}
          <a href="/builder" className="underline">
            Build combos
          </a>
          .
        </div>
      )}
    </div>
  );
}
