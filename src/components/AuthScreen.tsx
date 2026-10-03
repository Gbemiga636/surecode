"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon, type IconName } from "@/components/Icons";
import { Tilt } from "@/components/Tilt";
import { Typewriter } from "@/components/Typewriter";
import { marketingFonts } from "@/lib/fonts";
import "@/app/marketing.css";

type Mode = "login" | "signup";

const FEATURES: { icon: IconName; title: string; body: string; tone: string }[] = [
  { icon: "shield", title: "Sure codes daily", body: "Safe, Larger and Longshot slips, refreshed twice a day.", tone: "g" },
  { icon: "heart", title: "Track what you like", body: "Like any code and see if it won, lost, and why.", tone: "r" },
  { icon: "wallet", title: "₦100k demo wallet", body: "Practise staking with virtual money. Resets daily.", tone: "o" },
];

const SAMPLE_LEGS: { sport: IconName; match: string; pick: string; odds: string }[] = [
  { sport: "football", match: "Arsenal v Brentford", pick: "Home or draw", odds: "1.22" },
  { sport: "basketball", match: "Lakers v Suns", pick: "Lakers to win", odds: "1.48" },
  { sport: "tennis", match: "Sinner v Ruud", pick: "Sinner to win", odds: "1.30" },
];

const PHRASES = ["Every matchday.", "Across five sports.", "Tracked leg by leg."];

function strength(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return { score: s, label: ["Too short", "Weak", "Okay", "Good", "Strong"][s] };
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isLogin = mode === "login";
  const pw = strength(password);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();

    if (isLogin) {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (err) return setError(err.message);
      router.push("/home");
      router.refresh();
      return;
    }

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (err) return setError(err.message);
    if (data.session) {
      router.push("/home");
      router.refresh();
      return;
    }
    setInfo("Check your email to confirm your account, then log in.");
  }

  return (
    <main className={`mk au ${marketingFonts}`}>
      <div className="mk-mesh" aria-hidden>
        <span className="mk-blob mk-blob-1" />
        <span className="mk-blob mk-blob-2" />
        <span className="mk-blob mk-blob-3" />
        <span className="mk-grid" />
      </div>

      <Link href="/" className="mk-brand au-brand">
        <span className="mk-logo" aria-hidden>
          <Icon name="target" size={16} />
        </span>
        SureCode
      </Link>

      <section className="au-show">
        <div className="au-copy mk-in mk-in-1">
          <p className="mk-pill">
            <Icon name="spark" size={13} /> AI-built multi-sport codes
          </p>
          <h1 className="au-title">
            Smarter slips.
            <span className="mk-type">
              <Typewriter phrases={PHRASES} />
            </span>
          </h1>
          <p className="au-lead">
            Cross-sport codes screened by AI, results tracked leg by leg, and a demo wallet to practise
            before you stake.
          </p>
        </div>

        <Tilt className="au-ticket mk-in mk-in-2" max={12}>
          <div className="au-ticket-head">
            <span className="mk-badge">
              <Icon name="shield" size={12} /> Safe lane
            </span>
            <span className="au-ticket-tag">Sample slip</span>
          </div>
          <p className="au-ticket-code">SC7K2Q</p>
          <ul className="mk-pv-legs">
            {SAMPLE_LEGS.map((l) => (
              <li key={l.match}>
                <span className="mk-leg-ic">
                  <Icon name={l.sport} size={13} />
                </span>
                <span className="mk-leg-body">
                  <strong>{l.match}</strong>
                  <span>{l.pick}</span>
                </span>
                <span className="mk-leg-odds">{l.odds}</span>
              </li>
            ))}
          </ul>
          <div className="mk-pv-foot">
            <span>Total odds</span>
            <strong>2.35</strong>
          </div>
        </Tilt>

        <ul className="au-feats">
          {FEATURES.map((f, i) => (
            <li key={f.title} className={`au-feat mk-in`} style={{ animationDelay: `${260 + i * 90}ms` }}>
              <span className={`au-feat-ic mk-tone-${f.tone}`}>
                <Icon name={f.icon} size={17} />
              </span>
              <span>
                <strong>{f.title}</strong>
                <span>{f.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="au-panel">
        <div className="au-card mk-in mk-in-1">
          <nav className="au-switch" aria-label="Account">
            <Link href="/login" className={isLogin ? "is-on" : ""} aria-current={isLogin ? "page" : undefined}>
              Log in
            </Link>
            <Link href="/signup" className={!isLogin ? "is-on" : ""} aria-current={!isLogin ? "page" : undefined}>
              Sign up
            </Link>
          </nav>

          <h2 className="au-card-title">{isLogin ? "Welcome back" : "Create your account"}</h2>
          <p className="au-card-sub">
            {isLogin ? "Log in to open today’s Sure codes." : "Your demo wallet is ready on day one."}
          </p>

          <form onSubmit={onSubmit} className="au-form">
            <label className="au-field">
              <span className="au-label">Email</span>
              <span className="au-input">
                <Icon name="mail" size={17} />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </span>
            </label>

            <label className="au-field">
              <span className="au-label">Password</span>
              <span className="au-input">
                <Icon name="lock" size={17} />
                <input
                  type={show ? "text" : "password"}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  placeholder={isLogin ? "Your password" : "At least 6 characters"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={isLogin ? undefined : 6}
                  required
                />
                <button
                  type="button"
                  className="au-eye"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  <Icon name={show ? "eyeOff" : "eye"} size={17} />
                </button>
              </span>
            </label>

            {!isLogin && password && (
              <div className={`au-meter au-meter-${pw.score}`} aria-live="polite">
                <span className="au-meter-bars">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={n <= pw.score ? "on" : ""} />
                  ))}
                </span>
                <span className="au-meter-label">{pw.label}</span>
              </div>
            )}

            {error && (
              <p className="au-alert au-alert-bad" role="alert">
                <Icon name="close" size={15} /> {error}
              </p>
            )}
            {info && (
              <p className="au-alert au-alert-ok" role="status">
                <Icon name="mail" size={15} /> {info}
              </p>
            )}

            <button type="submit" className="mk-btn mk-btn-lg mk-btn-shine au-submit" disabled={loading} aria-busy={loading}>
              {loading && <span className="mk-spinner" aria-hidden />}
              {loading ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Log in" : "Create account"}
              {!loading && <Icon name="arrowRight" size={18} className="mk-arrow" />}
            </button>
          </form>

          <ul className="au-trust">
            <li>
              <Icon name="lock" size={14} /> Secure sign-in
            </li>
            <li>
              <Icon name="shield" size={14} /> 18+ only
            </li>
          </ul>
        </div>

        <p className="au-alt">
          {isLogin ? (
            <>
              New here? <Link href="/signup">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href="/login">Log in</Link>
            </>
          )}
        </p>
        <Link href="/" className="au-back">
          <Icon name="chevronLeft" size={14} /> Back to home
        </Link>
      </section>
    </main>
  );
}
