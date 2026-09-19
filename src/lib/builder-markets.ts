/** Shared builder market catalogue (safe for client + server). */

export type BuilderCondition =
  | "O05"
  | "O15"
  | "O25"
  | "U25"
  | "HO05"
  | "AO05"
  | "DC1X"
  | "DCX2"
  | "DC12"
  | "DNBH"
  | "DNBA"
  | "BTTSY"
  | "BTTSN"
  | "1"
  | "2"
  | "X"
  | "CORNERS_O85"
  | "CORNERS_O95";

export const BUILDER_MARKETS: {
  id: BuilderCondition;
  label: string;
  group: string;
  codes: string[];
  dynamic?: "corners";
}[] = [
  { id: "O05", label: "Over 0.5 Goals", group: "Goals", codes: ["O05"] },
  { id: "O15", label: "Over 1.5 Goals", group: "Goals", codes: ["O15"] },
  { id: "O25", label: "Over 2.5 Goals", group: "Goals", codes: ["O25"] },
  { id: "U25", label: "Under 2.5 Goals", group: "Goals", codes: ["U25"] },
  { id: "HO05", label: "Home Over 0.5", group: "Team goals", codes: ["HO05"] },
  { id: "AO05", label: "Away Over 0.5", group: "Team goals", codes: ["AO05"] },
  { id: "DC1X", label: "Home or Draw (1X)", group: "Double chance", codes: ["DC1X"] },
  { id: "DCX2", label: "Draw or Away (X2)", group: "Double chance", codes: ["DCX2"] },
  { id: "DC12", label: "Home or Away (12)", group: "Double chance", codes: ["DC12"] },
  { id: "DNBH", label: "Home DNB", group: "Draw no bet", codes: ["DNBH"] },
  { id: "DNBA", label: "Away DNB", group: "Draw no bet", codes: ["DNBA"] },
  { id: "BTTSY", label: "BTTS Yes", group: "BTTS", codes: ["BTTSY"] },
  { id: "BTTSN", label: "BTTS No", group: "BTTS", codes: ["BTTSN"] },
  { id: "1", label: "Home win", group: "1X2", codes: ["1"] },
  { id: "X", label: "Draw", group: "1X2", codes: ["X"] },
  { id: "2", label: "Away win", group: "1X2", codes: ["2"] },
  {
    id: "CORNERS_O85",
    label: "Over 8.5 Corners",
    group: "Corners",
    codes: [],
    dynamic: "corners",
  },
  {
    id: "CORNERS_O95",
    label: "Over 9.5 Corners",
    group: "Corners",
    codes: [],
    dynamic: "corners",
  },
];

export type BuilderSlipView = {
  label: string;
  rationale: string;
  legs: {
    eventId: string;
    home: string;
    away: string;
    pickCode: string;
    pickLabel: string;
    odds: number;
  }[];
  totalOdds: number;
  confidence: number;
  code?: string;
  shareUrl?: string;
  error?: string;
};

export type BuilderResultView = {
  ok: boolean;
  scanned: number;
  matched: number;
  slips: BuilderSlipView[];
  error?: string;
};
