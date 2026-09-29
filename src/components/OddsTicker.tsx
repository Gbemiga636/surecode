import { Icon, type IconName } from "@/components/Icons";

export type TickerItem = {
  match: string;
  pick: string;
  odds: number;
  sport?: string;
};

const SPORT_ICON: Record<string, IconName> = {
  football: "football",
  soccer: "football",
  basketball: "basketball",
  tennis: "tennis",
  hockey: "hockey",
  icehockey: "hockey",
  "ice hockey": "hockey",
  baseball: "baseball",
};

export function sportIcon(sport?: string): IconName {
  return SPORT_ICON[(sport ?? "football").toLowerCase()] ?? "football";
}

export const FALLBACK_TICKER: TickerItem[] = [
  { match: "Safe lane", pick: "Short favourites", odds: 1.22, sport: "football" },
  { match: "Larger lane", pick: "Favourite-backed doubles", odds: 1.96, sport: "basketball" },
  { match: "Longshot lane", pick: "Multi-day cross-sport", odds: 6.4, sport: "tennis" },
  { match: "AI play-out", pick: "Vetoes thin legs", odds: 1.0, sport: "hockey" },
  { match: "5 sports", pick: "One board", odds: 1.0, sport: "baseball" },
];

export function OddsTicker({ items, label = "Live board" }: { items: TickerItem[]; label?: string }) {
  const list = items.length > 0 ? items : FALLBACK_TICKER;
  const loop = [...list, ...list];

  return (
    <div className="tk" role="marquee" aria-label={label}>
      <span className="tk-badge">
        <span className="live-dot" />
        {label}
      </span>
      <div className="tk-viewport">
        <ul className="tk-track" style={{ animationDuration: `${Math.max(24, list.length * 6)}s` }}>
          {loop.map((it, i) => (
            <li key={i} className="tk-item" aria-hidden={i >= list.length}>
              <Icon name={sportIcon(it.sport)} size={15} className="tk-ic" />
              <span className="tk-match">{it.match}</span>
              <span className="tk-pick">{it.pick}</span>
              {it.odds > 1 && <strong className="tk-odds">{it.odds.toFixed(2)}</strong>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
