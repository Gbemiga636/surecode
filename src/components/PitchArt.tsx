/** Floating 3D football (pitch-green palette). */
export function SoccerBall({ className = "" }: { className?: string }) {
  return (
    <div className={`ball3d ${className}`} aria-hidden>
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="scBshade" cx="34%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#e8f7ee" />
            <stop offset="75%" stopColor="#7bc9a0" />
            <stop offset="100%" stopColor="#0f6b3f" />
          </radialGradient>
          <radialGradient id="scBglow" cx="34%" cy="26%" r="42%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity=".95" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="94" fill="url(#scBshade)" />
        <g fill="#0a3d26" opacity=".92">
          <path d="M100 74 L124 92 L115 120 L85 120 L76 92 Z" />
          <path d="M40 62 L58 52 L70 66 L60 84 L42 82 Z" opacity=".8" />
          <path d="M138 40 L158 46 L160 66 L142 74 L128 58 Z" opacity=".82" />
          <path d="M28 128 L46 122 L56 138 L44 154 L28 148 Z" opacity=".72" />
          <path d="M150 122 L168 116 L176 132 L166 148 L148 142 Z" opacity=".7" />
          <path d="M86 168 L112 168 L118 184 L92 190 L80 182 Z" opacity=".6" />
        </g>
        <g stroke="#0a3d26" strokeWidth="3" fill="none" opacity=".55" strokeLinecap="round">
          <path d="M100 74 L96 46" />
          <path d="M124 92 L150 78" />
          <path d="M115 120 L136 140" />
          <path d="M85 120 L62 138" />
          <path d="M76 92 L52 80" />
        </g>
        <ellipse cx="70" cy="56" rx="34" ry="24" fill="url(#scBglow)" />
        <circle cx="100" cy="100" r="94" fill="none" stroke="#0f6b3f" strokeOpacity=".45" strokeWidth="2" />
      </svg>
    </div>
  );
}

/** Decorative goal frame behind content. */
export function GoalPosts({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`goalposts ${className}`}
      viewBox="0 0 320 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M28 188 V48 H292 V188"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".35"
      />
      <path d="M28 48 H292" stroke="currentColor" strokeWidth="5" opacity=".5" />
      {/* net grid */}
      {Array.from({ length: 7 }).map((_, i) => (
        <line
          key={`v${i}`}
          x1={48 + i * 32}
          y1="52"
          x2={48 + i * 32}
          y2="188"
          stroke="currentColor"
          strokeWidth="1"
          opacity=".12"
        />
      ))}
      {Array.from({ length: 5 }).map((_, i) => (
        <line
          key={`h${i}`}
          x1="28"
          y1={70 + i * 24}
          x2="292"
          y2={70 + i * 24}
          stroke="currentColor"
          strokeWidth="1"
          opacity=".12"
        />
      ))}
      <circle cx="160" cy="188" r="10" fill="currentColor" opacity=".2" />
    </svg>
  );
}

export function BgFx() {
  return (
    <div className="bgfx" aria-hidden>
      <i className="b1" />
      <i className="b2" />
      <i className="b3" />
    </div>
  );
}
