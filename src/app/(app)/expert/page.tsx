import { PickBoard } from "@/components/PickBoard";
import { PageHeader } from "@/components/PageHeader";
import { loadExpertPicks } from "@/lib/pools";

export const dynamic = "force-dynamic";

export default async function ExpertPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; n?: string }>;
}) {
  const sp = await searchParams;
  const gameType = (sp.type as "result" | "goals" | "safe" | "btts" | "both") || "result";
  const count = Math.min(30, Math.max(5, Number(sp.n) || 12));
  const { picks, poolSize, source } = await loadExpertPicks({
    count,
    days: 5,
    gameType,
    minConfidence: 0.5,
  });

  return (
    <div>
      <PageHeader
        kicker="Intelligence"
        title="Expert picks"
        subtitle={`Highest-confidence legs · pool ${poolSize}${source === "cache" ? " · cached" : ""}. Select → code or demo.`}
      />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {(
          [
            ["result", "1X2"],
            ["safe", "Safe"],
            ["goals", "Goals"],
            ["btts", "BTTS"],
            ["both", "All"],
          ] as const
        ).map(([id, label]) => (
          <a
            key={id}
            href={`/expert?type=${id}`}
            className={`sc-nav-link ${gameType === id ? "sc-nav-link-active" : ""}`}
          >
            {label}
          </a>
        ))}
      </div>
      {picks.length ? (
        <PickBoard picks={picks} origin="expert" />
      ) : (
        <div className="sc-empty text-sm">
          No expert picks yet. Wait for the next crawl (~20 min) or run{" "}
          <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-xs">npm run crawl</code>.
        </div>
      )}
    </div>
  );
}
