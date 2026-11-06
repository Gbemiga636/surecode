import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runSureCrawl, settlePendingCodes } from "@/lib/crawl";
import { makeDeadline } from "@/lib/budget";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";

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

/** Codes already on today's Sure board (Lagos day); null when the check itself fails. */
async function boardCodesToday(day: string): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { count, error } = await sb.from(T.sureCodes).select("id", { count: "exact", head: true }).eq("day", day);
  return error ? null : (count ?? 0);
}

/**
 * One Sure board per day: the first crawl of the Lagos day books the codes and
 * every later run only settles finished codes, so everyone sees the same codes
 * all day. `?force=1` rebuilds anyway (manual use only).
 *
 * Vercel: async ACK via after() so external cron does not timeout.
 * Netlify / other: run sync (after() often does not keep the worker alive).
 * ?wait=1 always sync.
 */
async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const wait = url.searchParams.get("wait") === "1";
  const force = url.searchParams.get("force") === "1";
  const onVercel = process.env.VERCEL === "1";
  const day = lagosDay();

  if (!force && ((await boardCodesToday(day)) ?? 0) > 0) {
    const settle = () => settlePendingCodes(undefined, makeDeadline(60_000));
    if (!wait && onVercel) {
      after(async () => {
        try {
          await settle();
        } catch (e) {
          console.error("[api/crawl] settle failed:", e instanceof Error ? e.message : e);
        }
      });
      return NextResponse.json(
        { ok: true, locked: true, day, message: "Today's board is already set; settling finished codes only." },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const settled = await settle().catch(() => 0);
    return NextResponse.json({ ok: true, locked: true, day, settled }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!wait && onVercel) {
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
        message: "Crawl started. Codes refresh on /home in ~30–90s.",
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
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
