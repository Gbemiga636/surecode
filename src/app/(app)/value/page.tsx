import { PickBoard } from "@/components/PickBoard";
import { PageHeader } from "@/components/PageHeader";
import { loadValuePicks } from "@/lib/pools";

export const dynamic = "force-dynamic";

export default async function ValuePage() {
  const { picks, scanned } = await loadValuePicks();

  return (
    <div>
      <PageHeader
        kicker="Edge"
        title="Value picks"
        subtitle={`Bigger-price opportunities across ${scanned} fixtures. Edge estimates — not guarantees.`}
      />
      {picks.length ? (
        <PickBoard picks={picks} origin="value" />
      ) : (
        <div className="sc-empty text-sm">No value picks cached yet. Wait for the next crawl.</div>
      )}
    </div>
  );
}
