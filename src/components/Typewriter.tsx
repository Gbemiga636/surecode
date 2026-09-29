"use client";

import { useEffect, useState } from "react";

export function Typewriter({
  phrases,
  className = "",
  typeMs = 55,
  deleteMs = 28,
  holdMs = 1900,
}: {
  phrases: string[];
  className?: string;
  typeMs?: number;
  deleteMs?: number;
  holdMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced || phrases.length === 0) return;
    const full = phrases[index % phrases.length];

    let delay = deleting ? deleteMs : typeMs;
    if (!deleting && text === full) delay = holdMs;
    else if (deleting && text === "") delay = 320;

    const t = window.setTimeout(() => {
      if (!deleting && text === full) {
        setDeleting(true);
      } else if (deleting && text === "") {
        setDeleting(false);
        setIndex((i) => (i + 1) % phrases.length);
      } else {
        setText(deleting ? full.slice(0, text.length - 1) : full.slice(0, text.length + 1));
      }
    }, delay);
    return () => window.clearTimeout(t);
  }, [text, deleting, index, phrases, reduced, typeMs, deleteMs, holdMs]);

  const shown = reduced ? (phrases[0] ?? "") : text;

  return (
    <span className={`tw ${className}`} aria-label={phrases.join(" ")}>
      <span aria-hidden>{shown}</span>
      <span className="tw-caret" aria-hidden />
    </span>
  );
}
