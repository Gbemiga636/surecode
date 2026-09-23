import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { PageHeader } from "@/components/PageHeader";
import { SureHomeClient, type SureHomeCode } from "@/components/SureHomeClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const day = lagosDay();

  const { data: codes } = await supabase
    .from(T.sureCodes)
    .select("*")
    .eq("day", day)
    .order("slot", { ascending: true });

  const rows = (codes ?? []) as SureHomeCode[];

  return (
    <div>
      <PageHeader
        kicker="Max-hit · all sports"
        title="Sure codes"
        subtitle={`${day} · Choose Safe singles or Larger sure — full AI analysis on every slip.`}
      />
      <SureHomeClient day={day} codes={rows} />
    </div>
  );
}
