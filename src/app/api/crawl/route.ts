import { NextResponse } from "next/server";
import { runSureCrawl } from "@/lib/crawl";

export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.CRAWL_SECRET;
  const hdr = request.headers.get("x-crawl-secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secret || (hdr !== secret && bearer !== secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSureCrawl();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  return POST(request);
}
