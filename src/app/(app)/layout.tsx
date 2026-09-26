import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppChrome } from "@/components/AppChrome";

export const dynamic = "force-dynamic";

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <AppChrome email={user.email ?? "user"}>{children}</AppChrome>;
}
