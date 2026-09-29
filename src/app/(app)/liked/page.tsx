import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import type { LikedRow } from "@/lib/liked";
import { LikedBoard } from "@/components/LikedBoard";

export const dynamic = "force-dynamic";

export default async function LikedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from(T.likedCodes)
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);

  const needsSetup = Boolean(error && /sc_liked_codes|does not exist|schema cache/i.test(error.message));

  return <LikedBoard rows={(data ?? []) as LikedRow[]} needsSetup={needsSetup} />;
}
