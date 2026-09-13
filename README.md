# SureCode

Straightforward SportyBet **sure codes of the day**: login → openable booking codes → past history → demo wallet.

This folder is **fully independent** of the parent Sporty monorepo. It has its own `package.json`, Netlify config, Supabase project, and crawler. Do not add it to the parent `pnpm-workspace.yaml`.

---

## 1. Supabase setup

1. Create a **new** Supabase project.
2. Open **SQL Editor** → New query.
3. Paste and run the entire file: [`sql/schema.sql`](sql/schema.sql).  
   All tables use the **`sc_` prefix** (`sc_sure_codes`, `sc_demo_wallets`, …) so they coexist safely on a shared Supabase database.  
   The file ends with `notify pgrst, 'reload schema'` so the API sees new tables immediately.
4. **Authentication → Providers**: enable Email.
5. (Recommended) **Authentication → URL configuration**: add your site URL and `https://YOUR_SITE/auth/callback`.

Copy these into `surecode/.env.local` (from [`.env.example`](.env.example)):

| Variable | Where |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` (server/crawl only) |
| `CRAWL_SECRET` | Any long random string you invent |
| `OPENAI_API_KEY` | Optional — richer slip explanations |

---

## 2. External APIs you need

### Required
- **Supabase** — auth + Postgres (above).

### Built-in (no key)
- **SportyBet** public APIs:
  - Upcoming fixtures: `factsCenter/pcUpcomingEvents`
  - Create share code: `POST /api/ng/orders/share`
  - Event / score: `factsCenter/event`

### Strongly recommended
- **OpenAI** (or OpenRouter via `OPENAI_BASE_URL`) — AI rationale text only. The sure-code engine still works without it.

### Optional later
- Telegram / Reddit / SerpAPI — scrape community codes into history.
- Paystack — paid plans (not in MVP).

---

## 3. Local run

```bash
cd surecode
npm install
cp .env.example .env.local
# fill .env.local with Supabase keys

npm run dev
```

Open http://localhost:3000 → Sign up → Home.

Generate today’s codes (needs service role key):

```bash
npm run crawl
```

Or:

```bash
curl -X POST http://localhost:3000/api/crawl -H "Authorization: Bearer YOUR_CRAWL_SECRET"
```

---

## 4. Netlify (separate site) — go-live checklist

1. Create a **new** Netlify site (not the parent Sporty site).
2. Base directory: `surecode` if the repo still contains the parent monorepo.
3. Build command: `npm run build` (plugin `@netlify/plugin-nextjs` is in `netlify.toml`).
4. Node **20** (set via `netlify.toml` / `.nvmrc`).
5. Set **all** env vars in Netlify → Site settings → Environment variables:

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (crawl) |
| `NEXT_PUBLIC_SITE_URL` | Yes (`https://YOUR_SITE.netlify.app`) |
| `CRAWL_SECRET` | Yes |
| `OPENAI_API_KEY` | Recommended |
| `CRAWL_BUDGET_MS` | Default `20000` (Pro). Use `8000` on Free. |

6. In **Supabase → Authentication → URL configuration**:
   - Site URL = your Netlify URL
   - Redirect URLs include `https://YOUR_SITE.netlify.app/auth/callback`
7. Run both SQL files once: `schema.sql` then `schema-features.sql`.
8. After first deploy, trigger a crawl:
   ```bash
   curl -X POST "https://YOUR_SITE.netlify.app/api/crawl" \
     -H "Authorization: Bearer YOUR_CRAWL_SECRET"
   ```
9. Scheduled function `crawl-sure` runs every **20 minutes**.  
   - **Pro** plan: `timeout = 26` works with the budgeted crawler.  
   - **Free** plan: functions stop at ~10s — set `CRAWL_BUDGET_MS=8000` or upgrade.

Install the Next plugin on first deploy if Netlify prompts:

```bash
npm install -D @netlify/plugin-nextjs
```

**Reliability notes (already in code):**
- App pages prefer **cached pick pools** from the crawler (no SportyBet call on every page view).
- Crawl uses a **soft deadline** so Netlify functions finish instead of timing out hard.
- Auth callback uses `NEXT_PUBLIC_SITE_URL` / `x-forwarded-host` so redirects work behind Netlify.
---

## 5. Separate GitHub later

From this folder only:

```bash
cd surecode
git init
git add .
git commit -m "Initial SureCode"
gh repo create surecode --private --source=. --push
```

Or keep it inside the parent repo until you are ready to split.

---

## Product map

| Route | Purpose |
|-------|---------|
| `/` | Landing |
| `/login` `/signup` | Auth |
| `/home` | Sure codes of the day |
| `/codes` | Plenty of SAFE/VALUE/AI/COMBO codes |
| `/predictions` | AI prediction tips → book |
| `/expert` | Expert picks (1X2 / safe / goals / BTTS) |
| `/value` | Value / edge picks |
| `/combos` | Ready-made accumulators |
| `/analysis` | De-vigged match analysis board |
| `/past` | History + settle outcomes |
| `/demo` | Virtual wallet + AI auto slips |
| `/leaderboard` | Demo returns ranking |
| `/saved` | Preferences + generated codes |
| `/how` | Plain-language explanation |
| `POST /api/book` | Create SportyBet share code |
| `POST /api/demo/bet` | Demo stake (code or picks) |
| `POST /api/crawl` | Manual crawl (Bearer `CRAWL_SECRET`) |

### Extra SQL (features)
After [`sql/schema.sql`](sql/schema.sql), also run [`sql/schema-features.sql`](sql/schema-features.sql) for `sc_codes`, `sc_pick_pools`, `sc_generated_codes`, preferences, saved picks.

---

## Honesty

Labels like “sure” mean **high-confidence short-priced markets**, not guaranteed wins. UI includes a responsible-gambling reminder. 18+ only.
