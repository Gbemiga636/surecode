import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { T } from "@/lib/db";
import { DEMO_START, ensureDemoWallet, settleDemoBets } from "@/lib/demo";
import { DemoTools } from "@/components/DemoTools";
import { Icon, type IconName } from "@/components/Icons";

type Bet = {
  id: string;
  code: string | null;
  stake: number;
  total_odds: number;
  potential: number | null;
  legs: unknown;
  outcome: string;
  created_at: string;
};

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

const STAMP: Record<string, { label: string; icon: IconName; cls: string }> = {
  WON: { label: "Won", icon: "trophy", cls: "dw-won" },
  LOST: { label: "Lost", icon: "close", cls: "dw-lost" },
  VOID: { label: "Void", icon: "shield", cls: "dw-void" },
  PENDING: { label: "Live", icon: "clock", cls: "dw-pending" },
};

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default async function DemoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let settler: Parameters<typeof settleDemoBets>[0] = supabase;
  try {
    settler = createAdminClient();
  } catch {
    /* fall back to the signed-in client */
  }
  await settleDemoBets(settler, user.id).catch(() => {});

  const wallet = await ensureDemoWallet(supabase, user.id);
  const { data } = await supabase
    .from(T.demoBets)
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);
  const bets = (data ?? []) as Bet[];

  const balance = Number(wallet?.balance ?? 0);
  const staked = Number(wallet?.staked ?? 0);
  const returned = Number(wallet?.returned ?? 0);
  const pnl = returned - staked;
  const won = bets.filter((b) => b.outcome === "WON").length;
  const lost = bets.filter((b) => b.outcome === "LOST").length;
  const live = bets.filter((b) => b.outcome === "PENDING").length;
  const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : null;
  const left = Math.max(0, Math.min(100, (balance / DEMO_START) * 100));
  const bestOdds = bets.reduce((m, b) => Math.max(m, Number(b.total_odds || 0)), 0);

  const stats: { icon: IconName; label: string; value: string; tone: string }[] = [
    { icon: "ticket", label: "Staked today", value: naira(staked), tone: "b" },
    { icon: "trend", label: "Returned", value: naira(returned), tone: "g" },
    { icon: "gauge", label: "Profit / loss", value: `${pnl >= 0 ? "+" : "−"}${naira(Math.abs(pnl))}`, tone: pnl >= 0 ? "g" : "r" },
    { icon: "trophy", label: "Win rate", value: winRate != null ? `${winRate}%` : "—", tone: "y" },
  ];

  return (
    <div className="dw">
      <section className="dw-hero sc-rise">
        <div className="dw-card" aria-label="Demo wallet balance">
          <div className="dw-card-top">
            <span className="dw-chip" aria-hidden />
            <span className="dw-card-brand">
              <Icon name="target" size={15} /> SureCode Demo
            </span>
          </div>
          <p className="dw-card-k">Available balance</p>
          <p className="dw-card-bal">{naira(balance)}</p>
          <div className="dw-card-meter" aria-hidden>
            <span style={{ width: `${left}%` }} />
          </div>
          <div className="dw-card-foot">
            <span>{Math.round(left)}% of {naira(DEMO_START)} left</span>
            <span className="dw-card-reset">
              <Icon name="clock" size={13} /> Resets at midnight
            </span>
          </div>
        </div>

        <div className="dw-intro">
          <p className="dw-kicker">
            <Icon name="wallet" size={13} /> Practice mode
          </p>
          <h2 className="dw-title">
            Stake it. <span className="dw-title-grad">Risk nothing.</span>
          </h2>
          <p className="dw-sub">
            Virtual naira only. Back any Sure code or let AI build practice slips, then watch them
            settle from real final scores.
          </p>
          <DemoTools />
        </div>
      </section>

      <ul className="dw-stats" aria-label="Wallet summary">
        {stats.map((s, i) => (
          <li key={s.label} className={`dw-stat dw-tone-${s.tone} sc-rise`} style={{ animationDelay: `${80 + i * 60}ms` }}>
            <span className="dw-stat-ic">
              <Icon name={s.icon} size={18} />
            </span>
            <span className="dw-stat-body">
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </span>
          </li>
        ))}
      </ul>

      <section className="dw-slips">
        <header className="dw-slips-head">
          <h3>
            <Icon name="ticket" size={18} /> Your bet slips
          </h3>
          <div className="dw-pills">
            <span className="dw-pill dw-pending">{live} live</span>
            <span className="dw-pill dw-won">{won} won</span>
            <span className="dw-pill dw-lost">{lost} lost</span>
            {bestOdds > 0 && <span className="dw-pill">Top odds {bestOdds.toFixed(2)}</span>}
          </div>
        </header>

        {!bets.length && (
          <div className="dw-empty">
            <span className="dw-empty-ic">
              <Icon name="ticket" size={28} />
            </span>
            <p className="dw-empty-t">No slips yet</p>
            <p>
              Tap <strong>Demo stake</strong> on any Sure code, or use <strong>AI auto slips</strong> above
              to place your first practice bets.
            </p>
          </div>
        )}

        <div className="dw-grid">
          {bets.map((b, i) => {
            const st = STAMP[b.outcome] ?? STAMP.PENDING;
            const legs = Array.isArray(b.legs) ? b.legs.length : 0;
            const potential = Number(b.potential ?? Number(b.stake) * Number(b.total_odds));
            return (
              <article
                key={b.id}
                className={`dw-ticket ${st.cls} sc-rise`}
                style={{ animationDelay: `${Math.min(i, 9) * 45}ms` }}
              >
                <div className="dw-ticket-main">
                  <div className="dw-ticket-row">
                    <span className={`dw-stamp ${st.cls}`}>
                      <Icon name={st.icon} size={12} /> {st.label}
                    </span>
                    <span className="dw-ticket-when">{when(b.created_at)}</span>
                  </div>
                  <p className="dw-ticket-code">{b.code || "Practice slip"}</p>
                  <p className="dw-ticket-meta">
                    {legs} leg{legs === 1 ? "" : "s"} · odds <strong>{Number(b.total_odds).toFixed(2)}</strong>
                  </p>
                </div>
                <div className="dw-ticket-stub">
                  <span>
                    <em>Stake</em>
                    <strong>{naira(Number(b.stake))}</strong>
                  </span>
                  <Icon name="arrowRight" size={14} className="dw-stub-arrow" />
                  <span>
                    <em>{b.outcome === "WON" ? "Paid" : "To win"}</em>
                    <strong className="dw-win">{naira(potential)}</strong>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p className="dw-foot">
        Demo balances are virtual and reset daily. Practice results don’t guarantee real outcomes.
        18+, bet responsibly.
      </p>
    </div>
  );
}
