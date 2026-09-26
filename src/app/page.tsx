import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const HERO =
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=2400&q=80";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/home");

  return (
    <main className="lp">
      <header className="lp-top">
        <span className="lp-mark">SureCode</span>
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
          className="lp-hero-media"
          style={{ backgroundImage: `url(${HERO})` }}
          role="img"
          aria-label="Football pitch under floodlights"
        />
        <div className="lp-hero-shade" aria-hidden />
        <div className="lp-hero-copy">
          <p className="lp-brand">SureCode</p>
          <h1 className="lp-headline">SportyBet codes built for hit rate.</h1>
          <p className="lp-lede">
            Trained Sure AI scans live markets across sports, then books openable codes — Safe
            singles or Larger sure, your call.
          </p>
          <div className="lp-actions">
            <Link href="/signup" className="lp-btn-primary">
              Open SureCode
            </Link>
            <Link href="/login" className="lp-btn-secondary">
              I have an account
            </Link>
          </div>
        </div>
      </section>

      <section className="lp-strip" aria-label="What you get">
        <div className="lp-strip-item">
          <span className="lp-strip-k">01</span>
          <h2>Sure codes</h2>
          <p>Short singles or bigger favourite-backed slips — scored from live odds + settled history.</p>
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

      <section className="lp-board">
        <div className="lp-board-copy">
          <p className="lp-eyebrow">Multi-sport desk</p>
          <h2>Football, basketball, tennis, hockey, baseball — one Sure board.</h2>
          <p>
            The crawler ranks the day’s strongest prices, books SportyBet share codes, and attaches
            a full analysis brief on every slip.
          </p>
          <Link href="/signup" className="lp-btn-primary">
            Start free
          </Link>
        </div>
        <aside className="lp-score" aria-hidden>
          <div className="lp-score-row">
            <span>SAFE</span>
            <strong>1.22</strong>
          </div>
          <div className="lp-score-row muted">
            <span>BOOST</span>
            <strong>1.96</strong>
          </div>
          <div className="lp-score-row">
            <span>SPORTS</span>
            <strong>5</strong>
          </div>
          <p className="lp-score-note">Illustrative odds bands — not a live tip.</p>
        </aside>
      </section>

      <footer className="lp-foot">
        <span>SureCode</span>
        <span>18+ only · Not a guarantee · Bet responsibly</span>
      </footer>
    </main>
  );
}
