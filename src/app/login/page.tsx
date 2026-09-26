"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push("/home");
    router.refresh();
  }

  return (
    <main className="auth-shell">
      <aside className="auth-aside">
        <p className="auth-aside-brand">SureCode</p>
        <p className="auth-aside-copy">
          Open today’s Sure codes, build custom slips, and practice with a virtual wallet.
        </p>
      </aside>
      <section className="auth-panel">
        <Link href="/" className="auth-back">
          ← Back
        </Link>
        <h1 className="auth-title">Log in</h1>
        <p className="auth-sub">Continue to your Sure desk.</p>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="sc-btn" disabled={loading}>
            {loading ? "Signing in…" : "Log in"}
          </button>
        </form>
        <p className="auth-alt">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
