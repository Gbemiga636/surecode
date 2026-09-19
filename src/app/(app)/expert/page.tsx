import { redirect } from "next/navigation";

export default async function ExpertRedirect({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const type = sp.type || "safe";
  const tab =
    type === "goals" || type === "btts" || type === "safe" ? type : "overall";
  redirect(`/picks?tab=${tab}`);
}
