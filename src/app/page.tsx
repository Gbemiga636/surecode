import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { Icon, type IconName } from "@/components/Icons";
import { sportIcon, type TickerItem } from "@/components/OddsTicker";
import { Reveal } from "@/components/Reveal";
import { Tilt } from "@/components/Tilt";
import { Typewriter } from "@/components/Typewriter";
import { marketingFonts } from "@/lib/fonts";
import "./marketing.css";

export const dynamic = "force-dynamic";

const PITCH =
  "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1400&q=75";
const COURT =
  "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=900&q=75";
const TENNIS =
  "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=900&q=75";

const HEADLINES = ["Safe singles.", "Cross-sport stacks.", "Multi-day longshots.", "Calibrated, not guessed."];

const SPORTS: { key: string; label: string }[] = [
  { key: "football", label: "Football" },
  { key: "basketball", label: "Basketball" },
  { key: "tennis", label: "Tennis" },
  { key: "hockey", label: "Ice hockey" },
  { key: "baseball", label: "Baseball" },
];

const LANES: { icon: IconName; name: string; band: string; body: string; risk: number; tone: string }[] = [
  { icon: "shield", name: "Safe", band: "1.1 – 1.4", body: "Short favourites and tight doubles. Built to protect your bankroll.", risk: 1, tone: "safe" },
  { icon: "trend", name: "Larger", band: "1.5 – 4.5", body: "Bigger prices, still favourite-backed, mixed across sports when the numbers agree.", risk: 2, tone: "larger" },
  { icon: "fire", name: "Longshot", band: "3× – 8×", body: "Multi-day cross-sport stacks. Higher payout, higher variance, so stake small.", risk: 3, tone: "long" },
];

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "pulse", title: "We scan the market", body: "Live SportyBet prices across five sports are crawled twice a day and scored against settled history." },
  { icon: "brain", title: "AI builds the slips", body: "Legs are ranked, combined into lanes, and every multi-leg pack is played out by AI before it’s booked." },
  { icon: "ticket", title: "You open the code", body: "Each slip becomes a real SportyBet booking code. Open it, copy it, or practise with the demo wallet." },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "bolt", title: "Live prices", body: "Football, basketball, tennis, hockey and baseball." },
  { icon: "brain", title: "AI play-out veto", body: "Thin legs are dropped before a slip reaches you." },
  { icon: "heart", title: "Win and loss tracker", body: "Like codes and see what won, what lost, and why." },
  { icon: "layers", title: "Build and edit", body: "Choose markets, or paste a long code and shorten it." },
  { icon: "wallet", title: "Demo wallet", body: "₦100k of virtual money, reset every day." },
  { icon: "chart", title: "Full track record", body: "Every past code stays in the archive with its result." },
];

const SAMPLE: TickerItem[] = [
  { match: "Arsenal v Brentford", pick: "Home or draw", odds: 1.22, sport: "football" },
  { match: "Lakers v Suns", pick: "Lakers to win", odds: 1.48, sport: "basketball" },
  { match: "Sinner v Ruud", pick: "Sinner to win", odds: 1.3, sport: "tennis" },
  { match: "Rangers v Bruins", pick: "Over 4.5 goals", odds: 1.36, sport: "hockey" },
  { match: "Yankees v Red Sox", pick: "Yankees to win", odds: 1.55, sport: "baseball" },
];

async function loadBoard(): Promise<{ items: TickerItem[]; counts: Record<string, number> }> {
  const counts: Record<string, number> = {};
  try {
    const sb = createAdminClient();
    const { data } = await sb.from(T.sureCodes).select("legs").eq("day", lagosDay()).limit(12);
    const items: TickerItem[] = [];
    for (const row of data ?? []) {
      const legs = (row as { legs?: { home: string; away: string; pickLabel: string; odds: number; sport?: string }[] }).legs;
      for (const l of legs ?? []) {
        const sport = l.sport ?? "football";
        counts[sport] = (counts[sport] ?? 0) + 1;
        items.push({ match: `${l.home} v ${l.away}`, pick: l.pickLabel, odds: l.odds, sport });
      }
    }
    return { items: items.slice(0, 24), counts };
  } catch {
    return { items: [], counts };
  }
}

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/home");

  const { items, counts } = await loadBoard();
  const live = items.length >= 3;
  const preview = (live ? items : SAMPLE).slice(0, 3);
  const previewOdds = preview.reduce((a, l) => a * l.odds, 1);
  const ticker = live ? items : SAMPLE;
  const loop = [...ticker, ...ticker];

  return (
    <div className={`mk ${marketingFonts}`}>
      <div className="mk-mesh" aria-hidden>
        <span className="mk-blob mk-blob-1" />
        <span className="mk-blob mk-blob-2" />
        <span className="mk-blob mk-blob-3" />
        <span className="mk-blob mk-blob-4" />
        <span className="mk-grid" />
      </div>

      <header className="mk-nav">
        <div className="mk-wrap mk-nav-inner">
          <Link href="/" className="mk-brand">
            <span className="mk-logo" aria-hidden>
              <Icon name="target" size={16} />
            </span>
            SureCode
          </Link>
          <nav className="mk-links" aria-label="Site">
            <Link href="/how" className="mk-link mk-link-how">
              How it works
            </Link>
            <Link href="/login" className="mk-link">
              Log in
            </Link>
            <Link href="/signup" className="mk-btn mk-btn-sm">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mk-wrap mk-hero">
          <div className="mk-hero-copy">
            <p className="mk-pill mk-in mk-in-1">
              <span className="mk-dot" aria-hidden /> Live odds · 5 sports · 9 codes a day
            </p>
            <h1 className="mk-h1 mk-in mk-in-2">
              SportyBet codes, built for hit rate.
              <span className="mk-type">
                <Typewriter phrases={HEADLINES} />
              </span>
            </h1>
            <p className="mk-lede mk-in mk-in-3">
              SureCode scans live prices, builds Safe, Larger and Longshot slips with AI, and hands you
              a code you can open in SportyBet in one tap.
            </p>
            <div className="mk-cta mk-in mk-in-4">
              <Link href="/signup" className="mk-btn mk-btn-lg mk-btn-shine">
                Open SureCode
                <Icon name="arrowRight" size={17} className="mk-arrow" />
              </Link>
              <Link href="/login" className="mk-btn-glass mk-btn-lg">
                I have an account
              </Link>
            </div>
            <ul className="mk-stats mk-in mk-in-5" aria-label="At a glance">
              <li>
                <strong>5</strong>
                <span>sports crawled</span>
              </li>
              <li>
                <strong>9</strong>
                <span>codes a day</span>
              </li>
              <li>
                <strong>3</strong>
                <span>risk lanes</span>
              </li>
            </ul>
          </div>

          <div className="mk-stage mk-in mk-in-3" aria-label="Product preview">
            <Tilt className="mk-scene" max={12}>
              <div className="mk-pv">
                <div className="mk-pv-bar">
                  <span className="mk-pv-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="mk-pv-url">surecode · Today’s board</span>
                </div>
                <div className="mk-pv-body">
                  <div className="mk-pv-tabs" aria-hidden>
                    <span className="is-on">
                      <Icon name="shield" size={13} /> Safe
                    </span>
                    <span>
                      <Icon name="trend" size={13} /> Larger
                    </span>
                    <span>
                      <Icon name="fire" size={13} /> Longshot
                    </span>
                  </div>
                  <div className="mk-pv-card">
                    <div className="mk-pv-top">
                      <span className="mk-badge">
                        <Icon name="star" size={11} /> Top Safe pick
                      </span>
                      <span className="mk-pv-conf">74% model</span>
                    </div>
                    <p className="mk-pv-code">SC7K2Q</p>
                    <ul className="mk-pv-legs">
                      {preview.map((l) => (
                        <li key={l.match}>
                          <span className="mk-leg-ic">
                            <Icon name={sportIcon(l.sport)} size={13} />
                          </span>
                          <span className="mk-leg-body">
                            <strong>{l.match}</strong>
                            <span>{l.pick}</span>
                          </span>
                          <span className="mk-leg-odds">{l.odds.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mk-pv-foot">
                      <span>Total odds</span>
                      <strong>{previewOdds.toFixed(2)}</strong>
                    </div>
                    <span className="mk-pv-open">
                      <Icon name="external" size={13} /> Open in SportyBet
                    </span>
                  </div>
                </div>
              </div>

              <div className="mk-float mk-float-1" aria-hidden>
                <span className="mk-float-ic mk-tone-g">
                  <Icon name="check" size={14} />
                </span>
                <span>
                  <strong>Leg won</strong>
                  <em>Arsenal 2–0</em>
                </span>
              </div>
              <div className="mk-float mk-float-2" aria-hidden>
                <span className="mk-float-ic mk-tone-b">
                  <Icon name="brain" size={14} />
                </span>
                <span>
                  <strong>AI play-out</strong>
                  <em>Thin leg dropped</em>
                </span>
              </div>
              <div className="mk-float mk-float-3" aria-hidden>
                <span className="mk-float-ic mk-tone-o">
                  <Icon name="fire" size={14} />
                </span>
                <span>
                  <strong>Longshot</strong>
                  <em>6.40× stack</em>
                </span>
              </div>
            </Tilt>
          </div>
        </section>

        <div className="mk-wrap">
          <div className="mk-ticker" role="marquee" aria-label="Today’s legs">
            <span className="mk-ticker-badge">
              <span className="mk-dot" aria-hidden />
              {live ? "On today’s board" : "Live board"}
            </span>
            <div className="mk-ticker-view">
              <ul className="mk-ticker-track" style={{ animationDuration: `${Math.max(28, ticker.length * 6)}s` }}>
                {loop.map((it, i) => (
                  <li key={i} aria-hidden={i >= ticker.length}>
                    <Icon name={sportIcon(it.sport)} size={14} />
                    <span className="mk-tk-match">{it.match}</span>
                    <span className="mk-tk-pick">{it.pick}</span>
                    <strong>{it.odds.toFixed(2)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <ul className="mk-sports" aria-label="Sports covered">
            {SPORTS.map((s, i) => (
              <Reveal as="li" key={s.key} className="mk-sport" delay={i * 60}>
                <span className="mk-sport-ic">
                  <Icon name={sportIcon(s.key)} size={20} />
                </span>
                <span className="mk-sport-t">{s.label}</span>
                {live && <span className="mk-sport-n">{counts[s.key] ?? 0}</span>}
              </Reveal>
            ))}
          </ul>
        </div>

        <section className="mk-wrap mk-section" aria-labelledby="lanes-h">
          <Reveal className="mk-intro">
            <p className="mk-eyebrow">Three lanes</p>
            <h2 id="lanes-h" className="mk-h2">
              Choose your risk. <span className="mk-grad">We do the analysis.</span>
            </h2>
          </Reveal>
          <div className="mk-lanes">
            {LANES.map((l, i) => (
              <Reveal key={l.name} delay={i * 90}>
                <Tilt className={`mk-lane mk-lane-${l.tone}`} max={9}>
                  <span className="mk-lane-ic">
                    <Icon name={l.icon} size={20} />
                  </span>
                  <h3>{l.name}</h3>
                  <p className="mk-lane-band">{l.band}</p>
                  <p className="mk-lane-body">{l.body}</p>
                  <div className="mk-risk" aria-label={`Risk level ${l.risk} of 3`}>
                    <span>Risk</span>
                    {[1, 2, 3].map((n) => (
                      <i key={n} className={n <= l.risk ? "on" : ""} />
                    ))}
                  </div>
                </Tilt>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mk-band" aria-labelledby="how-h">
          <div className="mk-wrap mk-section">
            <Reveal className="mk-intro">
              <p className="mk-eyebrow">How it works</p>
              <h2 id="how-h" className="mk-h2">
                From live prices to <span className="mk-grad">a code you can open.</span>
              </h2>
            </Reveal>
            <ol className="mk-steps">
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.title} className="mk-step" delay={i * 110}>
                  <span className="mk-step-no">{i + 1}</span>
                  <span className="mk-step-ic">
                    <Icon name={s.icon} size={18} />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className="mk-wrap mk-section" aria-labelledby="feat-h">
          <Reveal className="mk-intro">
            <p className="mk-eyebrow">Everything in one place</p>
            <h2 id="feat-h" className="mk-h2">
              Built for people who check <span className="mk-grad">the board every day.</span>
            </h2>
          </Reveal>
          <div className="mk-features">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} className="mk-feature" delay={(i % 3) * 80}>
                <span className="mk-feature-ic">
                  <Icon name={f.icon} size={19} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mk-wrap mk-section mk-gallery" aria-labelledby="sports-h">
          <Reveal className="mk-gallery-copy">
            <p className="mk-eyebrow">Multi-sport</p>
            <h2 id="sports-h" className="mk-h2">
              Five sports. <span className="mk-grad">One board.</span>
            </h2>
            <p className="mk-p">
              When the edge is there, football, basketball and tennis legs go into the same slip. When it
              isn’t, they don’t. Every leg is checked against settled results first.
            </p>
            <Link href="/signup" className="mk-text-link">
              See today’s board <Icon name="arrowRight" size={15} />
            </Link>
          </Reveal>
          <Reveal className="mk-mosaic" delay={100}>
            <Tilt className="mk-tile mk-tile-lg" max={6}>
              <img src={PITCH} alt="Floodlit football pitch" loading="lazy" decoding="async" />
              <span className="mk-tile-cap">
                <Icon name="football" size={13} /> Football
              </span>
            </Tilt>
            <Tilt className="mk-tile" max={8}>
              <img src={COURT} alt="Basketball court" loading="lazy" decoding="async" />
              <span className="mk-tile-cap">
                <Icon name="basketball" size={13} /> Basketball
              </span>
            </Tilt>
            <Tilt className="mk-tile" max={8}>
              <img src={TENNIS} alt="Tennis court" loading="lazy" decoding="async" />
              <span className="mk-tile-cap">
                <Icon name="tennis" size={13} /> Tennis
              </span>
            </Tilt>
          </Reveal>
        </section>

        <section className="mk-wrap mk-section">
          <Reveal className="mk-cta-panel">
            <span className="mk-cta-orb mk-cta-orb-1" aria-hidden />
            <span className="mk-cta-orb mk-cta-orb-2" aria-hidden />
            <div className="mk-cta-copy">
              <h2>Get today’s board in under a minute.</h2>
              <p>Demo wallet included. Every code tracked leg by leg.</p>
            </div>
            <Link href="/signup" className="mk-btn-light mk-btn-lg">
              Create account
              <Icon name="arrowRight" size={17} className="mk-arrow" />
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="mk-foot">
        <div className="mk-wrap mk-foot-inner">
          <span className="mk-brand">
            <span className="mk-logo" aria-hidden>
              <Icon name="target" size={14} />
            </span>
            SureCode
          </span>
          <nav className="mk-foot-links" aria-label="Footer">
            <Link href="/how">How it works</Link>
            <Link href="/login">Log in</Link>
            <Link href="/signup">Sign up</Link>
          </nav>
          <p>18+ only. Codes are analysis, not guarantees. Bet responsibly.</p>
        </div>
      </footer>
    </div>
  );
}
