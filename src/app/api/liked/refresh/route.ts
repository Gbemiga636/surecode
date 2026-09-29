import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { makeDeadline } from "@/lib/budget";
import { settleLikedCodes } from "@/lib/liked";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const deadline = makeDeadline(22_000);
  const settled = await settleLikedCodes(supabase, {
    userId: user.id,
    limit: 20,
    force: true,
    deadline,
  });
  return NextResponse.json({ ok: true, settled });
}
