# What to do now — SureCode + exbot

This is the checklist after the Nov 21, 2026 fixes (Bybit rate limits, stuck Sure board, combo fallback, exbot health UI).

---

## 1. SureCode — get today’s board back

**What was wrong:** Midnight crawls sometimes never finished, so `/home` kept showing the last good day (e.g. 2026-11-14) with “board is being built.”

**What we fixed:** Cron crawls now finish in-request; opening `/home` also rebuilds a missing board (throttled). Combos have a softer fallback so sparse days can still get a combined code when safe legs exist.

### Do this

1. Open **https://surecodev1.vercel.app/home** (signed in).
2. If you still see yesterday’s codes, **wait ~1–2 minutes**, then **hard refresh** (Ctrl+Shift+R).
3. You should see today’s Lagos date in the header and new codes.
4. For Safe mode: look for a **combined code** plus single picks. If only singles appear, that day had no combination that passed the safety filters — singles are still the day’s best legs.

### If the board is still stuck after 5 minutes

1. In Vercel → project → **Logs**, search for `[api/crawl]` or `[home] board recovery`.
2. Confirm `CRON_SECRET` / `CRAWL_SECRET`, `OPENAI_API_KEY`, and Supabase keys are set.
3. Manual rebuild (replace `YOUR_SECRET` with `CRAWL_SECRET` or `CRON_SECRET`):

```text
https://surecodev1.vercel.app/api/crawl?force=1&wait=1
```

Send header: `Authorization: Bearer YOUR_SECRET`  
(or `x-crawl-secret: YOUR_SECRET`)

Then open `/home` again.

---

## 2. exbot (Bybit) — stop rate-limit errors and trade again

**What was wrong:** Each tick hit Bybit too hard (`retCode 10006 Too many visits`), so candles failed and **no trades** opened.

**What we fixed:** Shared public OHLCV cache (~90s), serialized Bybit/Binance GETs, slower ccxt rateLimit, account stagger between ticks, fewer coins/bars, and a clear health strip.

### One-time DB (required for strategies)

In Supabase → SQL editor, re-run `sql/schema-exbot.sql` (adds the `strategy` column). Without it, Save may fail.

### Do this

1. Open **https://surecodev1.vercel.app/exbot** and sign in.
2. Pick one strategy: **EMA Trend** / **55 Breakout** (crypto) or **SPY Condor** / **Stock Trail** (Alpaca).
3. Mode: **Practice** (no key) · **Testnet/Paper** · **Real**.
4. If Testnet/Real: paste key + secret → **Save** → **Test** → must say verified.
5. **Start bot** → **Check now**. Status should be `running · …`, not rate-limit.
6. Ticks ~every **5 minutes**. Crypto entries only on **4h closes**; options near NY close. Quiet days are normal.

### Bybit API key checklist

| Setting | Required |
|---|---|
| Contract / Futures trading | ON |
| Withdraw / Transfer | OFF (refused by the bot) |
| IP whitelist | Prefer unrestricted, or allow Vercel egress (hard); unrestricted is easier |
| Key type | System-generated; copy key **and** secret fully |

**Nigeria tip:** If bybit.com is blocked on your ISP, use the Bybit app / mobile data / DNS 1.1.1.1 to create the key. The **bot trades from our Mumbai server**, not from your phone, once the key is saved.

### If you still see `10006`

1. Wait **2–3 minutes**, then **Check now**.
2. Don’t spam Start/Check — that worsens limits.
3. Confirm only **one** bot instance is using that key (no other scripts).
4. On Bybit, check API usage / security if the key was rotated.

---

## 3. exbot (Alpaca options) — optional, more frequent trades

Crypto EMA can be quiet (~handful of signals per month). Alpaca options aim for **about one SPY iron condor per US trading day** (not a guaranteed win every day).

### Do this

1. On `/exbot` choose **Alpaca** → **Paper trading**.
2. Create a free account at [alpaca.markets](https://alpaca.markets), switch to **Paper**, generate API key + secret.
3. Paper accounts usually already have **options level 3** (needed for iron condors).
4. Save & test key → **Start bot**.
5. Entries run **15:35–15:56 New York** time, only if SPY is above its 200-day average.

**Real money from Nigeria:** Confirm with Alpaca support that your country is eligible before funding live.

**Database (once):** If Alpaca save fails with a DB/check error, re-run `sql/schema-exbot.sql` in the Supabase SQL editor (safe to re-run).

---

## 4. What “working well” looks like

| System | Healthy sign | Not a bug |
|---|---|---|
| SureCode | New codes for **today’s Lagos date** after midnight / after refresh | Some days: singles only, no 2.0 combo |
| exbot crypto | Health: **Watching markets** or **Trading well**; no 10006 spam | Days with **zero** new entries (no EMA cross) |
| exbot Alpaca | Condor order near NY close on uptrend days | Sit-out when SPY is below 200-day MA |

**Honesty:** No setup wins every day. The bots maximize process quality (filters, risk, AI play-out / tested rules). Losses and quiet days still happen.

--

## 5. Quick daily habit

**Morning (Lagos)**  
1. Open `/home` → confirm today’s date + codes.  
2. Open `/exbot` → health strip green/amber, not red rate-limit.  
3. If paused by mistake → **Start bot**.

**If something looks wrong**  
1. `/exbot` → **Check now** and read **Activity**.  
2. `/home` → hard refresh; wait 2 minutes if recovering.  
3. Server reachability: https://surecodev1.vercel.app/api/exbot/health  
   Expect `"region":"bom1"` and Bybit/Binance/Alpaca reachable.

---

## 6. About that YouTube video

[I Turned Claude Into a 24/7 Stock Trader](https://youtu.be/gQVup8_ZTUs) is an **Alpaca stock** desk (rule book + ~55-day breakout style), not the current Bybit crypto EMA bot or SPY iron-condor bot.

- **Use now:** steps 1–5 above (fix what is already live).  
- **Later (optional):** we can add a separate Alpaca **stock** mode with a rules file like that video — say if you want that next.

---

## 7. One-page cheat sheet

| Goal | Action |
|---|---|
| Today’s football codes | Open `/home`, wait/refresh if stale |
| Bybit trading again | `/exbot` → verify key → Start → Check now |
| Kill rate-limit spam | Don’t spam Check; wait 2–3 min; one key only |
| More frequent trades | Alpaca **Paper** on `/exbot` |
| Enable Alpaca in DB | Re-run `sql/schema-exbot.sql` once |
| Server / exchanges OK? | `/api/exbot/health` → region `bom1`, exchanges ok |

That’s everything you need to operate both systems day to day.
