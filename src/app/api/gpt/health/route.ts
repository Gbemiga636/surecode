import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "SureCode GPT API",
    time: new Date().toISOString(),
    endpoints: {
      openapi: "/api/gpt/openapi",
      instructions: "/api/gpt/instructions",
      sure: "/api/gpt/sure?mode=all",
      metrics: "/api/gpt/metrics?days=90",
      fixtures: "/api/gpt/fixtures?sport=all&hours=24",
      history: "/api/gpt/history?days=30",
    },
  });
}
