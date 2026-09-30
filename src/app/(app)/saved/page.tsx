import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { sportyOpenUrl } from "@/lib/sporty";
import { SavePrefsForm } from "@/components/SavePrefsForm";
import { LikeToggle } from "@/components/LikedCodes";
import { CopyButton } from "@/components/CopyButton";
import { Icon, type IconName } from "@/components/Icons";

const ORIGIN_ICON: Record<string, IconName> = {
  expert: "brain",
  predictions: "chart",
  combos: "layers",
  builder: "layers",
  edit: "link",
  value: "gem",
  picks: "target",
};

function originIcon(origin: string | null): IconName {
  const o = String(origin ?? "").toLowerCase();
  return Object.entries(ORIGIN_ICON).find(([k]) => o.includes(k))?.[1] ?? "ticket";
}

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: prefs }, { data: saved }, { data: generated }] = await Promise.all([
    supabase.from(T.preferences).select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from(T.savedPicks)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from(T.generatedCodes)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const codes = generated ?? [];
  const picks = saved ?? [];
  const topOdds = codes.reduce((m, g) => Math.max(m, Number(g.total_odds ?? 0)), 0);
  const origins = new Set(codes.map((g) => String(g.origin ?? "custom"))).size;

  const stats: { icon: IconName; label: string; value: string }[] = [
    { icon: "ticket", label: "Codes booked", value: String(codes.length) },
    { icon: "bookmark", label: "Saved picks", value: String(picks.length) },
    { icon: "fire", label: "Top odds", value: topOdds ? `${topOdds.toFixed(2)}×` : "—" },
    { icon: "layers", label: "Tools used", value: String(origins) },
  ];

  return (
    <div className="sv">
      <header className="dh-hero sc-rise">
        <div className="dh-hero-copy">
          <p className="sc-page-kicker">
            <Icon name="bookmark" size={13} className="dh-kicker-ic" /> Your locker
          </p>
          <h2 className="dh-title">
            Saved &amp; <span className="dh-title-grad">generated.</span>
          </h2>
          <p className="dh-sub">Every code you booked and every pick you kept, in one place.</p>
        </div>
        <ul className="dh-stats" aria-label="Saved summary">
          {stats.map((s) => (
            <li key={s.label} className="dh-stat">
              <span className="dh-stat-ic">
                <Icon name={s.icon} size={18} />
              </span>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="sv-layout">
        <div className="sv-main">
          <section>
            <div className="sv-head">
              <h3>
                <Icon name="ticket" size={18} /> Booked codes
              </h3>
              <Link href="/liked" className="sv-link">
                Track results in Liked <Icon name="arrowRight" size={14} />
              </Link>
            </div>

            {!codes.length && (
              <div className="sv-empty">
                <span className="sv-empty-ic">
                  <Icon name="ticket" size={26} />
                </span>
                <p className="sv-empty-t">No booked codes yet</p>
                <p>Build one in Build combos, Edit long codes or Predictions and it lands here.</p>
              </div>
            )}

            <div className="sv-grid">
              {codes.map((g, i) => (
                <article
                  key={g.id}
                  className="sv-code sc-rise"
                  style={{ animationDelay: `${Math.min(i, 9) * 40}ms` }}
                >
                  <div className="sv-code-top">
                    <span className="sv-origin">
                      <Icon name={originIcon(g.origin)} size={13} />
                      {g.origin || "Custom"}
                    </span>
                    <span className="sv-when">{g.created_at ? ago(g.created_at) : ""}</span>
                  </div>
                  <p className="sv-code-val">{g.code}</p>
                  <div className="sv-code-odds">
                    <span>Total odds</span>
                    <strong>{g.total_odds != null ? Number(g.total_odds).toFixed(2) : "—"}</strong>
                  </div>
                  <div className="sv-code-actions">
                    <LikeToggle target={{ code: g.code, lane: g.origin }} />
                    <CopyButton text={g.code} />
                    <a
                      className="sc-btn-ghost text-xs"
                      href={g.share_url || sportyOpenUrl(g.code)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon name="external" size={13} /> Open
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section>
            <div className="sv-head">
              <h3>
                <Icon name="bookmark" size={18} /> Saved picks
              </h3>
            </div>
            {!picks.length && (
              <div className="sv-empty sv-empty-sm">
                <p>No saved picks yet. Bookmark a pick from Picks or Predictions to keep it here.</p>
              </div>
            )}
            <div className="sv-picks">
              {picks.map((s) => (
                <div key={s.id} className="sv-pick">
                  <span className="sv-pick-ic">
                    <Icon name="football" size={16} />
                  </span>
                  <span className="sv-pick-body">
                    <strong>
                      {s.home} <em>vs</em> {s.away}
                    </strong>
                    <span>{s.pick}</span>
                  </span>
                  <span className="sv-pick-odds">{s.odds != null ? Number(s.odds).toFixed(2) : "—"}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="sv-side">
          <SavePrefsForm
            initial={{
              game_type: prefs?.game_type ?? "result",
              min_confidence: Number(prefs?.min_confidence ?? 0.55),
              max_odds: Number(prefs?.max_odds ?? 5),
            }}
          />
        </aside>
      </div>
    </div>
  );
}
