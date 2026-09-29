import { NextResponse } from "next/server";
import { siteBaseUrl } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";

const obj = (properties: Record<string, unknown> = {}) => ({
  type: "object",
  properties,
  additionalProperties: true,
});

const intParam = (name: string, description: string, min: number, max: number, def: number) => ({
  name,
  in: "query",
  required: false,
  description,
  schema: { type: "integer", minimum: min, maximum: max, default: def },
});

const ok = (description: string, properties: Record<string, unknown>) => ({
  "200": { description, content: { "application/json": { schema: obj(properties) } } },
  "401": { description: "Missing or invalid Bearer token" },
});

/** OpenAPI 3.1 schema for ChatGPT Custom GPT → Configure → Actions → Import from URL. */
export async function GET(request: Request) {
  const base = siteBaseUrl(request);
  const secured = [{ bearerAuth: [] }];

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "SureCode Prediction API",
      description:
        "Live data for the SureCode sports prediction site: booked SportyBet slips, " +
        "upcoming fixtures with de-vigged market probabilities, settled history, and " +
        "probability-quality metrics (Brier, log loss, calibration). Nothing here is a guarantee.",
      version: "2.0.0",
    },
    servers: [{ url: base }],
    paths: {
      "/api/gpt/sure": {
        get: {
          operationId: "getSureCodes",
          summary: "Today's booked Sure slips",
          description:
            "SportyBet share codes for the Lagos day. Slots 1-3 Safe, 4-6 Larger, 7-9 Longshot. " +
            "confidence = product of market-implied leg probabilities (not calibrated).",
          parameters: [
            {
              name: "mode",
              in: "query",
              required: false,
              description: "all | safe | boost | longshot",
              schema: { type: "string", enum: ["all", "safe", "boost", "longshot"], default: "all" },
            },
            {
              name: "day",
              in: "query",
              required: false,
              description: "YYYY-MM-DD (Africa/Lagos). Defaults to today.",
              schema: { type: "string" },
            },
          ],
          responses: ok("Sure slips", {
            day: { type: "string" },
            count: { type: "integer" },
            codes: { type: "array", items: obj() },
          }),
          security: secured,
        },
      },
      "/api/gpt/metrics": {
        get: {
          operationId: "getMetrics",
          summary: "Probability-quality and performance report",
          description:
            "Hit rate with Wilson 95% CI, Brier score and skill vs base rate, log loss, " +
            "calibration bins and ECE, flat-stake ROI — overall and by market, inferred sport, and league. " +
            "Includes data-quality flags (excluded biased rows, staleness).",
          parameters: [
            intParam("days", "Look-back window in days", 7, 365, 90),
            intParam("minSample", "Minimum settled legs per group", 1, 200, 10),
          ],
          responses: ok("Metrics report", {
            generatedAt: { type: "string" },
            dataQuality: obj(),
            legs: obj(),
            slips: obj(),
          }),
          security: secured,
        },
      },
      "/api/gpt/fixtures": {
        get: {
          operationId: "getFixtures",
          summary: "Upcoming fixtures with odds and de-vigged probabilities",
          description:
            "Live SportyBet pre-match odds. main.probabilities are proportional de-vig market estimates; " +
            "main.overround is the bookmaker margin. No injuries or lineups.",
          parameters: [
            {
              name: "sport",
              in: "query",
              required: false,
              description: "all | football | basketball | tennis | hockey | baseball",
              schema: {
                type: "string",
                enum: ["all", "football", "basketball", "tennis", "hockey", "baseball"],
                default: "all",
              },
            },
            intParam("hours", "Kickoff within the next N hours", 1, 120, 24),
            intParam("limit", "Maximum fixtures returned", 1, 150, 40),
            {
              name: "league",
              in: "query",
              required: false,
              description: "Case-insensitive substring filter on league name",
              schema: { type: "string" },
            },
          ],
          responses: ok("Fixtures", {
            fetchedAt: { type: "string" },
            count: { type: "integer" },
            fixtures: { type: "array", items: obj() },
          }),
          security: secured,
        },
      },
      "/api/gpt/history": {
        get: {
          operationId: "getHistory",
          summary: "Recent settled legs and slips",
          description: "Settled legs (with scores and implied probability) and past slips with outcomes.",
          parameters: [
            intParam("days", "Look-back window in days", 1, 365, 30),
            intParam("limit", "Maximum rows per list", 1, 200, 50),
          ],
          responses: ok("History", {
            legs: { type: "array", items: obj() },
            slips: { type: "array", items: obj() },
          }),
          security: secured,
        },
      },
      "/api/gpt/health": {
        get: {
          operationId: "healthCheck",
          summary: "API health check",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: obj({ ok: { type: "boolean" } }) } },
            },
          },
        },
      },
    },
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
