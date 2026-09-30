import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { modeForSlot } from "@/lib/sure-mode";
import { SureHomeClient, type SureHomeCode } from "@/components/SureHomeClient";
import { Typewriter } from "@/components/Typewriter";
import { HeroSlider, type Slide } from "@/components/HeroSlider";
import { OddsTicker, type TickerItem } from "@/components/OddsTicker";
import { Icon, type IconName } from "@/components/Icons";
import type { SureModeChoice } from "@/components/SureModePicker";

export const dynamic = "force-dynamic";

const PROMOS: Slide[] = [
  {
    id: "safe",
    kicker: "Safe · slots 1–3",
    title: "Short favourites for steady bankroll",
    body: "Tight singles and doubles. Open the code straight in SportyBet.",
    image:
      "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1600&q=80",
    href: "/home?mode=safe#board",
    cta: "Safe codes",
    icon: "shield",
    tone: "green",
  },
  {
    id: "larger",
    kicker: "Larger · slots 4–6",
    title: "Bigger prices, cross-sport",
    body: "EV-ranked packs mixing football, basketball and tennis when the numbers agree.",
    image:
      "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=1600&q=80",
    href: "/home?mode=boost#board",
    cta: "Larger codes",
    icon: "trend",
    tone: "blue",
  },
  {
    id: "longshot",
    kicker: "Longshot · slots 7–9",
    title: "Multi-day stacks, high odds",
    body: "Higher payout, higher variance. Stake small; AI play-out vetoes thin legs.",
    image:
      "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1600&q=80",
    href: "/home?mode=longshot#board",
    cta: "Longshot codes",
    icon: "fire",
    tone: "red",
  },
  {
    id: "demo",
    kicker: "Practice wallet",
    title: "Stake virtually before real money",
    body: "Track demo slips and results without risking a naira.",
    image:
      "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1600&q=80",
    href: "/demo",
    cta: "Open wallet",
    icon: "wallet",
    tone: "gold",
  },
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const initialMode: SureModeChoice =
    mode === "boost" || mode === "longshot" ? mode : "safe";
  const supabase = await createClient();
  const day = lagosDay();

  const { data: codes } = await supabase
    .from(T.sureCodes)
    .select("*")
    .eq("day", day)
    .order("slot", { ascending: true });

  const rows = (codes ?? []) as SureHomeCode[];

  const legs = rows.flatMap((r) => r.legs ?? []);
  const ticker: TickerItem[] = legs.slice(0, 24).map((l) => ({
    match: `${l.home} v ${l.away}`,
    pick: l.pickLabel,
    odds: l.odds,
    sport: l.sport ?? "football",
  }));

  const safeOdds = rows
    .filter((r) => modeForSlot(r.slot) === "safe" && r.total_odds)
    .map((r) => Number(r.total_odds));
  const topOdds = rows.reduce((m, r) => Math.max(m, Number(r.total_odds ?? 0)), 0);
  const avgSafe = safeOdds.length ? safeOdds.reduce((a, b) => a + b, 0) / safeOdds.length : 0;

  const stats: { icon: IconName; label: string; value: string }[] = [
    { icon: "target", label: "Codes today", value: String(rows.length) },
    { icon: "layers", label: "Legs on board", value: String(legs.length) },
    { icon: "shield", label: "Avg safe odds", value: avgSafe ? avgSafe.toFixed(2) : "—" },
    { icon: "fire", label: "Top price", value: topOdds ? `${topOdds.toFixed(2)}×` : "—" },
  ];

  return (
    <div className="dh">
      <header className="dh-hero sc-rise">
        <div className="dh-hero-copy">
          <p className="sc-page-kicker">
            <Icon name="spark" size={13} className="dh-kicker-ic" /> Max-hit · all sports · {day}
          </p>
          <h2 className="dh-title">
            Sure codes{" "}
            <span className="dh-title-grad">
              <Typewriter
                phrases={["for today.", "across 5 sports.", "with AI play-out.", "in 3 lanes."]}
              />
            </span>
          </h2>
        </div>
        <ul className="dh-stats" aria-label="Today at a glance">
          {stats.map((s, i) => (
            <li key={s.label} className="dh-stat" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="dh-stat-ic">
                <Icon name={s.icon} size={18} className="dh-stat-svg" />
              </span>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </header>

      <OddsTicker items={ticker} label={ticker.length ? "Today’s legs" : "Board loading"} />

      <HeroSlider slides={PROMOS} variant="promo" intervalMs={5500} />

      <div id="board">
        <SureHomeClient
          key={initialMode}
          day={day}
          codes={rows}
          initialMode={initialMode}
          fromUrl={Boolean(mode)}
        />
      </div>
    </div>
  );
}
