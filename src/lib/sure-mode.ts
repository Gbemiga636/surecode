/** Client-safe Sure mode helpers (no server imports). */
export type SureMode = "safe" | "boost" | "longshot";

/**
 * Slots:
 *  1–3  Safe (max hit)
 *  4–6  Larger / boost
 *  7–9  Longshot (multi-day, higher odds, cross-sport)
 */
export function slotsForMode(mode: SureMode): number[] {
  if (mode === "safe") return [1, 2, 3];
  if (mode === "boost") return [4, 5, 6];
  return [7, 8, 9];
}

export function modeForSlot(slot: number): SureMode {
  if (slot >= 7) return "longshot";
  if (slot >= 4) return "boost";
  return "safe";
}

export function modeLabel(mode: SureMode): string {
  if (mode === "safe") return "Safe";
  if (mode === "boost") return "Larger";
  return "Longshot";
}
