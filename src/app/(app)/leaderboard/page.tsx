import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const { data: wallets } = await supabase
    .from(T.demoWallets)
    .select("user_id, balance, staked, returned, updated_at")
    .order("returned", { ascending: false })
    .limit(30);

  const rows = (wallets ?? []).map((w, i) => ({
    rank: i + 1,
    ...w,
    profit: Number(w.returned) - Number(w.staked),
  }));

  return (
    <div>
      <PageHeader
        kicker="Competition"
        title="Leaderboard"
        subtitle="Demo-wallet returns only. Keep practicing — real money never moves here."
      />
      <div className="space-y-2">
        {!rows.length && <div className="sc-empty text-sm text-ink/55">No demo wallets yet.</div>}
        {rows.map((r) => (
          <div key={r.user_id} className="sc-card flex items-center justify-between gap-3 p-4 text-sm">
            <div>
              <p className="font-display text-lg font-extrabold">#{r.rank}</p>
              <p className="font-mono text-xs text-ink/40">{String(r.user_id).slice(0, 8)}…</p>
            </div>
            <div className="text-right">
              <p className="font-bold">Returned ₦{Number(r.returned).toLocaleString()}</p>
              <p className="text-ink/45">
                Staked ₦{Number(r.staked).toLocaleString()} · P/L {r.profit >= 0 ? "+" : ""}
                {r.profit.toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
