/** Shared line icons (same 24-grid family as Sporty Value Pick). */
export type IconName =
  | "dashboard"
  | "bot"
  | "calendar"
  | "target"
  | "gem"
  | "pulse"
  | "layers"
  | "bookmark"
  | "wallet"
  | "chart"
  | "link"
  | "brain"
  | "heart"
  | "trophy"
  | "menu"
  | "close"
  | "bolt"
  | "copy"
  | "external"
  | "shield";

const PATHS: Record<IconName, string> = {
  dashboard: `<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>`,
  bot: `<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1.2"/><path d="M9 13v1.5M15 13v1.5"/><path d="M2 13v3M22 13v3"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M16 3v4M8 3v4M3 10h18"/>`,
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>`,
  gem: `<path d="M6 3h12l3.5 6L12 21 2.5 9Z"/><path d="M2.5 9h19"/><path d="M12 21 8.5 9 11 3M12 21l3.5-12L13 3"/>`,
  pulse: `<path d="M3 12h3.5l2.5-7 4 14 2.5-7H21"/>`,
  layers: `<path d="m12 3 9 4.5-9 4.5-9-4.5Z"/><path d="m3 12.5 9 4.5 9-4.5"/><path d="m3 17 9 4.5 9-4.5"/>`,
  bookmark: `<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.2L5 21V4a1 1 0 0 1 1-1Z"/>`,
  wallet: `<path d="M21 11V7.5a1.5 1.5 0 0 0-1.5-1.5H5.5A2.5 2.5 0 0 1 5.5 1H19"/><path d="M3 3.5v15A2.5 2.5 0 0 0 5.5 21h14a1.5 1.5 0 0 0 1.5-1.5V16"/><path d="M17.5 11H21a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3.5a2.5 2.5 0 0 1 0-5Z"/>`,
  chart: `<path d="M4 20V10M10 20V4M16 20v-6M22 20H2"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.1.1l3-3a5 5 0 0 0-7.1-7.1L11.3 4.7"/><path d="M14 11a5 5 0 0 0-7.1-.1l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>`,
  brain: `<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5v.4A3 3 0 0 0 5 12a3 3 0 0 0 1 5.2v.3A3.5 3.5 0 0 0 9.5 21H12V3Z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5v.4a3 3 0 0 1 1 5.1 3 3 0 0 1-1 5.2v.3a3.5 3.5 0 0 1-3.5 3.5H12"/>`,
  heart: `<path d="M20.8 6.6a4.4 4.4 0 0 0-6.3-.3L12 8.6 9.5 6.3A4.4 4.4 0 0 0 3.2 12c0 6.2 8.8 10.4 8.8 10.4S20.8 18.2 20.8 12a4.4 4.4 0 0 0 0-5.4Z"/>`,
  trophy: `<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a2 2 0 0 0 2 4M17 6h3a2 2 0 0 1-2 4"/>`,
  menu: `<path d="M3 6h18M3 12h18M3 18h18"/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  bolt: `<path d="M13 2 4.6 13.1a.6.6 0 0 0 .48.97h5.06l-1.4 7.06a.6.6 0 0 0 1.06.48l8.6-11.1a.6.6 0 0 0-.48-.97h-5.06l1.4-7.06A.6.6 0 0 0 13 2Z"/>`,
  copy: `<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`,
  external: `<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>`,
  shield: `<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5Z"/>`,
};

export function Icon({
  name,
  className = "ni",
  size = 18,
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
