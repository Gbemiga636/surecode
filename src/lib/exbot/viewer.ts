import { createClient } from "@/lib/supabase/server";

export type Viewer = { userId: string; email: string };

/** Any signed-in user can use exbot; each person only ever sees and trades their own account. */
export async function getViewer(): Promise<Viewer | null> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  return { userId: user.id, email: user.email.toLowerCase() };
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new Error("Please sign in again");
  return v;
}
