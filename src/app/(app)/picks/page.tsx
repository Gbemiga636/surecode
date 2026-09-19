import { PickBoard } from "@/components/PickBoard";
import { PageHeader } from "@/components/PageHeader";
import { loadExpertPicks, loadValuePicks } from "@/lib/pools";
import type { AppPick } from "@/lib/picks";

export const dynamic = "force-dynamic";

type Tab = "overall" | "safe" | "goals" | "btts" | "value";

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

  // Prefer higher confidence; keep one pick per fixture
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

export default async function OverallPicksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const tab = ((sp.tab as Tab) || "overall") as Tab;
  const count = Math.min(36, Math.max(8, Number(sp.n) || 18));

  const [safe, goals, btts, both, valuePack] = await Promise.all([
    loadExpertPicks({ count: 16, days: 5, gameType: "safe", minConfidence: 0.52 }),
    loadExpertPicks({ count: 14, days: 5, gameType: "goals", minConfidence: 0.5 }),
    loadExpertPicks({ count: 14, days: 5, gameType: "btts", minConfidence: 0.5 }),
    loadExpertPicks({ count: 20, days: 5, gameType: "both", minConfidence: 0.5 }),
    loadValuePicks(),
  ]);

  let picks: AppPick[] = [];
  let subtitle = "";

  if (tab === "value") {
    picks = valuePack.picks.slice(0, count);
    subtitle = `Value edges across ${valuePack.scanned || valuePack.picks.length} fixtures · ${valuePack.source}`;
  } else if (tab === "safe") {
    picks = safe.picks.slice(0, count);
    subtitle = `Safe markets · pool ${safe.poolSize} · ${safe.source}`;
  } else if (tab === "goals") {
    picks = goals.picks.slice(0, count);
    subtitle = `Goals markets · pool ${goals.poolSize} · ${goals.source}`;
  } else if (tab === "btts") {
    picks = btts.picks.slice(0, count);
    subtitle = `BTTS · pool ${btts.poolSize} · ${btts.source}`;
  } else {
    picks = mergeOverall(both.picks, valuePack.picks, count);
    subtitle = `Expert + value merged · ${picks.length} best legs · estimates, never guarantees`;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overall", label: "Overall" },
    { id: "safe", label: "Safe" },
    { id: "goals", label: "Goals" },
    { id: "btts", label: "BTTS" },
    { id: "value", label: "Value" },
  ];

  return (
    <div>
      <PageHeader
        kicker="Intelligence"
        title="Overall picks"
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
      {picks.length ? (
        <PickBoard picks={picks} origin={`picks-${tab}`} />
      ) : (
        <div className="sc-empty text-sm">
          No picks yet. Wait for the next crawl or open{" "}
          <a href="/builder" className="underline">
            Build combos
          </a>{" "}
          to generate from your own markets.
        </div>
      )}
    </div>
  );
}
