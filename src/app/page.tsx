import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const HERO =
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=2400&q=80";
const PITCH =
  "https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=1600&q=80";
const COURT =
  "https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&w=1200&q=80";
const TENNIS =
  "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1200&q=80";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/home");

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
        <div className="lp-hero-copy">
          <p className="lp-brand lp-anim-1">SureCode</p>
          <h1 className="lp-headline lp-anim-2">SportyBet codes built for hit rate.</h1>
          <p className="lp-lede lp-anim-3">
            Live odds across five sports. Safe, Larger, and Longshot lanes — AI play-out veto on
            multi-leg stacks. Openable SportyBet codes, not vibes.
          </p>
          <div className="lp-actions lp-anim-4">
            <Link href="/signup" className="lp-btn-primary">
              Open SureCode
            </Link>
            <Link href="/login" className="lp-btn-secondary">
              I have an account
            </Link>
          </div>
        </div>
        <div className="lp-hero-scroll" aria-hidden>
          <span />
        </div>
      </section>

      <section className="lp-lanes" aria-label="Profit lanes">
        <article className="lp-lane">
          <span className="lp-lane-k">Safe</span>
          <strong>~1.1–1.4</strong>
          <p>Short favourites. Bankroll first.</p>
        </article>
        <article className="lp-lane">
          <span className="lp-lane-k">Larger</span>
          <strong>~1.5–2.4</strong>
          <p>Bigger prices. Still favourite-backed.</p>
        </article>
        <article className="lp-lane lp-lane-hot">
          <span className="lp-lane-k">Longshot</span>
          <strong>3×–10×+</strong>
          <p>Multi-day cross-sport stacks.</p>
        </article>
      </section>

      <section className="lp-strip" aria-label="What you get">
        <div className="lp-strip-item">
          <span className="lp-strip-k">01</span>
          <h2>Sure codes</h2>
          <p>Scored from live SportyBet prices + settled history — then booked as share codes.</p>
        </div>
        <div className="lp-strip-item">
          <span className="lp-strip-k">02</span>
          <h2>Build & edit</h2>
          <p>Pick markets like Over 0.5 or corners, or paste a long code and rebuild it shorter.</p>
        </div>
        <div className="lp-strip-item">
          <span className="lp-strip-k">03</span>
          <h2>Practice wallet</h2>
          <p>Stake virtually, track results, and learn the board before you risk real money.</p>
        </div>
      </section>

      <section className="lp-mosaic" aria-label="Sports">
        <div className="lp-mosaic-copy">
          <p className="lp-eyebrow">Multi-sport desk</p>
          <h2>Football, basketball, tennis, hockey, baseball — one Sure board.</h2>
          <p>
            Mix sports in a single slip when the edge is there. AI play-out can veto thin
            accumulators before they hit your desk.
          </p>
          <Link href="/signup" className="lp-btn-primary">
            Start free
          </Link>
        </div>
        <div className="lp-mosaic-grid" aria-hidden>
          <div className="lp-tile lp-tile-lg" style={{ backgroundImage: `url(${PITCH})` }}>
            <span>Football</span>
          </div>
          <div className="lp-tile" style={{ backgroundImage: `url(${COURT})` }}>
            <span>Basketball</span>
          </div>
          <div className="lp-tile" style={{ backgroundImage: `url(${TENNIS})` }}>
            <span>Tennis</span>
          </div>
        </div>
      </section>

      <section className="lp-board">
        <div className="lp-board-copy">
          <p className="lp-eyebrow">From crawl to code</p>
          <h2>Every slip ships with analysis.</h2>
          <p>
            The crawler ranks the day’s strongest prices, books SportyBet share codes, and attaches
            a full brief — including AI play-out notes on multi-leg packs.
          </p>
        </div>
        <aside className="lp-score" aria-hidden>
          <div className="lp-score-row">
            <span>SAFE</span>
            <strong>1.22</strong>
          </div>
          <div className="lp-score-row muted">
            <span>LARGER</span>
            <strong>1.96</strong>
          </div>
          <div className="lp-score-row">
            <span>LONGSHOT</span>
            <strong>6.40</strong>
          </div>
          <p className="lp-score-note">Illustrative bands — not a live tip.</p>
        </aside>
      </section>

      <footer className="lp-foot">
        <span>SureCode</span>
        <span>18+ only · Not a guarantee · Bet responsibly</span>
      </footer>
    </main>
  );
}
