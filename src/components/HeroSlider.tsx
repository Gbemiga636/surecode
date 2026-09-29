"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icons";

export type Slide = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  image: string;
  href: string;
  cta: string;
  icon?: IconName;
  tone?: "green" | "gold" | "red" | "blue";
};

export function HeroSlider({
  slides,
  intervalMs = 6000,
  variant = "hero",
}: {
  slides: Slide[];
  intervalMs?: number;
  variant?: "hero" | "promo";
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;

  const go = useCallback((i: number) => setActive(((i % count) + count) % count), [count]);

  useEffect(() => {
    if (paused || count < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => go(active + 1), intervalMs);
    return () => window.clearTimeout(t);
  }, [active, paused, count, intervalMs, go]);

  if (count === 0) return null;

  return (
    <section
      className={`hs hs-${variant}`}
      aria-roledescription="carousel"
      aria-label="Highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="hs-track">
        {slides.map((s, i) => (
          <article
            key={s.id}
            className={`hs-slide hs-tone-${s.tone ?? "green"}${i === active ? " is-active" : ""}`}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            aria-hidden={i !== active}
          >
            <div className="hs-media" style={{ backgroundImage: `url(${s.image})` }} />
            <div className="hs-shade" />
            <div className="hs-copy">
              <p className="hs-kicker">
                {s.icon && <Icon name={s.icon} size={15} className="hs-kicker-ic" />}
                {s.kicker}
              </p>
              <h3 className="hs-title">{s.title}</h3>
              <p className="hs-body">{s.body}</p>
              <Link href={s.href} className="hs-cta" tabIndex={i === active ? 0 : -1}>
                {s.cta}
                <Icon name="arrowRight" size={16} className="hs-cta-ic" />
              </Link>
            </div>
          </article>
        ))}
      </div>

      {count > 1 && (
        <>
          <button type="button" className="hs-arrow hs-prev" onClick={() => go(active - 1)} aria-label="Previous slide">
            <Icon name="chevronLeft" size={20} className="hs-arrow-ic" />
          </button>
          <button type="button" className="hs-arrow hs-next" onClick={() => go(active + 1)} aria-label="Next slide">
            <Icon name="chevronRight" size={20} className="hs-arrow-ic" />
          </button>
          <div className="hs-dots" role="tablist" aria-label="Choose slide">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`Slide ${i + 1}: ${s.kicker}`}
                className={`hs-dot${i === active ? " is-active" : ""}`}
                onClick={() => go(i)}
              >
                {i === active && (
                  <span
                    key={`${active}-${paused}`}
                    className={`hs-dot-fill${paused ? " is-paused" : ""}`}
                    style={{ animationDuration: `${intervalMs}ms` }}
                  />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
