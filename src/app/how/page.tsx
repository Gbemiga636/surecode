import Link from "next/link";
import { BgFx } from "@/components/PitchArt";

const HERO =
  "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=2000&q=80";

export default function HowPage() {
  return (
    <main className="relative min-h-dvh">
      <BgFx />
      <section className="relative min-h-[44vh] overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{ backgroundImage: `url(${HERO})` }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(245,245,247,0.85) 50%, #f5f5f7 100%), radial-gradient(ellipse 70% 50% at 70% 10%, rgba(13,159,110,0.12), transparent 55%)",
          }}
        />
        <div className="relative z-10 mx-auto flex min-h-[44vh] max-w-app flex-col justify-end px-6 pb-10">
          <Link href="/" className="text-sm font-bold text-[var(--accent)]">
            ← SureCode
          </Link>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-[-0.04em] text-[var(--ink)] sm:text-5xl">
            How it works
          </h1>
        </div>
      </section>

      <ol className="relative z-10 mx-auto max-w-app space-y-8 px-6 py-12 text-[var(--muted)]">
        <li className="sc-card p-6">
          <strong className="font-display text-xl text-[var(--ink)]">1. We scan SportyBet</strong>
          <p className="mt-2 leading-relaxed">
            A scheduled crawler pulls live fixtures and odds, then scores short-priced safe markets
            and value edges.
          </p>
        </li>
        <li className="sc-card p-6">
          <strong className="font-display text-xl text-[var(--ink)]">2. AI builds openable codes</strong>
          <p className="mt-2 leading-relaxed">
            Legs become real SportyBet share codes. Predictions, expert, value, combos, and analysis
            all book the same way.
          </p>
        </li>
        <li className="sc-card p-6">
          <strong className="font-display text-xl text-[var(--ink)]">3. You open or demo</strong>
          <p className="mt-2 leading-relaxed">
            Tap Open on SportyBet, copy the code, or stake virtual ₦. Past codes keep a simple
            hit/miss history.
          </p>
        </li>
      </ol>
      <p className="relative z-10 mx-auto max-w-app px-6 pb-16 text-sm text-[var(--muted)]">
        High-confidence is not a guarantee. 18+ · responsible gambling.
      </p>
    </main>
  );
}
