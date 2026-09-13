import { NextResponse } from "next/server";
import { runSureCrawl } from "@/lib/crawl";

/** Hobby Fluid Compute allows up to 300s; 60s is enough for a full sure crawl. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const crawlSecret = process.env.CRAWL_SECRET || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const hdr = request.headers.get("x-crawl-secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  // Manual / external cron (cron-job.org, curl, etc.)
  if (crawlSecret && (hdr === crawlSecret || bearer === crawlSecret)) return true;
  // Vercel Cron auto-sends Authorization: Bearer <CRON_SECRET>
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSureCrawl();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api/crawl]", message);
    // Never throw raw 500 stack to the edge — keep response JSON so cron doesn't "crash"
    return NextResponse.json(
      { ok: false, error: message, summary: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
