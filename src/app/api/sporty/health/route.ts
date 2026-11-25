import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
/** SportyBet must be reachable from here for crawls to book codes. */
export const preferredRegion = "iad1";

export async function GET() {
  const url =
    "https://www.sportybet.com/api/ng/factsCenter/pcUpcomingEvents?sportId=sr%3Asport%3A1&marketId=1&pageSize=1&option=1&pageNum=1";
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: "https://www.sportybet.com/ng/",
        Origin: "https://www.sportybet.com",
        ClientId: "web",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const text = await r.text();
    return NextResponse.json({
      region: process.env.VERCEL_REGION || "local",
      ok: r.ok,
      status: r.status,
      sample: text.slice(0, 120),
    });
  } catch (e) {
    return NextResponse.json({
      region: process.env.VERCEL_REGION || "local",
      ok: false,
      status: null,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
