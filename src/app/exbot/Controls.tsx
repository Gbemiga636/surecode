"use client";

import { useActionState, useState, useTransition } from "react";
import { closeAll, resetKillSwitch, resetPaper, runNow, saveSettings, setEnabled, testConnection, type Result } from "./actions";

export type AccountView = {
  exchange: string;
  mode: string;
  enabled: boolean;
  keyHint: string | null;
  keyCheck: string | null;
  paperStart: number;
  openPositions: number;
};

const EXCHANGES = [
  { id: "bybit", title: "Bybit", text: "Crypto · USDT perpetuals" },
  { id: "binance", title: "Binance", text: "Crypto · USDT-M futures" },
  { id: "alpaca", title: "Alpaca", text: "US options · SPY iron condors", tag: "new" },
];

const MODES: Record<string, { id: string; title: string; text: string }[]> = {
  crypto: [
    { id: "paper", title: "Practice", text: "Live prices, simulated 10,000 USDT. No key needed." },
    { id: "testnet", title: "Testnet", text: "The exchange's test account with fake funds." },
    { id: "live", title: "Real money", text: "Trades your real futures balance." },
  ],
  alpaca: [
    { id: "testnet", title: "Paper trading", text: "Your free Alpaca paper account ($100k fake money, real quotes). Needs a paper key." },
    { id: "live", title: "Real money", text: "Trades options in your funded Alpaca account." },
  ],
};

const KEY_HELP: Record<string, Record<string, string>> = {
  bybit: {
    testnet: "Create a key at testnet.bybit.com, under API. Permissions: Read-Write, Contract trading. No withdrawals.",
    live: "On bybit.com, go to API and create a system-generated key. Permissions: Read-Write, Contract trading only. Leave Withdraw and Transfer OFF.",
  },
  binance: {
    testnet: "Create a key at testnet.binancefuture.com (log in, then the API Key tab).",
    live: "On binance.com, go to API Management and create a key. Enable Futures only and leave Enable Withdrawals OFF. Futures trading must be activated on the account.",
  },
  alpaca: {
    testnet: "Sign up free at alpaca.markets (any country, email only for paper). In the dashboard switch to your Paper account, then Home → API Keys → Generate. Paper accounts already have options level 3.",
    live: "Live accounts need Alpaca approval for your country (ask support@alpaca.markets if Nigeria isn't listed) and options level 3 (Account → Options trading). Then switch to Live → API Keys → Generate. API keys can't withdraw money.",
  },
};

const modeTitle = (exchange: string, mode: string) =>
  (exchange === "alpaca" ? MODES.alpaca : MODES.crypto).find((m) => m.id === mode)?.title || mode;

function Msg({ r }: { r: Result }) {
  return r ? <div className={`msg ${r.ok ? "ok" : "bad"}`}>{r.message}</div> : null;
}

export function Controls({ account }: { account: AccountView }) {
  const [exchange, setExchange] = useState(account.exchange);
  const [mode, setMode] = useState(account.exchange === "alpaca" && account.mode === "paper" ? "testnet" : account.mode);
  const [saved, save, saving] = useActionState<Result, FormData>(saveSettings, null);
  const [result, setResult] = useState<Result>(null);
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<Result>, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    start(async () => setResult(await fn()));
  };
  const modes = exchange === "alpaca" ? MODES.alpaca : MODES.crypto;
  const pickExchange = (id: string) => {
    setExchange(id);
    if (id === "alpaca" && mode === "paper") setMode("testnet");
  };
  const needsKey = mode !== "paper";
  const keyOk = account.keyCheck === "ok";
  const sameKeyEnv = account.keyHint && exchange === account.exchange && account.mode !== "paper" && (account.mode === "testnet") === (mode === "testnet");
  const name = EXCHANGES.find((e) => e.id === exchange)?.title || exchange;

  return (
    <div>
      <form action={save}>
        <label>Market</label>
        <div className="choice">
          {EXCHANGES.map((e) => (
            <label key={e.id} className={exchange === e.id ? "on" : ""}>
              <input type="radio" name="exchange" value={e.id} checked={exchange === e.id} onChange={() => pickExchange(e.id)} />
              <b>{e.title} {e.tag && <span className="tag">{e.tag}</span>}</b>
              <span>{e.text}</span>
            </label>
          ))}
        </div>

        <label>How do you want to trade?</label>
        <div className="choice">
          {modes.map((m) => (
            <label key={m.id} className={`${mode === m.id ? "on" : ""} ${m.id === "live" ? "real" : ""}`}>
              <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
              <b>{m.title}</b>
              <span>{m.text}</span>
            </label>
          ))}
        </div>

        {needsKey && (
          <>
            <p className="small muted" style={{ margin: "12px 0 0" }}>{KEY_HELP[exchange]?.[mode]}</p>
            {exchange !== "alpaca" && (
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                Site won&apos;t open (for example in Nigeria)? Some internet providers block {exchange}.com. Use the official {name} app on mobile data,
                or set your device&apos;s DNS to 1.1.1.1 (Cloudflare) or 8.8.8.8 (Google), then try again. The bot itself trades from our server, so the block does not affect it once the key is saved.
              </p>
            )}
            <label htmlFor="apiKey">API key {sameKeyEnv ? <span className="muted">(saved {account.keyHint}; leave blank to keep it)</span> : null}</label>
            <input id="apiKey" name="apiKey" autoComplete="off" spellCheck={false} />
            <label htmlFor="secret">API secret</label>
            <input id="secret" name="secret" type="password" autoComplete="new-password" spellCheck={false} />
            <p className="small muted" style={{ margin: "6px 0 0" }}>Keys are encrypted on the server and never shown again.{exchange !== "alpaca" && " Keys that can withdraw funds are refused."}</p>
          </>
        )}
        {mode === "live" && (
          <label className="check" style={{ marginTop: 14 }}>
            <input type="checkbox" name="confirmLive" value="yes" />
            I understand this trades my real money, that losses are possible (including losing days and losing months), and that past results do not guarantee future ones.
          </label>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="primary" disabled={saving}>{saving ? "Checking…" : needsKey ? "Save & test key" : "Save"}</button>
          {account.mode !== "paper" && account.keyHint && <button type="button" disabled={busy} onClick={() => run(testConnection)}>Test connection</button>}
        </div>
        <Msg r={saved} />
      </form>

      <hr />
      <p className="small muted">
        Active: <b>{EXCHANGES.find((e) => e.id === account.exchange)?.title || account.exchange}</b> · <b>{modeTitle(account.exchange, account.mode)}</b>
        {account.mode !== "paper" && <> · key {account.keyHint || "none"} · {keyOk ? <span className="pos">verified</span> : <span className="neg">{account.keyCheck || "not tested"}</span>}</>}
      </p>
      <div className="row">
        {account.enabled ? (
          <button disabled={busy} onClick={() => run(() => setEnabled(false))}>Pause (keep managing positions)</button>
        ) : (
          <button
            className="go"
            disabled={busy || (account.mode !== "paper" && !keyOk)}
            onClick={() => run(() => setEnabled(true), account.mode === "live" ? "Start trading with REAL MONEY?" : undefined)}
          >
            Start bot
          </button>
        )}
        <button disabled={busy} onClick={() => run(runNow)}>Check now</button>
        {account.openPositions > 0 && (
          <button className="danger" disabled={busy} onClick={() => run(closeAll, "Close every open position and pause the bot?")}>
            Close all &amp; pause
          </button>
        )}
        {account.mode === "paper" && account.exchange !== "alpaca" && account.openPositions === 0 && (
          <button disabled={busy} onClick={() => run(resetPaper, `Reset the practice balance to ${account.paperStart} USDT?`)}>Reset practice balance</button>
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
      <button
        className="danger"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Reset the kill switch and allow new trades again?")) start(async () => setR(await resetKillSwitch()));
        }}
      >
        Reset kill switch
      </button>
      <Msg r={r} />
    </div>
  );
}
