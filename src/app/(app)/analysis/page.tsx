import { PickBoard } from "@/components/PickBoard";
import { PageHeader } from "@/components/PageHeader";
import { loadAnalysis } from "@/lib/pools";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const { board } = await loadAnalysis();

  const picks = board.flatMap((m) => {
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
        reasons: [`Model ${Math.round(m.probs.home * 100)}% · ${m.ou25Hint} · ${m.bttsHint}`],
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
        reasons: [`Model ${Math.round(m.probs.draw * 100)}%`],
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
        reasons: [`Model ${Math.round(m.probs.away * 100)}%`],
      },
    ];
    return [rows.sort((a, b) => b.confidence - a.confidence)[0]];
  });

  return (
    <div>
      <PageHeader
        kicker="Model"
        title="AI analysis"
        subtitle="De-vigged 1X2 probabilities with Over 2.5 / BTTS context. Favourites only — keep it sharp."
      />
      {picks.length ? (
        <PickBoard picks={picks} origin="analysis" />
      ) : (
        <div className="sc-empty text-sm">Analysis board fills after the crawler runs.</div>
      )}
    </div>
  );
}
