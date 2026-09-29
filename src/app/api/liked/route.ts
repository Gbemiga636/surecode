import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { T } from "@/lib/db";
import { normalizeCode, resolveCode, settleLikedRow, type LikePayload } from "@/lib/liked";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function missingTable(message?: string) {
  return /sc_liked_codes|does not exist|schema cache/i.test(message ?? "");
}

function fail(message: string, status = 500) {
  return NextResponse.json(
    { ok: false, error: message, needsMigration: missingTable(message) },
    { status },
  );
}

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(request: Request) {
  const { supabase, user } = await session();
  if (!user) return fail("Not signed in", 401);
  const codesOnly = new URL(request.url).searchParams.get("codesOnly") === "1";

  const { data, error } = await supabase
    .from(T.likedCodes)
    .select(codesOnly ? "code" : "*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return fail(error.message);

  if (codesOnly) {
    return NextResponse.json({
      ok: true,
      codes: ((data ?? []) as unknown as { code: string }[]).map((r) => r.code),
    });
  }
  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await session();
  if (!user) return fail("Not signed in", 401);

  let body: { items?: LikePayload[]; note?: string };
  try {
    body = await request.json();
  } catch {
    return fail("Bad JSON", 400);
  }
  const items = (body.items ?? []).filter((i) => i && typeof i.code === "string").slice(0, 50);
  if (!items.length) return fail("No codes", 400);

  let lookup: Parameters<typeof resolveCode>[0];
  try {
    lookup = createAdminClient();
  } catch {
    lookup = supabase;
  }

  const rows = [];
  for (const item of items) {
    const code = normalizeCode(item.code);
    if (code.length < 4 || code.length > 20) continue;
    const resolved = await resolveCode(lookup, { ...item, code });
    rows.push({
      user_id: user.id,
      ...resolved,
      note: body.note ? String(body.note).slice(0, 280) : null,
    });
  }
  if (!rows.length) return fail("No valid codes", 400);

  const { data, error } = await supabase
    .from(T.likedCodes)
    .upsert(rows, { onConflict: "user_id,code", ignoreDuplicates: true })
    .select("id, legs, leg_results");
  if (error) return fail(error.message);

  // Past codes can often be settled immediately from leg history.
  for (const row of (data ?? []).slice(0, 5)) {
    try {
      await settleLikedRow(supabase, row as never);
    } catch {
      /* settles on the next refresh */
    }
  }

  return NextResponse.json({ ok: true, saved: rows.map((r) => r.code) });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await session();
  if (!user) return fail("Not signed in", 401);

  let body: { codes?: string[] };
  try {
    body = await request.json();
  } catch {
    return fail("Bad JSON", 400);
  }
  const codes = (body.codes ?? []).map((c) => normalizeCode(String(c))).filter(Boolean).slice(0, 200);
  if (!codes.length) return fail("No codes", 400);

  const { error } = await supabase
    .from(T.likedCodes)
    .delete()
    .eq("user_id", user.id)
    .in("code", codes);
  if (error) return fail(error.message);
  return NextResponse.json({ ok: true, removed: codes });
}
