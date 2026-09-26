import { buildSureSlipsOfDay } from "../src/lib/sure-engine";

async function main() {
  const slips = await buildSureSlipsOfDay(3, [], {
    allowAi: Boolean(process.env.OPENAI_API_KEY),
    modes: ["safe", "boost", "longshot"],
  });
  console.log(
    JSON.stringify(
      slips.map((s) => ({
        slot: s.slot,
        mode: s.mode,
        odds: s.totalOdds.toFixed(2),
        conf: `${Math.round(s.confidence * 100)}%`,
        legs: s.legs.map(
          (l) =>
            `${(l as { sport?: string }).sport ?? "?"}:${l.pickCode}@${l.odds.toFixed(2)}`,
        ),
        code: s.code,
        err: s.error,
      })),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
