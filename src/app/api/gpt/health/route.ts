import { NextResponse } from "next/server";
import { gptAuthHint, gptAuthorized } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorized = gptAuthorized(request);
  return NextResponse.json({
    ok: true,
    service: "SureCode GPT API",
    time: new Date().toISOString(),
    authorized,
    ...(authorized ? {} : { authHint: gptAuthHint(request) }),
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
