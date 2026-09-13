import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { ensureDemoWallet } from "@/lib/demo";
import { DemoTools } from "@/components/DemoTools";
import { PageHeader } from "@/components/PageHeader";

export default async function DemoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const wallet = await ensureDemoWallet(supabase, user.id);
  const { data: bets } = await supabase
    .from(T.demoBets)
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div>
      <PageHeader
        kicker="Practice"
        title="Demo wallet"
        subtitle="Virtual ₦ only. Balance refreshes each Lagos day. No real money moves."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Balance", wallet?.balance],
          ["Staked", wallet?.staked],
          ["Returned", wallet?.returned],
        ].map(([label, val]) => (
          <div key={String(label)} className="sc-card p-4">
            <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-ink/40">
              {label}
            </p>
            <p className="mt-2 font-display text-2xl font-extrabold text-ink">
              ₦{Number(val ?? 0).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <DemoTools />

      <h2 className="mt-10 font-display text-lg font-bold">Recent bets</h2>
      <div className="mt-3 space-y-2.5">
        {(bets ?? []).length === 0 && (
          <p className="text-sm text-ink/55">
            Empty bank history — use Expert / Codes, or AI auto slips above.
          </p>
        )}
        {(bets ?? []).map((b) => (
          <div key={b.id} className="sc-card flex flex-wrap justify-between gap-2 p-4 text-sm">
            <div>
              <p className="font-mono font-bold">{b.code || "—"}</p>
              <p className="text-ink/55">
                Stake ₦{Number(b.stake).toLocaleString()} · Odds {Number(b.total_odds).toFixed(2)}
              </p>
            </div>
            <span className="font-extrabold text-pitch-deep">{b.outcome}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
