"use client";

/** Animated goal net + flying ball for Sure home hero. */
export function GoalBurst({ className = "" }: { className?: string }) {
  return (
    <div className={`goal-burst ${className}`} aria-hidden>
      <svg className="goal-frame" viewBox="0 0 280 160" fill="none">
        <path
          d="M20 150 V28 H260 V150"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          opacity=".45"
        />
        <path d="M20 28 H260" stroke="currentColor" strokeWidth="4" opacity=".55" />
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={40 + i * 36}
            y1="32"
            x2={40 + i * 36}
            y2="150"
            stroke="currentColor"
            strokeWidth="1"
            opacity=".14"
          />
        ))}
        {Array.from({ length: 4 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1="20"
            y1={50 + i * 24}
            x2="260"
            y2={50 + i * 24}
            stroke="currentColor"
            strokeWidth="1"
            opacity=".14"
          />
        ))}
      </svg>
      <div className="score-ball">
        <svg viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="url(#gb)" />
          <path
            d="M40 22 L52 32 L48 48 L32 48 L28 32 Z"
            fill="#0a3d26"
            opacity=".9"
          />
          <defs>
            <radialGradient id="gb" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="55%" stopColor="#9fd9b8" />
              <stop offset="100%" stopColor="#0f6b3f" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <span className="goal-flash">GOAL!</span>
      <span className="confetti c1" />
      <span className="confetti c2" />
      <span className="confetti c3" />
      <span className="confetti c4" />
      <span className="confetti c5" />
    </div>
  );
}

export function SportChip({
  sport,
}: {
  sport?: string | null;
}) {
  const label = sport || "Sport";
  const emoji =
    /basket/i.test(label)
      ? "🏀"
      : /tennis/i.test(label)
        ? "🎾"
        : /hockey|ice/i.test(label)
          ? "🏒"
          : /baseball/i.test(label)
            ? "⚾"
            : "⚽";
  return (
    <span className="sport-chip">
      <span aria-hidden>{emoji}</span> {label}
    </span>
  );
}
