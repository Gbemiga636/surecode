export const SOURCE_PAGES: Record<string, string> = {
  home: "Sure codes",
  codes: "Plenty codes",
  past: "Past codes",
  saved: "Saved codes",
  builder: "Build combos",
  edit: "Edit long codes",
  picks: "Picks",
  predictions: "Predictions",
  value: "Value bets",
  combos: "Combos",
  expert: "Expert",
  analysis: "Analysis",
  demo: "Demo",
  manual: "Pasted by you",
};

const LEGACY_SOURCE: Record<string, string> = { sure: "home", generated: "saved" };

/** Page key a liked row came from, mapping values saved before page tracking existed. */
export function sourcePage(source: string | null | undefined): string {
  const s = String(source ?? "manual").toLowerCase();
  const key = LEGACY_SOURCE[s] ?? s;
  return key in SOURCE_PAGES ? key : "manual";
}

export function sourceLabel(source: string | null | undefined): string {
  return SOURCE_PAGES[sourcePage(source)];
}
