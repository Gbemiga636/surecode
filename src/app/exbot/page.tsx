import { redirect } from "next/navigation";
import { Alpaca } from "@/lib/exbot/alpaca";
import { OPTIONS, OPTIONS_RISK, RISK, STRATEGY, SYMBOLS } from "@/lib/exbot/config";
import { decrypt } from "@/lib/exbot/crypto";
import { sizeCondor, type Condor } from "@/lib/exbot/options-engine";
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
const n0 = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });
const p6 = (x: number) => Number(Number(x).toPrecision(6)).toString();
const when = (s: string | null) => (s ? new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="spark-empty">Your profit curve appears after the first closed trades.</div>;
  const w = 600, h = 120, pad = 6;
  const lo = Math.min(0, ...points), hi = Math.max(0, ...points);
  const span = hi - lo || 1;
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - 2 * pad), h - pad - ((p - lo) / span) * (h - 2 * pad)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const zero = h - pad - ((0 - lo) / span) * (h - 2 * pad);
  const up = points[points.length - 1] >= 0;
  const color = up ? "#22c55e" : "#f43f5e";
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="cumulative profit">
      <defs>
        <linearGradient id="xfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={pad} x2={w - pad} y1={zero} y2={zero} stroke="rgba(148,163,184,.25)" strokeDasharray="4 4" />
      <path d={`${line} L${xy[xy.length - 1][0]},${h - pad} L${xy[0][0]},${h - pad} Z`} fill="url(#xfill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default async function ExbotDashboard() {
  const v = await getViewer();
  if (!v) redirect("/exbot/login");

  const sb = createAdminClient();
  await sb.from("exbot_accounts").upsert({ user_id: v.userId, email: v.email }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: a, error } = await sb
    .from("exbot_accounts")
    .select("exchange,mode,enabled,key_hint,key_check,key_enc,secret_enc,paper_start,status,status_at")
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
  const isOpt = a.exchange === "alpaca";
  const unit = isOpt ? "USD" : "USDT";
  const [{ data: st }, { data: posRows }, { data: trades }, { data: closed }, { data: events }] = await Promise.all([
    sb.from("exbot_state").select("risk,paper_cash").eq("user_id", v.userId).eq("mode", mode).maybeSingle(),
    sb.from("exbot_positions").select("data").eq("user_id", v.userId).eq("mode", mode),
    sb.from("exbot_trades").select("*").eq("user_id", v.userId).eq("mode", mode).order("entry_time", { ascending: false }).limit(25),
    sb.from("exbot_trades").select("pnl,r_mult,exit_time").eq("user_id", v.userId).eq("mode", mode).eq("status", "closed").order("exit_time", { ascending: true }),
    sb.from("exbot_events").select("at,level,message").eq("user_id", v.userId).order("at", { ascending: false }).limit(60),
  ]);

  // Alpaca: live balance and SPY price for the balance plan.
  let liveEquity: number | null = null, spot: number | null = null, liveNote: string | null = null;
  if (isOpt && mode !== "paper" && a.key_enc && a.secret_enc && a.key_check === "ok") {
    try {
      const b = new Alpaca(decrypt(a.key_enc), decrypt(a.secret_enc), mode === "live");
      const [acct, px] = await Promise.all([b.account(), b.lastPrice(OPTIONS.underlying)]);
      liveEquity = Number(acct.equity);
      spot = px;
    } catch (e) {
      liveNote = e instanceof Error ? e.message : String(e);
    }
  }

  const risk = (st?.risk || {}) as Partial<RiskState>;
  const rows = (posRows || []).map((r) => r.data as Position | Condor);
  const condors = rows.filter((r): r is Condor => (r as Condor).kind === "condor");
  const positions = rows.filter((r): r is Position => (r as Condor).kind !== "condor");
  const openCount = isOpt ? condors.length : positions.length;
  const cl = closed || [];
  const wins = cl.filter((t) => Number(t.pnl) > 0).length;
  const pnl = cl.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const totalR = cl.reduce((s, t) => s + Number(t.r_mult || 0), 0);
  let run = 0;
  const curve = [0, ...cl.map((t) => (run += Number(t.pnl || 0)))];
  const today = new Date().toISOString().slice(0, 10);
  const pauses = Object.entries(risk.symbolPause || {}).filter(([, until]) => new Date(until) > new Date());
  const statusEquity = Number((a.status?.split(" · ")[1] || "").replace(/[^0-9.]/g, "")) || null;
  const equity = mode === "paper" && !isOpt ? Number(st?.paper_cash ?? a.paper_start) : liveEquity ?? statusEquity;
  const rp = isOpt ? OPTIONS_RISK : RISK;
  const modeLabel = isOpt ? (mode === "live" ? "REAL MONEY" : "Alpaca paper") : ({ paper: "practice", testnet: "testnet", live: "REAL MONEY" } as Record<string, string>)[mode];
  const badgeClass = isOpt && mode === "testnet" ? "paper" : mode;
  const account: AccountView = {
    exchange: a.exchange, mode: a.mode, enabled: a.enabled, keyHint: a.key_hint, keyCheck: a.key_check,
    paperStart: Number(a.paper_start), openPositions: openCount,
  };

  const openRisk = condors.reduce((s, c) => s + c.width * 100 * c.qty, 0);
  const plan = isOpt && equity && spot ? sizeCondor(equity, spot, 0) : null;
  const maxCondors = plan && !("skip" in plan) ? Math.max(1, Math.floor((equity! * OPTIONS.maxTotalRisk) / (plan.width * 100 * plan.qty))) : 0;

  return (
    <main>
      <div className="top">
        <div className="brand">
          <div className="logo">ex</div>
          <div>
            <h1>exbot</h1>
            <small>{isOpt ? "US options autopilot · Alpaca" : "Crypto trend autopilot"}</small>
          </div>
          <span className={`badge ${badgeClass}`}>{modeLabel}</span>
          <span className={`badge ${a.enabled ? "on" : ""}`}><span className={`dot ${a.enabled ? "on" : ""}`} />{a.enabled ? "running" : "paused"}</span>
        </div>
        <div className="user">
          {v.email}
          <form action={signOut}><button className="ghost">Sign out</button></form>
        </div>
      </div>

      {risk.killed && (
        <div className="panel warn">
          <p>Kill switch is on: this account fell {Math.round(rp.maxDrawdown * 100)}% from its peak, so new trades are blocked. Review the trades below before resetting it.</p>
          <KillSwitchReset />
        </div>
      )}
      {risk.haltDay === today && !risk.killed && <div className="panel warn">Daily loss limit reached: no new trades until tomorrow (UTC).</div>}

      <div className="panel">
        <div className="hero">
          <div className="balance">
            <span>Balance</span>
            <b>{equity != null ? `${n2(equity)}` : "—"} <small className="muted" style={{ fontSize: 14 }}>{unit}</small></b>
            <div className={`delta ${pnl >= 0 ? "pos" : "neg"}`}>{signed(pnl)} {unit} from closed trades · {signed(totalR)}R</div>
            <div className="statusline">
              <span className={`dot ${a.enabled ? "on" : ""}`} />
              Last check {when(a.status_at)} — {a.status || "not run yet"}
              {pauses.length > 0 && <> · paused coins: {pauses.map(([s]) => s.split("/")[0]).join(", ")}</>}
            </div>
            {liveNote && <p className="small neg" style={{ marginTop: 8 }}>Alpaca: {liveNote}</p>}
          </div>
          <Spark points={curve} />
        </div>
        <div className="stats">
          <div className="stat"><span>Open</span><b>{openCount} / {rp.maxOpenPositions}</b></div>
          <div className="stat"><span>Closed trades</span><b>{cl.length}</b></div>
          <div className="stat"><span>Win rate</span><b>{cl.length ? `${Math.round((wins / cl.length) * 100)}%` : "—"}</b></div>
          <div className="stat"><span>Net P&amp;L</span><b className={pnl >= 0 ? "pos" : "neg"}>{signed(pnl)}</b></div>
          <div className="stat"><span>{isOpt ? "Risk open" : "Total R"}</span><b>{isOpt ? `$${n0(openRisk)}` : `${signed(totalR)}R`}</b></div>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Your bot</h2>
          <Controls account={account} />
        </div>
        {isOpt ? (
          <div className="panel">
            <h2>Plan for your balance</h2>
            {plan == null ? (
              <p className="small muted">Connect and verify your Alpaca key to see how the bot will size trades for your balance.</p>
            ) : "skip" in plan ? (
              <div className="warn">{plan.skip}. Paper trading starts at $100,000, so you can still watch the strategy work there.</div>
            ) : (
              <ul className="facts">
                <li><span>SPY now</span><b>${n2(spot!)}</b></li>
                <li><span>Wing width</span><b>${plan.width} ({plan.width === Math.round(OPTIONS.widths[0] * spot!) ? "tested 2% wings" : "1% fallback for this balance"})</b></li>
                <li><span>Contracts per condor</span><b>{plan.qty}</b></li>
                <li><span>Max loss per condor</span><b>≈ ${n0(plan.width * 100 * plan.qty)} ({((plan.width * 100 * plan.qty) / equity! * 100).toFixed(1)}% of balance)</b></li>
                <li><span>Condors open at once</span><b>up to {Math.min(maxCondors, OPTIONS.dte)}</b></li>
                <li><span>Total risk cap</span><b>{OPTIONS.maxTotalRisk * 100}% of balance</b></li>
              </ul>
            )}
            <hr />
            <h2>How it trades</h2>
            <ol className="steps">
              <li>Each trading day between 15:35 and 15:56 New York time, it checks SPY. If SPY is below its 200-day average it sits out (that rule avoided the worst of 2008, 2020 and 2022).</li>
              <li>Otherwise it sells an iron condor expiring 5 trading days later: ~{Math.round(OPTIONS.shortDelta * 100)}-delta put and call, with protective wings so the most it can lose is fixed when the trade opens.</li>
              <li>It holds to expiry; on expiry day it closes any condor whose short strike is within 0.5% of SPY, so you are never assigned shares.</li>
              <li>It skips new trades around major US news (Fed, CPI, jobs) and on alarming market headlines (halts, crashes).</li>
            </ol>
            <p className="small muted">
              Tested on SPY prices and Cboe volatility from 2005 to 2026 (tuned on 2005–2018, checked on 2019–2026): about 78% of condors won and about 7 months in 10 were positive, but losing weeks and months happen
              (2018 and 2022 were down). Option prices in the test were modelled, so the first weeks on Alpaca paper are the real check. No result is guaranteed, and no strategy wins every day.
            </p>
          </div>
        ) : (
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
              Of six strategies tested on data they had never seen, this one did best: it made money in 5 of 6 years since 2021 and lost in choppy 2022. It wins about 1 trade in 4: many small losses, a few big trend wins. No result is guaranteed.
            </p>
            <div className="note small">Want more frequent trades? Choose <b>Alpaca</b> above: the options bot opens a position on most trading days.</div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Open positions</h2>
        {openCount === 0 ? <div className="empty">No open positions.</div> : isOpt ? (
          <div className="scroll"><table>
            <thead><tr><th>Opened</th><th>Expires</th><th>Puts (buy/sell)</th><th>Calls (sell/buy)</th><th>Qty</th><th>Credit</th><th>Max loss</th><th>Status</th></tr></thead>
            <tbody>{condors.map((c) => {
              const k = (t: string, s: string) => c.legs.find((l) => l.type === t && l.side === s)?.strike;
              return (
                <tr key={c.key}>
                  <td>{c.openDay}</td><td>{c.expiry}</td>
                  <td>{k("put", "buy")} / {k("put", "sell")}</td><td>{k("call", "sell")} / {k("call", "buy")}</td>
                  <td>{c.qty}</td>
                  <td>{c.credit ? `$${n2(c.credit * 100 * c.qty)}` : `asking $${n2(c.limit * 100 * c.qty)}`}</td>
                  <td>${n0((c.width - (c.credit || c.limit)) * 100 * c.qty)}</td>
                  <td><span className={`badge ${c.status === "open" ? "on" : "testnet"}`}>{c.status === "pending" ? "order working" : c.status}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : (
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
        <h2>Trades · {modeLabel}</h2>
        {(trades || []).length === 0 ? (
          <div className="empty">{isOpt ? "No trades yet. The first condor goes in during the next 15:35–15:56 New York window when SPY is above its 200-day average." : "No trades yet. Signals are rare (about 9 a month across all coins), so the first one can take days."}</div>
        ) : (
          <div className="scroll"><table>
            <thead><tr><th>Opened</th><th>{isOpt ? "Position" : "Coin"}</th><th>{isOpt ? "Credit" : "Side"}</th><th>{isOpt ? "Width" : "Entry"}</th><th>Closed</th><th>Why</th><th>P&amp;L</th><th>R</th></tr></thead>
            <tbody>{(trades || []).map((t) => (
              <tr key={t.id}>
                <td>{when(t.entry_time)}</td>
                <td>{isOpt ? t.symbol : String(t.symbol).split("/")[0]}</td>
                {isOpt ? <td>${n2(Number(t.entry))}</td> : <td className={t.side === 1 ? "pos" : "neg"}>{SIDE[t.side]}</td>}
                <td>{isOpt ? `$${Number(t.stop0)}` : p6(t.entry)}</td>
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
            <div key={i} className={`lv-${e.level}`}><span className="muted">{when(e.at)}</span><span>{e.message}</span></div>
          ))}
        </div>
      </div>
    </main>
  );
}
