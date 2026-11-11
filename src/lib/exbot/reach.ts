/**
 * Can this server reach each exchange's API? Exchanges geo-block by the
 * server's IP (Bybit: CloudFront 403, Binance: 451), which is a different
 * problem from a member's own internet provider blocking the exchange website.
 */
const ENDPOINTS = {
  bybit: "https://api.bybit.com/v5/market/time",
  bybitTestnet: "https://api-testnet.bybit.com/v5/market/time",
  binance: "https://fapi.binance.com/fapi/v1/time",
  binanceTestnet: "https://testnet.binancefuture.com/fapi/v1/time",
  alpaca: "https://api.alpaca.markets/v2/clock",
  alpacaPaper: "https://paper-api.alpaca.markets/v2/clock",
} as const;

export type Reach = { ok: boolean; status: number | null; note: string };

async function probe(url: string): Promise<Reach> {
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    const body = (await r.text()).slice(0, 400);
    if (r.ok) return { ok: true, status: r.status, note: "reachable" };
    // Alpaca answers 401/403 JSON without a key: the API is reachable from here.
    if (url.includes("alpaca.markets") && (r.status === 401 || r.status === 403) && body.trim().startsWith("{")) {
      return { ok: true, status: r.status, note: "reachable (needs a key)" };
    }
    const geo = r.status === 451 || /block access from your country|restricted location/i.test(body);
    return { ok: false, status: r.status, note: geo ? "blocked from this server's country" : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: null, note: e instanceof Error ? e.message.slice(0, 120) : "network error" };
  }
}

export async function reachability(): Promise<{ region: string; checks: Record<keyof typeof ENDPOINTS, Reach> }> {
  const names = Object.keys(ENDPOINTS) as (keyof typeof ENDPOINTS)[];
  const results = await Promise.all(names.map((n) => probe(ENDPOINTS[n])));
  return {
    region: process.env.VERCEL_REGION || "local",
    checks: Object.fromEntries(names.map((n, i) => [n, results[i]])) as Record<keyof typeof ENDPOINTS, Reach>,
  };
}

export const serverRegion = () => process.env.VERCEL_REGION || "local";
