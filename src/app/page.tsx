import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SoccerBall, BgFx } from "@/components/PitchArt";

const HERO =
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=2400&q=80";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/home");

  return (
    <main className="sc-hero-stage">
      <BgFx />
      <div className="sc-hero-img" style={{ backgroundImage: `url(${HERO})` }} aria-hidden />
      <div className="sc-hero-veil" aria-hidden />

      <div className="pointer-events-none absolute right-[6%] top-[18%] z-[2] hidden md:block">
        <span
          className="hero-ring"
          style={{
            right: "auto",
            left: "50%",
            top: "50%",
            marginTop: 0,
            transform: "translate(-50%, -50%)",
          }}
        />
        <SoccerBall />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-[72rem] flex-col justify-end px-6 pb-16 pt-10 sm:px-10 sm:pb-24">
        <p className="font-display text-[clamp(3.4rem,12vw,7.5rem)] font-extrabold leading-[0.92] tracking-[-0.05em] text-[var(--ink)]">
          SureCode
        </p>
        <h1 className="mt-5 max-w-lg font-display text-xl font-semibold leading-snug tracking-[-0.02em] text-[var(--ink)] sm:text-2xl">
          Today’s SportyBet codes — refined, openable, ready.
        </h1>
        <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-[var(--muted)] sm:text-base">
          High-confidence slips with AI scouting, expert picks, and a demo wallet. Built to feel as
          sharp as the brands you already trust.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/signup" className="sc-btn-flood">
            Get started
          </Link>
          <Link href="/login" className="sc-btn-ghost">
            Log in
          </Link>
        </div>
        <p className="mt-12 text-xs font-medium tracking-wide text-[var(--muted)]">
          18+ only · Not a guarantee · Bet responsibly
        </p>
      </div>
    </main>
  );
}
