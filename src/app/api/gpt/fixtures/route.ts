import { NextResponse } from "next/server";
import { getAllSportyFixtures, type SbEvent, type SportKey } from "@/lib/sporty";
import { gptAuthorized, gptUnauthorized } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SPORTS: SportKey[] = ["football", "basketball", "tennis", "hockey", "baseball"];
const r4 = (v: number) => Number(v.toFixed(4));

/** Normalise implied probabilities so they sum to 1 (proportional de-vig). */
function deVig(odds: Record<string, number | undefined>) {
  const entries = Object.entries(odds).filter(
    (e): e is [string, number] => typeof e[1] === "number" && e[1] > 1,
  );
  if (entries.length < 2) return null;
  const implied = entries.map(([k, o]) => [k, 1 / o] as const);
  const book = implied.reduce((a, [, p]) => a + p, 0);
  return {
    overround: r4(book - 1),
    probabilities: Object.fromEntries(implied.map(([k, p]) => [k, r4(p / book)])),
  };
}

function mainMarket(ev: SbEvent) {
  const o = ev.outcomes;
  if (o.BBH && o.BBA) return { market: "moneyline", ...deVig({ home: o.BBH, away: o.BBA }) };
  if (o.TNH && o.TNA) return { market: "match winner", ...deVig({ home: o.TNH, away: o.TNA }) };
  if (o["1"] && o["2"] && o.X)
    return { market: "1X2", ...deVig({ home: o["1"], draw: o.X, away: o["2"] }) };
  if (o["1"] && o["2"]) return { market: "moneyline", ...deVig({ home: o["1"], away: o["2"] }) };
  return null;
}

export async function GET(request: Request) {
  if (!gptAuthorized(request)) return gptUnauthorized(request);

  const url = new URL(request.url);
  const sportParam = (url.searchParams.get("sport") || "all").toLowerCase();
  const hours = Math.min(120, Math.max(1, Number(url.searchParams.get("hours")) || 24));
  const limit = Math.min(150, Math.max(1, Number(url.searchParams.get("limit")) || 40));
  const league = (url.searchParams.get("league") || "").toLowerCase();

  const sports =
    sportParam === "all"
      ? SPORTS
      : SPORTS.includes(sportParam as SportKey)
        ? [sportParam as SportKey]
        : null;
  if (!sports) {
    return NextResponse.json(
      { ok: false, error: `sport must be all | ${SPORTS.join(" | ")}` },
      { status: 400 },
    );
  }

  try {
    const now = Date.now();
    const events = (await getAllSportyFixtures({ maxPagesPerSport: 2, sports }))
      .filter((e) => e.kickoff > now && e.kickoff < now + hours * 3_600_000)
      .filter((e) => !league || (e.league || "").toLowerCase().includes(league))
      .sort((a, b) => a.kickoff - b.kickoff)
      .slice(0, limit);

    return NextResponse.json(
      {
        ok: true,
        source: "SportyBet Nigeria (live pre-match odds)",
        fetchedAt: new Date().toISOString(),
        note: "De-vigged probabilities are market estimates, not model forecasts. No injury/lineup data included.",
        count: events.length,
        fixtures: events.map((e) => ({
          eventId: e.eventId,
          sport: e.sport ?? "football",
          league: e.league ?? null,
          home: e.home,
          away: e.away,
          kickoffUtc: new Date(e.kickoff).toISOString(),
          kickoffLagos: new Date(e.kickoff).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
          odds: e.outcomes,
          main: mainMarket(e),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
