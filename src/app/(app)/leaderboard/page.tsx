import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { T } from "@/lib/db";
import { Icon } from "@/components/Icons";

type Wallet = {
  user_id: string;
  balance: number;
  staked: number;
  returned: number;
  reset_day: string | null;
};

type Row = Wallet & { rank: number; profit: number; roi: number | null; handle: string; hue: number; you: boolean };

const naira = (n: number) => `₦${Math.round(Math.abs(n)).toLocaleString("en-NG")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${naira(n)}`;

function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ row, size = 40 }: { row: Row; size?: number }) {
  return (
    <span
      className="lg-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${row.hue} 80% 58%), hsl(${(row.hue + 40) % 360} 75% 38%))`,
      }}
      aria-hidden
    >
      {row.you ? "You" : row.handle.slice(-2)}
    </span>
  );
}

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let reader: typeof supabase | ReturnType<typeof createAdminClient> = supabase;
  try {
    reader = createAdminClient();
  } catch {
    /* RLS may limit this to the signed-in wallet */
  }

  const { data } = await reader
    .from(T.demoWallets)
    .select("user_id, balance, staked, returned, reset_day")
    .order("returned", { ascending: false })
    .limit(200);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const all = (data ?? []) as Wallet[];
  const active = all.filter((w) => w.reset_day === today && Number(w.staked) > 0);
  const isToday = active.length > 0;
  const pool = isToday ? active : all.filter((w) => Number(w.staked) > 0);

  const rows: Row[] = pool
    .map((w) => {
      const staked = Number(w.staked);
      const returned = Number(w.returned);
      const id = String(w.user_id);
      return {
        ...w,
        staked,
        returned,
        profit: returned - staked,
        roi: staked ? ((returned - staked) / staked) * 100 : null,
        handle: `Player ${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
        hue: hue(id),
        you: id === user?.id,
        rank: 0,
      };
    })
    .sort((a, b) => b.profit - a.profit || b.returned - a.returned)
    .slice(0, 50)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const me = rows.find((r) => r.you);
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean) as Row[];
  const rest = rows.slice(3);
  const maxRoi = Math.max(1, ...rows.map((r) => Math.abs(r.roi ?? 0)));

  return (
    <div className="lg">
      <section className="lg-hero sc-rise">
        <div className="lg-hero-copy">
          <p className="lg-kicker">
            <Icon name="trophy" size={13} /> {isToday ? "Today’s demo league" : "Demo league"}
          </p>
          <h2 className="lg-title">
            Top of <span className="lg-title-grad">the table.</span>
          </h2>
          <p className="lg-sub">
            Ranked by demo profit. Wallets reset every midnight, so every day is a fresh race.
          </p>
          <div className="lg-hero-meta">
            <span>
              <Icon name="users" size={14} /> {rows.length} player{rows.length === 1 ? "" : "s"}
            </span>
            <span>
              <Icon name="wallet" size={14} /> Virtual ₦ only
            </span>
          </div>
        </div>

        <div className={`lg-me${me ? "" : " is-empty"}`}>
          <p className="lg-me-k">Your position</p>
          {me ? (
            <>
              <p className="lg-me-rank">
                #{me.rank}
                <span>of {rows.length}</span>
              </p>
              <div className="lg-me-grid">
                <span>
                  <em>P/L</em>
                  <strong className={me.profit >= 0 ? "up" : "down"}>{signed(me.profit)}</strong>
                </span>
                <span>
                  <em>ROI</em>
                  <strong>{me.roi != null ? `${me.roi.toFixed(0)}%` : "—"}</strong>
                </span>
                <span>
                  <em>Staked</em>
                  <strong>{naira(me.staked)}</strong>
                </span>
              </div>
            </>
          ) : (
            <p className="lg-me-empty">
              Place a demo stake to join today’s table.
              <Link href="/demo" className="lg-me-cta">
                Open demo wallet <Icon name="arrowRight" size={14} />
              </Link>
            </p>
          )}
        </div>
      </section>

      {!rows.length && (
        <div className="lg-empty">
          <span className="lg-empty-ic">
            <Icon name="trophy" size={30} />
          </span>
          <p className="lg-empty-t">The table is empty</p>
          <p>Be the first on the board: stake a Sure code from your demo wallet.</p>
        </div>
      )}

      {podium.length > 0 && (
        <section className="lg-podium" aria-label="Top three">
          {podium.map((r) => (
            <div key={r.user_id} className={`lg-step lg-step-${r.rank}${r.you ? " is-you" : ""}`}>
              <span className="lg-medal">
                <Icon name={r.rank === 1 ? "trophy" : "medal"} size={r.rank === 1 ? 22 : 18} />
              </span>
              <Avatar row={r} size={r.rank === 1 ? 64 : 52} />
              <p className="lg-step-name">{r.you ? "You" : r.handle}</p>
              <p className={`lg-step-pl ${r.profit >= 0 ? "up" : "down"}`}>{signed(r.profit)}</p>
              <p className="lg-step-roi">ROI {r.roi != null ? `${r.roi.toFixed(0)}%` : "—"}</p>
              <div className="lg-block">
                <span>{r.rank}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {rest.length > 0 && (
        <section className="lg-table" aria-label="Rankings">
          <div className="lg-thead">
            <span>Rank</span>
            <span>Player</span>
            <span>ROI</span>
            <span className="lg-num">Staked</span>
            <span className="lg-num">P/L</span>
          </div>
          {rest.map((r, i) => (
            <div
              key={r.user_id}
              className={`lg-row sc-rise${r.you ? " is-you" : ""}`}
              style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
            >
              <span className="lg-rank">{r.rank}</span>
              <span className="lg-player">
                <Avatar row={r} size={34} />
                <span>
                  <strong>{r.you ? "You" : r.handle}</strong>
                  <em>Returned {naira(r.returned)}</em>
                </span>
              </span>
              <span className="lg-roi">
                <span className="lg-roi-bar">
                  <span
                    className={(r.roi ?? 0) >= 0 ? "up" : "down"}
                    style={{ width: `${(Math.abs(r.roi ?? 0) / maxRoi) * 100}%` }}
                  />
                </span>
                <em>{r.roi != null ? `${r.roi.toFixed(0)}%` : "—"}</em>
              </span>
              <span className="lg-num">{naira(r.staked)}</span>
              <span className={`lg-num lg-pl ${r.profit >= 0 ? "up" : "down"}`}>{signed(r.profit)}</span>
            </div>
          ))}
        </section>
      )}

      <p className="lg-foot">
        Demo wallets only. No real money moves and practice results don’t guarantee future ones. 18+.
      </p>
    </div>
  );
}
