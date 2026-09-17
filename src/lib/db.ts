/**
 * SureCode table names — prefixed for shared Supabase databases.
 */
export const T = {
  profiles: "sc_profiles",
  sureCodes: "sc_sure_codes",
  pastCodes: "sc_past_codes",
  demoWallets: "sc_demo_wallets",
  demoBets: "sc_demo_bets",
  crawlRuns: "sc_crawl_runs",
  pickPools: "sc_pick_pools",
  generatedCodes: "sc_generated_codes",
  codes: "sc_codes",
  preferences: "sc_preferences",
  savedPicks: "sc_saved_picks",
  legHistory: "sc_leg_history",
} as const;
