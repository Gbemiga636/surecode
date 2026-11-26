"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { closeAll, resetKillSwitch, resetPaper, runNow, saveSettings, setEnabled, testConnection, type Result } from "./actions";

export type AccountView = {
  exchange: string;
  mode: string;
  strategy?: string;
  enabled: boolean;
  keyHint: string | null;
  keyCheck: string | null;
  paperStart: number;
  openPositions: number;
};

const STRATS = [
  { id: "ema_trend", title: "EMA Trend", tag: "Crypto", text: "4h EMA cross — tested default" },
  { id: "breakout_55", title: "55 Breakout", tag: "Crypto", text: "Break 55-bar high/low + trend" },
  { id: "spy_condor", title: "SPY Condor", tag: "Options", text: "Weekly iron condor on Alpaca" },
  { id: "stock_trail", title: "Stock Trail", tag: "Stocks", text: "Breakout + trailing stop" },
];

function Msg({ r }: { r: Result }) {
  return r ? <div className={`msg ${r.ok ? "ok" : "bad"}`}>{r.message}</div> : null;
}

export function Controls({ account }: { account: AccountView }) {
  const [strategy, setStrategy] = useState(account.strategy || "ema_trend");
  const alpaca = strategy === "spy_condor" || strategy === "stock_trail";
  const [exchange, setExchange] = useState(alpaca ? "alpaca" : account.exchange === "alpaca" ? "bybit" : account.exchange);
  const [mode, setMode] = useState(alpaca ? (account.mode === "live" ? "live" : "testnet") : account.mode === "paper" ? "paper" : account.mode);
  const [saved, save, saving] = useActionState<Result, FormData>(saveSettings, null);
  const [result, setResult] = useState<Result>(null);
  const [busy, start] = useTransition();

  const modes = useMemo(
    () =>
      alpaca
        ? [
            { id: "testnet", title: "Paper", text: "Alpaca fake money" },
            { id: "live", title: "Real", text: "Live Alpaca account" },
          ]
        : [
            { id: "paper", title: "Practice", text: "Fake money · works from this server" },
            { id: "testnet", title: "Testnet", text: "Exchange fake funds" },
            { id: "live", title: "Real", text: "Live futures" },
          ],
    [alpaca],
  );

  const pickStrategy = (id: string) => {
    setStrategy(id);
    const isAlpaca = id === "spy_condor" || id === "stock_trail";
    if (isAlpaca) {
      setExchange("alpaca");
      if (mode === "paper") setMode("testnet");
    } else if (exchange === "alpaca") {
      setExchange("bybit");
      if (mode === "testnet") setMode("paper");
    }
  };

  const run = (fn: () => Promise<Result>, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    start(async () => setResult(await fn()));
  };

  const needsKey = mode !== "paper";
  const keyOk = account.keyCheck === "ok";

  return (
    <div>
      <form action={save}>
        <label>Strategy</label>
        <div className="choice">
          {STRATS.map((s) => (
            <label key={s.id} className={strategy === s.id ? "on" : ""}>
              <input type="radio" name="strategy" value={s.id} checked={strategy === s.id} onChange={() => pickStrategy(s.id)} />
              <b>{s.title} <span className="tag">{s.tag}</span></b>
              <span>{s.text}</span>
            </label>
          ))}
        </div>

        <label>Mode</label>
        <div className="choice">
          {modes.map((m) => (
            <label key={m.id} className={`${mode === m.id ? "on" : ""} ${m.id === "live" ? "real" : ""}`}>
              <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
              <b>{m.title}</b>
              <span>{m.text}</span>
            </label>
          ))}
        </div>

        {!alpaca && (
          <>
            <label htmlFor="exchange">Exchange</label>
            <select id="exchange" name="exchange" value={exchange} onChange={(e) => setExchange(e.target.value)}>
              <option value="bybit">Bybit</option>
              <option value="binance">Binance</option>
            </select>
          </>
        )}
        {alpaca && <input type="hidden" name="exchange" value="alpaca" />}

        {needsKey && (
          <>
            <label htmlFor="apiKey">API key {account.keyHint ? <span className="muted">(saved {account.keyHint})</span> : null}</label>
            <input id="apiKey" name="apiKey" autoComplete="off" spellCheck={false} placeholder="Leave blank to keep saved key" />
            <label htmlFor="secret">API secret</label>
            <input id="secret" name="secret" type="password" autoComplete="new-password" spellCheck={false} />
          </>
        )}
        {mode === "live" && (
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" name="confirmLive" value="yes" />
            I accept real-money risk. Losses are possible.
          </label>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          {account.mode !== "paper" && account.keyHint && <button type="button" disabled={busy} onClick={() => run(testConnection)}>Test</button>}
        </div>
        <Msg r={saved} />
      </form>

      <hr />
      <div className="row">
        {account.enabled ? (
          <button disabled={busy} onClick={() => run(() => setEnabled(false))}>Pause</button>
        ) : (
          <button
            className="go"
            disabled={busy || (account.mode !== "paper" && !keyOk)}
            onClick={() => run(() => setEnabled(true), account.mode === "live" ? "Start with REAL MONEY?" : undefined)}
          >
            Start bot
          </button>
        )}
        <button disabled={busy} onClick={() => run(runNow)}>Check now</button>
        {account.openPositions > 0 && (
          <button className="danger" disabled={busy} onClick={() => run(closeAll, "Close all positions and pause?")}>Close all</button>
        )}
        {account.mode === "paper" && account.exchange !== "alpaca" && account.openPositions === 0 && (
          <button disabled={busy} onClick={() => run(resetPaper, "Reset practice balance?")}>Reset</button>
        )}
      </div>
      <Msg r={result} />
    </div>
  );
}

export function KillSwitchReset() {
  const [busy, start] = useTransition();
  const [r, setR] = useState<Result>(null);
  return (
    <div>
      <button className="danger" disabled={busy} onClick={() => { if (window.confirm("Reset kill switch?")) start(async () => setR(await resetKillSwitch())); }}>
        Reset kill switch
      </button>
      <Msg r={r} />
    </div>
  );
}
