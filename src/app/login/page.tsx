"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { SoccerBall, BgFx } from "@/components/PitchArt";
import { Icon } from "@/components/Icons";

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
    <main className="relative grid min-h-dvh lg:grid-cols-2">
      <BgFx />
      <aside className="sc-auth-aside relative hidden overflow-hidden border-r border-[var(--line)] lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <SoccerBall />
        </div>
        <div className="relative z-10">
          <p className="font-display text-4xl font-extrabold tracking-[-0.04em]">
            SureCode <em className="not-italic text-[var(--accent)]">AI</em>
          </p>
          <p className="mt-3 max-w-sm text-[var(--muted)] leading-relaxed">
            Clean codes. Sharp odds. A demo wallet when you want to practice first.
          </p>
        </div>
      </aside>

      <section className="relative z-10 flex flex-col justify-center px-6 py-14 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--primary)]">
            <Icon name="bolt" size={16} /> SureCode
          </Link>
          <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-[var(--muted)]">Log in for today’s sure codes and your demo wallet.</p>
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
            <button type="submit" disabled={loading} className="sc-btn w-full">
              {loading ? "Signing in…" : "Log in"}
            </button>
          </form>
          <p className="mt-5 text-sm text-[var(--muted)]">
            No account?{" "}
            <Link href="/signup" className="font-bold text-[var(--accent)]">
              Sign up
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
