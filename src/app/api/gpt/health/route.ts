import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "SureCode GPT API",
    endpoints: {
      openapi: "/api/gpt/openapi",
      sure: "/api/gpt/sure?mode=all",
    },
  });
}
