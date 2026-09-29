import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { Icon, type IconName } from "@/components/Icons";
import { Typewriter } from "@/components/Typewriter";
import { HeroSlider, type Slide } from "@/components/HeroSlider";
import { OddsTicker, type TickerItem } from "@/components/OddsTicker";
import { SportRail } from "@/components/SportRail";

export const dynamic = "force-dynamic";

const HERO =
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=2400&q=80";
const PITCH =
  "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1600&q=80";
const COURT =
  "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=1600&q=80";
const TENNIS =
  "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1600&q=80";
const STADIUM =
  "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1600&q=80";
const HOCKEY =
  "https://images.unsplash.com/photo-1515703407324-5f753afd8be8?auto=format&fit=crop&w=1600&q=80";

const HEADLINES = [
  "Safe singles.",
  "Cross-sport stacks.",
  "Multi-day longshots.",
  "Calibrated, not guessed.",
];

const SLIDES: Slide[] = [
  {
    id: "safe",
    kicker: "Safe lane",
    title: "Short favourites, bankroll first",
    body: "Singles and tight doubles around 1.1–1.4, filtered by settled history and odds fit.",
    image: PITCH,
    href: "/signup",
    cta: "See today’s safe codes",
    icon: "shield",
    tone: "green",
  },
  {
    id: "larger",
    kicker: "Larger lane",
    title: "Bigger prices, still favourite-backed",
    body: "EV-style ranking across five sports. Mix basketball with football when the numbers agree.",
    image: COURT,
    href: "/signup",
    cta: "Open the Larger lane",
    icon: "trend",
    tone: "blue",
  },
  {
    id: "longshot",
    kicker: "Longshot lane",
    title: "Multi-day stacks at 3×–10×+",
    body: "Two-to-five day windows, fresh event pool, AI play-out veto on every thin leg.",
    image: TENNIS,
    href: "/signup",
    cta: "Explore longshots",
    icon: "fire",
    tone: "red",
  },
  {
    id: "liked",
    kicker: "Liked codes",
    title: "Track every code you back",
    body: "Like one code or many. See which won, which lost, and the exact game and score that decided it.",
    image: STADIUM,
    href: "/signup",
    cta: "Start tracking",
    icon: "heart",
    tone: "gold",
  },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "bolt", title: "Live SportyBet prices", body: "Crawled across football, basketball, tennis, hockey and baseball." },
  { icon: "brain", title: "AI play-out veto", body: "Multi-leg packs are simulated first; thin legs get dropped." },
  { icon: "heart", title: "Win / loss tracker", body: "Like codes and see what won, what lost, and why." },
  { icon: "layers", title: "Build & edit codes", body: "Pick markets or paste a long code and rebuild it shorter." },
  { icon: "wallet", title: "Practice wallet", body: "Stake virtually and learn the board before real money." },
  { icon: "lock", title: "No guarantees", body: "Every slip ships with risk notes. 18+ and bet responsibly." },
];

async function loadTicker(): Promise<{ items: TickerItem[]; counts: Record<string, number> }> {
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

  const { items, counts } = await loadTicker();

  return (
    <main className="lp">
      <div className="lp-noise" aria-hidden />

      <header className="lp-top">
        <span className="lp-mark">
          <span className="lp-mark-dot" aria-hidden />
          SureCode
        </span>
        <nav className="lp-top-nav" aria-label="Account">
          <Link href="/how" className="lp-top-link">
            How it works
          </Link>
          <Link href="/login" className="lp-top-link">
            Log in
          </Link>
          <Link href="/signup" className="lp-cta-sm">
            Get started
          </Link>
        </nav>
      </header>

      <section className="lp-hero" aria-label="SureCode">
        <div
          className="lp-hero-media lp-kenburns"
          style={{ backgroundImage: `url(${HERO})` }}
          role="img"
          aria-label="Football pitch under floodlights"
        />
        <div className="lp-hero-shade" aria-hidden />
        <div className="lp-hero-glow" aria-hidden />
        <div className="lp-orbs" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="lp-hero-copy">
          <p className="lp-pill lp-anim-1">
            <span className="live-dot" />
            Live odds · 5 sports · 3 profit lanes
          </p>
          <p className="lp-brand lp-anim-1">SureCode</p>
          <h1 className="lp-headline lp-anim-2">
            SportyBet codes built for hit rate.
            <span className="lp-type">
              <Typewriter phrases={HEADLINES} />
            </span>
          </h1>
          <p className="lp-lede lp-anim-3">
            Safe, Larger and Longshot lanes with an AI play-out veto on multi-leg stacks. Codes
            you can open in SportyBet, scored on settled results.
          </p>
          <div className="lp-actions lp-anim-4">
            <Link href="/signup" className="lp-btn-primary lp-btn-glow">
              Open SureCode
              <Icon name="arrowRight" size={18} className="lp-btn-ic" />
            </Link>
            <Link href="/login" className="lp-btn-secondary">
              I have an account
            </Link>
          </div>
          <ul className="lp-hero-stats lp-anim-4" aria-label="At a glance">
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
              <span>profit lanes</span>
            </li>
          </ul>
        </div>
        <div className="lp-hero-scroll" aria-hidden>
          <span />
        </div>
      </section>

      <OddsTicker items={items} label={items.length ? "Today’s legs" : "Live board"} />

      <section className="lp-sports" aria-label="Sports">
        <p className="lp-eyebrow">Multi-sport desk</p>
        <SportRail counts={items.length ? counts : undefined} />
      </section>

      <section className="lp-lanes" aria-label="Profit lanes">
        <article className="lp-lane lp-lane-safe">
          <Icon name="shield" size={26} className="lp-lane-ic" />
          <span className="lp-lane-k">Safe</span>
          <strong>~1.1–1.4</strong>
          <p>Short favourites. Bankroll first.</p>
        </article>
        <article className="lp-lane lp-lane-mid">
          <Icon name="trend" size={26} className="lp-lane-ic" />
          <span className="lp-lane-k">Larger</span>
          <strong>~1.5–2.4</strong>
          <p>Bigger prices. Still favourite-backed.</p>
        </article>
        <article className="lp-lane lp-lane-hot">
          <Icon name="fire" size={26} className="lp-lane-ic" />
          <span className="lp-lane-k">Longshot</span>
          <strong>3×–10×+</strong>
          <p>Multi-day cross-sport stacks.</p>
        </article>
      </section>

      <section className="lp-slider-wrap" aria-label="Inside SureCode">
        <div className="lp-section-head">
          <p className="lp-eyebrow">Inside SureCode</p>
          <h2>One board. Three lanes. Every result tracked.</h2>
        </div>
        <HeroSlider slides={SLIDES} />
      </section>

      <section className="lp-features" aria-label="Features">
        {FEATURES.map((f, i) => (
          <article key={f.title} className="lp-feature" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="lp-feature-ic">
              <Icon name={f.icon} size={22} className="lp-feature-svg" />
            </span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </section>

      <section className="lp-mosaic" aria-label="Sports gallery">
        <div className="lp-mosaic-copy">
          <p className="lp-eyebrow">Mix sports in one slip</p>
          <h2>Football, basketball, tennis, hockey, baseball — one Sure board.</h2>
          <p>
            When the edge is there, legs from different sports go into the same slip. The AI
            play-out step can veto thin accumulators before they reach your board.
          </p>
          <Link href="/signup" className="lp-btn-primary lp-btn-glow">
            Start free
            <Icon name="arrowRight" size={18} className="lp-btn-ic" />
          </Link>
        </div>
        <div className="lp-mosaic-grid" aria-hidden>
          <div className="lp-tile lp-tile-lg" style={{ backgroundImage: `url(${PITCH})` }}>
            <span>
              <Icon name="football" size={14} className="lp-tile-ic" /> Football
            </span>
          </div>
          <div className="lp-tile" style={{ backgroundImage: `url(${COURT})` }}>
            <span>
              <Icon name="basketball" size={14} className="lp-tile-ic" /> Basketball
            </span>
          </div>
          <div className="lp-tile" style={{ backgroundImage: `url(${HOCKEY})` }}>
            <span>
              <Icon name="hockey" size={14} className="lp-tile-ic" /> Ice hockey
            </span>
          </div>
        </div>
      </section>

      <section className="lp-board">
        <div className="lp-board-copy">
          <p className="lp-eyebrow">From crawl to code</p>
          <h2>Every slip ships with analysis.</h2>
          <p>
            The crawler ranks the day’s strongest prices, books SportyBet share codes and attaches
            a full brief, including AI play-out notes on multi-leg packs.
          </p>
        </div>
        <aside className="lp-score" aria-hidden>
          <div className="lp-score-row">
            <span>
              <Icon name="shield" size={14} className="lp-score-ic" /> SAFE
            </span>
            <strong>1.22</strong>
          </div>
          <div className="lp-score-row muted">
            <span>
              <Icon name="trend" size={14} className="lp-score-ic" /> LARGER
            </span>
            <strong>1.96</strong>
          </div>
          <div className="lp-score-row">
            <span>
              <Icon name="fire" size={14} className="lp-score-ic" /> LONGSHOT
            </span>
            <strong>6.40</strong>
          </div>
          <p className="lp-score-note">Illustrative bands, not a live tip.</p>
        </aside>
      </section>

      <section className="lp-cta-band" aria-label="Get started">
        <div>
          <h2>Get today’s board in under a minute.</h2>
          <p>Free account. Practice wallet included. No card needed.</p>
        </div>
        <Link href="/signup" className="lp-btn-light">
          Create account
          <Icon name="arrowRight" size={18} className="lp-btn-ic" />
        </Link>
      </section>

      <footer className="lp-foot">
        <span className="lp-mark">
          <span className="lp-mark-dot" aria-hidden />
          SureCode
        </span>
        <span>18+ only · Not a guarantee · Bet responsibly</span>
      </footer>
    </main>
  );
}
