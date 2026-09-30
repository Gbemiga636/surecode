"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon, type IconName } from "@/components/Icons";

type Mode = "login" | "signup";

const FEATURES: { icon: IconName; title: string; body: string; tone: string }[] = [
  { icon: "shield", title: "Sure codes daily", body: "Safe, Larger and Longshot slips, refreshed twice a day.", tone: "g" },
  { icon: "heart", title: "Track what you like", body: "Like any code and see if it won, lost, and why.", tone: "r" },
  { icon: "wallet", title: "₦100k demo wallet", body: "Practice staking with virtual money. Resets daily.", tone: "y" },
];

const SAMPLE_LEGS: { sport: IconName; match: string; pick: string; odds: string }[] = [
  { sport: "football", match: "Arsenal v Brentford", pick: "Home or draw", odds: "1.22" },
  { sport: "basketball", match: "Lakers v Suns", pick: "Lakers to win", odds: "1.48" },
  { sport: "tennis", match: "Sinner v Ruud", pick: "Sinner to win", odds: "1.30" },
];

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
    <main className="ax">
      <div className="ax-bg" aria-hidden>
        <span className="ax-orb ax-orb-1" />
        <span className="ax-orb ax-orb-2" />
        <span className="ax-pitch" />
      </div>

      <section className="ax-show">
        <Link href="/" className="ax-brand">
          <span className="ax-mark">
            <Icon name="target" size={20} />
          </span>
          SureCode
        </Link>

        <div className="ax-copy">
          <p className="ax-kicker">
            <Icon name="spark" size={13} /> AI-built multi-sport codes
          </p>
          <h1 className="ax-title">
            Smarter slips.
            <span className="ax-title-grad">Every matchday.</span>
          </h1>
          <p className="ax-lead">
            Cross-sport codes screened by AI, results tracked leg by leg, and a demo wallet to
            practise before you stake.
          </p>
        </div>

        <div className="ax-ticket" aria-label="Sample slip">
          <div className="ax-ticket-head">
            <span className="ax-ticket-lane">
              <Icon name="shield" size={13} /> Safe lane
            </span>
            <span className="ax-ticket-tag">Sample slip</span>
          </div>
          <p className="ax-ticket-code">SC7K2Q</p>
          <ul className="ax-ticket-legs">
            {SAMPLE_LEGS.map((l) => (
              <li key={l.match}>
                <span className="ax-leg-ic">
                  <Icon name={l.sport} size={14} />
                </span>
                <span className="ax-leg-body">
                  <strong>{l.match}</strong>
                  <span>{l.pick}</span>
                </span>
                <span className="ax-leg-odds">{l.odds}</span>
              </li>
            ))}
          </ul>
          <div className="ax-ticket-foot">
            <span>Total odds</span>
            <strong>2.35</strong>
          </div>
        </div>

        <ul className="ax-feats">
          {FEATURES.map((f, i) => (
            <li key={f.title} className={`ax-feat ax-feat-${f.tone}`} style={{ animationDelay: `${150 + i * 90}ms` }}>
              <span className="ax-feat-ic">
                <Icon name={f.icon} size={18} />
              </span>
              <span>
                <strong>{f.title}</strong>
                <span>{f.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ax-panel">
        <div className="ax-card">
          <nav className="ax-switch" aria-label="Account">
            <Link href="/login" className={isLogin ? "is-on" : ""} aria-current={isLogin ? "page" : undefined}>
              Log in
            </Link>
            <Link href="/signup" className={!isLogin ? "is-on" : ""} aria-current={!isLogin ? "page" : undefined}>
              Sign up
            </Link>
          </nav>

          <span className="ax-card-ic">
            <Icon name={isLogin ? "lock" : "star"} size={22} />
          </span>
          <h2 className="ax-card-title">{isLogin ? "Welcome back" : "Create your account"}</h2>
          <p className="ax-card-sub">
            {isLogin ? "Log in to open today’s Sure codes." : "Free to join. Your demo wallet is ready on day one."}
          </p>

          <form onSubmit={onSubmit} className="ax-form">
            <label className="ax-field">
              <span className="ax-label">Email</span>
              <span className="ax-input">
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

            <label className="ax-field">
              <span className="ax-label">Password</span>
              <span className="ax-input">
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
                  className="ax-eye"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  <Icon name={show ? "eyeOff" : "eye"} size={17} />
                </button>
              </span>
            </label>

            {!isLogin && password && (
              <div className={`ax-meter ax-meter-${pw.score}`} aria-live="polite">
                <span className="ax-meter-bars">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={n <= pw.score ? "on" : ""} />
                  ))}
                </span>
                <span className="ax-meter-label">{pw.label}</span>
              </div>
            )}

            {error && (
              <p className="ax-alert ax-alert-bad" role="alert">
                <Icon name="close" size={15} /> {error}
              </p>
            )}
            {info && (
              <p className="ax-alert ax-alert-ok" role="status">
                <Icon name="mail" size={15} /> {info}
              </p>
            )}

            <button type="submit" className="ax-submit" disabled={loading}>
              {loading ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Log in" : "Create account"}
              {!loading && <Icon name="arrowRight" size={18} />}
            </button>
          </form>

          <ul className="ax-trust">
            <li>
              <Icon name="lock" size={14} /> Secure sign-in
            </li>
            <li>
              <Icon name="wallet" size={14} /> No card needed
            </li>
            <li>
              <Icon name="shield" size={14} /> 18+ only
            </li>
          </ul>
        </div>

        <p className="ax-alt">
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
        <Link href="/" className="ax-back">
          <Icon name="chevronLeft" size={14} /> Back to home
        </Link>
      </section>
    </main>
  );
}
