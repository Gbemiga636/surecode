"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data.session) {
      router.push("/home");
      router.refresh();
      return;
    }
    setInfo("Check your email to confirm, then log in.");
  }

  return (
    <main className="auth-shell">
      <aside className="auth-aside">
        <p className="auth-aside-brand">SureCode</p>
        <p className="auth-aside-copy">
          Sure AI trains on settled SportyBet legs so today’s codes lean toward hit rate — not hype.
        </p>
      </aside>
      <section className="auth-panel">
        <Link href="/" className="auth-back">
          ← Back
        </Link>
        <h1 className="auth-title">Create account</h1>
        <p className="auth-sub">Start with Sure codes and a free demo wallet.</p>
        <form onSubmit={onSubmit} className="auth-form">
          <label>
            Email
            <input
              className="sc-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              className="sc-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          {info && <p className="auth-info">{info}</p>}
          <button type="submit" className="sc-btn" disabled={loading}>
            {loading ? "Creating…" : "Get started"}
          </button>
        </form>
        <p className="auth-alt">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </section>
    </main>
  );
}
