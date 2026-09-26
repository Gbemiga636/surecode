import { NextResponse } from "next/server";
import { siteBaseUrl } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";

/**
 * OpenAPI 3.1 schema for ChatGPT Custom GPT → Actions.
 * Give this URL (or the JSON body) to the person connecting their GPT.
 */
export async function GET(request: Request) {
  const base = siteBaseUrl(request);

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "SureCode API",
      description:
        "Fetch today's SureCode SportyBet slips (Safe, Larger, Longshot). " +
        "Codes are filtered favourites across sports — never 100% sure. " +
        "Auth: Bearer token (GPT_API_SECRET).",
      version: "1.0.0",
    },
    servers: [{ url: base }],
    paths: {
      "/api/gpt/sure": {
        get: {
          operationId: "getSureCodes",
          summary: "Get today's Sure codes",
          description:
            "Returns booked SportyBet share codes for the Lagos day, optionally filtered by mode.",
          parameters: [
            {
              name: "mode",
              in: "query",
              required: false,
              description: "all | safe | boost | longshot",
              schema: {
                type: "string",
                enum: ["all", "safe", "boost", "longshot"],
                default: "all",
              },
            },
            {
              name: "day",
              in: "query",
              required: false,
              description: "Optional YYYY-MM-DD (Africa/Lagos). Defaults to today.",
              schema: { type: "string", format: "date" },
            },
          ],
          responses: {
            "200": {
              description: "Sure codes for the day",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      day: { type: "string" },
                      disclaimer: { type: "string" },
                      count: { type: "integer" },
                      codes: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            slot: { type: "integer" },
                            mode: { type: "string" },
                            modeLabel: { type: "string" },
                            code: { type: "string" },
                            openUrl: { type: "string" },
                            totalOdds: { type: "number", nullable: true },
                            confidence: { type: "integer", nullable: true },
                            rationale: { type: "string", nullable: true },
                            legs: { type: "array", items: { type: "object" } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": { description: "Missing or invalid Bearer token" },
          },
          security: [{ bearerAuth: [] }],
        },
      },
      "/api/gpt/health": {
        get: {
          operationId: "healthCheck",
          summary: "API health check",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      service: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "GPT_API_SECRET from SureCode env",
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
