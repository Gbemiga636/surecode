import { redirect } from "next/navigation";
import { RISK, STRATEGY, SYMBOLS } from "@/lib/exbot/config";
import type { Position } from "@/lib/exbot/position";
import type { RiskState } from "@/lib/exbot/risk";
import { getViewer } from "@/lib/exbot/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "./actions";
import { Controls, KillSwitchReset, type AccountView } from "./Controls";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1";

const SIDE: Record<number, string> = { 1: "LONG", [-1]: "SHORT" };
const n2 = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p6 = (x: number) => Number(Number(x).toPrecision(6)).toString();
const when = (s: string | null) => (s ? new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
const MODE_LABEL: Record<string, string> = { paper: "practice", testnet: "testnet", live: "REAL MONEY" };

export default async function ExbotDashboard() {
  const v = await getViewer();
  if (!v) redirect("/exbot/login");

  const sb = createAdminClient();
  await sb.from("exbot_accounts").upsert({ user_id: v.userId, email: v.email }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: a, error } = await sb
    .from("exbot_accounts")
    .select("exchange,mode,enabled,key_hint,key_check,paper_start,status,status_at")
    .eq("user_id", v.userId)
    .maybeSingle();
  if (error || !a) {
    return (
      <main className="login">
        <div className="panel warn">exbot is not set up in the database yet ({error?.message || "no account row"}). Run sql/schema-exbot.sql in Supabase.</div>
      </main>
    );
  }
  const mode = a.mode as string;
  const [{ data: st }, { data: posRows }, { data: trades }, { data: closed }, { data: events }] = await Promise.all([
    sb.from("exbot_state").select("risk,paper_cash").eq("user_id", v.userId).eq("mode", mode).maybeSingle(),
    sb.from("exbot_positions").select("data").eq("user_id", v.userId).eq("mode", mode),
    sb.from("exbot_trades").select("*").eq("user_id", v.userId).eq("mode", mode).order("entry_time", { ascending: false }).limit(25),
    sb.from("exbot_trades").select("pnl,r_mult").eq("user_id", v.userId).eq("mode", mode).eq("status", "closed"),
    sb.from("exbot_events").select("at,level,message").eq("user_id", v.userId).order("at", { ascending: false }).limit(60),
  ]);

  const risk = (st?.risk || {}) as Partial<RiskState>;
  const positions = (posRows || []).map((r) => r.data as Position);
  const cl = closed || [];
  const wins = cl.filter((t) => Number(t.pnl) > 0).length;
  const pnl = cl.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const totalR = cl.reduce((s, t) => s + Number(t.r_mult || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const pauses = Object.entries(risk.symbolPause || {}).filter(([, until]) => new Date(until) > new Date());
  const balance = mode === "paper" ? `${n2(Number(st?.paper_cash ?? a.paper_start))} USDT` : a.status?.split(" · ")[1] || "—";
  const account: AccountView = {
    exchange: a.exchange, mode: a.mode, enabled: a.enabled, keyHint: a.key_hint, keyCheck: a.key_check,
    paperStart: Number(a.paper_start), openPositions: positions.length,
  };

  return (
    <main>
      <div className="top">
        <div className="row">
          <h1>exbot</h1>
          <span className={`badge ${mode}`}>{MODE_LABEL[mode]}</span>
          <span className={`badge ${a.enabled ? "on" : ""}`}>{a.enabled ? "running" : "paused"}</span>
        </div>
        <div className="row small muted">
          {v.email}
          <form action={signOut}><button>Sign out</button></form>
        </div>
      </div>

      {risk.killed && (
        <div className="panel warn">
          <p>Kill switch is on: this account fell {Math.round(RISK.maxDrawdown * 100)}% from its peak, so new trades are blocked. Review the trades below before resetting it.</p>
          <KillSwitchReset />
        </div>
      )}
      {risk.haltDay === today && !risk.killed && <div className="panel warn">Daily loss limit reached: no new trades until tomorrow (UTC).</div>}

      <div className="panel">
        <h2>Overview</h2>
        <div className="stats">
          <div className="stat"><span>Balance</span><b>{balance}</b></div>
          <div className="stat"><span>Open positions</span><b>{positions.length} / {RISK.maxOpenPositions}</b></div>
          <div className="stat"><span>Closed trades</span><b>{cl.length}</b></div>
          <div className="stat"><span>Win rate</span><b>{cl.length ? `${Math.round((wins / cl.length) * 100)}%` : "—"}</b></div>
          <div className="stat"><span>Net P&amp;L</span><b className={pnl >= 0 ? "pos" : "neg"}>{signed(pnl)} USDT</b></div>
          <div className="stat"><span>Total R</span><b className={totalR >= 0 ? "pos" : "neg"}>{signed(totalR)}R</b></div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Last check: {when(a.status_at)} — {a.status || "not run yet"}
          {pauses.length > 0 && <> · paused coins: {pauses.map(([s]) => s.split("/")[0]).join(", ")}</>}
        </p>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Your bot</h2>
          <Controls account={account} />
        </div>
        <div className="panel">
          <h2>How it trades</h2>
          <p className="small">
            It trades the EMA {STRATEGY.fast}/{STRATEGY.slow} trend on 4-hour candles across {SYMBOLS.length} coins ({SYMBOLS.map((s) => s.split("/")[0]).join(", ")}).
            It goes long when the {STRATEGY.fast} EMA crosses above the {STRATEGY.slow} EMA and short on the opposite cross. Every position gets a stop on the exchange at {STRATEGY.kAtr}× ATR, and it exits when the EMAs cross back.
          </p>
          <p className="small">
            Each trade risks {(RISK.riskPerTrade * 100).toFixed(2)}% of the current balance, so position size grows as the account grows. It holds at most one position per coin. A {(RISK.dailyLossLimit * 100).toFixed(0)}% daily loss stops new trades for the day, and a {(RISK.maxDrawdown * 100).toFixed(0)}% drawdown triggers the kill switch. It skips new trades around major US news and around hack or delisting headlines.
          </p>
          <p className="small muted">
            Of six strategies tested on data they had never seen, this one did best: it made money in 5 of 6 years since 2021 and lost in choppy 2022. It wins about 1 trade in 4: many small losses, a few big trend wins. In strong bull markets it trails simply holding coins. No result is guaranteed.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Open positions</h2>
        {positions.length === 0 ? <p className="muted small">None.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Entry</th><th>Stop</th><th>Risk</th><th>Opened</th></tr></thead>
            <tbody>{positions.map((p) => (
              <tr key={p.symbol}>
                <td>{p.symbol.split("/")[0]}</td><td className={p.side === 1 ? "pos" : "neg"}>{SIDE[p.side]}</td>
                <td>{p6(p.qtyOpen)}</td><td>{p6(p.entry)}</td><td>{p6(p.stop)}</td>
                <td>{n2(p.qty * Math.abs(p.entry - p.stop0))} USDT</td><td>{when(p.entryTime)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="panel">
        <h2>Trades ({MODE_LABEL[mode]})</h2>
        {(trades || []).length === 0 ? <p className="muted small">No trades yet. Signals are rare (about 9 a month across all coins), so the first one can take days.</p> : (
          <div className="scroll"><table>
            <thead><tr><th>Opened</th><th>Coin</th><th>Side</th><th>Entry</th><th>Closed</th><th>Why</th><th>P&amp;L</th><th>R</th></tr></thead>
            <tbody>{(trades || []).map((t) => (
              <tr key={t.id}>
                <td>{when(t.entry_time)}</td><td>{String(t.symbol).split("/")[0]}</td>
                <td className={t.side === 1 ? "pos" : "neg"}>{SIDE[t.side]}</td><td>{p6(t.entry)}</td>
                <td>{t.status === "open" ? <span className="badge on">open</span> : when(t.exit_time)}</td>
                <td className="muted">{t.reason_out || ""}</td>
                <td className={Number(t.pnl) >= 0 ? "pos" : "neg"}>{t.pnl == null ? "" : signed(Number(t.pnl))}</td>
                <td>{t.r_mult == null ? "" : `${signed(Number(t.r_mult))}R`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="panel">
        <h2>Activity</h2>
        <div className="log">
          {(events || []).length === 0 && <div className="muted">Nothing yet.</div>}
          {(events || []).map((e, i) => (
            <div key={i} className={`lv-${e.level}`}><span className="muted">{when(e.at)}</span> · {e.message}</div>
          ))}
        </div>
      </div>
    </main>
  );
}
