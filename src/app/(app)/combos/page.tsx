import { ComboBookButton } from "@/components/ComboBookButton";
import { PageHeader } from "@/components/PageHeader";
import { loadCombos } from "@/lib/pools";

export const dynamic = "force-dynamic";

export default async function CombosPage() {
  const { combos } = await loadCombos();

  return (
    <div>
      <PageHeader
        kicker="Stacks"
        title="Value combos"
        subtitle="Ready-made accumulators. One tap books a SportyBet share code."
      />
      <div className="space-y-4">
        {combos.map((c) => (
          <article key={c.id} className="sc-card overflow-hidden p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] bg-gradient-to-r from-pitch/10 to-transparent px-5 py-4">
              <div>
                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.18em] text-pitch">
                  {c.tag}
                </p>
                <h2 className="mt-1 font-display text-xl font-extrabold text-ink">{c.name}</h2>
                <p className="mt-1 text-sm text-ink/55">
                  Odds {c.totalOdds.toFixed(2)} · ~{Math.round(c.confidence * 100)}%
                </p>
              </div>
              <ComboBookButton picks={c.picks} origin={`combo-${c.id}`} />
            </div>
            <ul className="space-y-2.5 px-5 py-4 text-sm">
              {c.picks.map((p) => (
                <li key={p.key + p.pickCode} className="flex justify-between gap-2">
                  <span className="text-ink/80">
                    <span className="font-semibold text-ink">
                      {p.home} vs {p.away}
                    </span>
                    <span className="text-ink/45"> — {p.pick}</span>
                  </span>
                  <span className="font-mono font-bold text-pitch-deep">{p.odds}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
        {!combos.length && (
          <div className="sc-empty text-sm text-ink/55">No combos available yet — wait for crawl.</div>
        )}
      </div>
    </div>
  );
}
