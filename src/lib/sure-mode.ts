/** Client-safe Sure mode helpers (no server imports). */
export type SureMode = "safe" | "boost";

/** Slots 1–3 = safe, 4–6 = boost */
export function slotsForMode(mode: SureMode): number[] {
  return mode === "safe" ? [1, 2, 3] : [4, 5, 6];
}

export function modeForSlot(slot: number): SureMode {
  return slot >= 4 ? "boost" : "safe";
}
