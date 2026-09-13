import { PickBoard } from "@/components/PickBoard";
import { PageHeader } from "@/components/PageHeader";
import { loadPredictions } from "@/lib/pools";

export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const { picks } = await loadPredictions();

  return (
    <div>
      <PageHeader
        kicker="AI tips"
        title="Predictions"
        subtitle="Tip-style 1X2 favourites from published odds. Tick matches and book a SportyBet code."
      />
      {picks.length ? (
        <PickBoard picks={picks} origin="predictions" />
      ) : (
        <div className="sc-empty text-sm">
          Predictions refresh with the crawler. Run a crawl if this stays empty.
        </div>
      )}
    </div>
  );
}
