import { NextResponse, after } from "next/server";
import { runSureCrawl } from "@/lib/crawl";

/** Allow background crawl to finish after cron gets a fast 200. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const crawlSecret = process.env.CRAWL_SECRET || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const hdr = request.headers.get("x-crawl-secret") || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (crawlSecret && (hdr === crawlSecret || bearer === crawlSecret)) return true;
  if (cronSecret && bearer === cronSecret) return true;
  return false;
}

/**
 * Default (cron-friendly): return 200 immediately, run crawl in background via after().
 * Add ?wait=1 to wait for the full result (manual debugging only).
 */
async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const wait = url.searchParams.get("wait") === "1";

  if (!wait) {
    after(async () => {
      try {
        const result = await runSureCrawl();
        console.log("[api/crawl] background done:", result.summary);
      } catch (e) {
        console.error("[api/crawl] background failed:", e instanceof Error ? e.message : e);
      }
    });

    return NextResponse.json(
      {
        ok: true,
        started: true,
        mode: "async",
        message: "Crawl started in background. Check /home in ~30–60s.",
      },
      {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
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
