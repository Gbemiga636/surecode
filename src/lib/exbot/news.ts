/**
 * News guard, ported from exbot/news.py: a risk filter, never a signal.
 * High-impact USD events block new entries for ±30 minutes; a fresh headline
 * naming the coin with a danger word blocks that coin for an hour.
 * Feeds that can't be reached never block.
 */
import { NEWS_BLACKOUT_MIN } from "./config";

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const RSS_FEEDS = ["https://www.coindesk.com/arc/outboundfeeds/rss/", "https://cointelegraph.com/rss"];
const DANGER = ["hack", "exploit", "drained", "delist", "halt", "suspend", "sec sues", "lawsuit", "ban", "insolv", "depeg", "outage", "liquidation cascade"];
const NAMES: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"], ETH: ["ethereum", "ether", "eth"], SOL: ["solana", "sol"], BNB: ["bnb", "binance coin"],
  XRP: ["xrp", "ripple"], ADA: ["cardano", "ada"], DOGE: ["dogecoin", "doge"], LINK: ["chainlink", "link"],
};

type Item = { at: number; title: string };

async function getText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "exbot/0.1" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

export class NewsGuard {
  events: Item[] = [];
  headlines: Item[] = [];
  errors: string[] = [];

  async refresh(): Promise<void> {
    const jobs = [
      getText(CALENDAR_URL).then((t) => {
        this.events = (JSON.parse(t) as { date: string; title?: string; impact?: string; country?: string }[])
          .filter((e) => e.impact === "High" && e.country === "USD")
          .map((e) => ({ at: Date.parse(e.date), title: e.title || "" }));
      }),
      ...RSS_FEEDS.map((u) =>
        getText(u).then((xml) => {
          for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/g)) {
            const title = (m[0].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "").trim();
            const pub = m[0].match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
            if (title && pub && Number.isFinite(Date.parse(pub))) this.headlines.push({ at: Date.parse(pub), title });
          }
        }),
      ),
    ];
    for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") this.errors.push(String(r.reason));
  }

  blocked(symbol: string, now = new Date()): string | null {
    const t = now.getTime();
    const win = NEWS_BLACKOUT_MIN * 60_000;
    for (const e of this.events) {
      if (e.at - win <= t && t <= e.at + win) return `macro event: ${e.title} at ${new Date(e.at).toISOString().slice(11, 16)} UTC`;
    }
    const base = symbol.split("/")[0].toUpperCase();
    const names = NAMES[base] || [base.toLowerCase()];
    for (const h of this.headlines) {
      if (t - h.at > 60 * 60_000 || h.at > t + 5 * 60_000) continue;
      const low = h.title.toLowerCase();
      const words = new Set(low.replace(/[,:]/g, " ").split(/\s+/));
      if (names.some((n) => words.has(n) || (n.length > 4 && low.includes(n))) && DANGER.some((d) => low.includes(d))) {
        return `headline: ${h.title}`;
      }
    }
    return null;
  }
}
