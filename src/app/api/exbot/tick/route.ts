import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runTick } from "@/lib/exbot/engine";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1";

let cached: { at: number; token: string | null } | null = null;

async function cronToken(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.token;
  const { data } = await createAdminClient().from("exbot_runtime").select("cron_token").eq("id", 1).maybeSingle();
  cached = { at: Date.now(), token: data?.cron_token || null };
  return cached.token;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function handle(request: Request) {
  const sent = (request.headers.get("x-exbot-cron") || "").trim();
  const token = await cronToken();
  if (!token || sent.length < 32 || !same(sent, token)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const results = await runTick(createAdminClient());
    return NextResponse.json({ ok: true, ms: Date.now() - started, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
