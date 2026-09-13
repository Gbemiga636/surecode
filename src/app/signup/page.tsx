"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { SoccerBall, BgFx } from "@/components/PitchArt";
import { Icon } from "@/components/Icons";

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
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
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
    <main className="relative grid min-h-dvh lg:grid-cols-2">
      <BgFx />
      <aside className="sc-auth-aside relative hidden overflow-hidden border-r border-[var(--line)] lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-90">
          <SoccerBall />
        </div>
        <div className="relative z-10">
          <p className="font-display text-4xl font-extrabold tracking-[-0.04em]">SureCode</p>
          <p className="mt-3 max-w-sm leading-relaxed text-[var(--muted)]">
            One account. Sure codes, predictions, expert slips, demo bank.
          </p>
        </div>
      </aside>

      <section className="relative z-10 flex flex-col justify-center px-6 py-14 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
            <Icon name="bolt" size={16} /> SureCode
          </Link>
          <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight">Create account</h1>
          <p className="mt-2 text-[var(--muted)]">Start in under a minute.</p>
          <form onSubmit={onSubmit} className="sc-card mt-8 space-y-4 p-6">
            <label className="block text-sm font-semibold">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="sc-input"
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="sc-input"
              />
            </label>
            {error && <p className="text-sm text-[var(--bad)]">{error}</p>}
            {info && <p className="text-sm text-[var(--primary)]">{info}</p>}
            <button type="submit" disabled={loading} className="sc-btn w-full">
              {loading ? "Creating…" : "Sign up"}
            </button>
          </form>
          <p className="mt-5 text-sm text-[var(--muted)]">
            Already have an account?{" "}
            <Link href="/login" className="font-bold text-[var(--accent)]">
              Log in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
