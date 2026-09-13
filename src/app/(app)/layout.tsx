import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppChrome } from "@/components/AppChrome";
import { BgFx } from "@/components/PitchArt";

export const dynamic = "force-dynamic";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <BgFx />
      <AppChrome email={user.email ?? "user"}>{children}</AppChrome>
    </>
  );
}
