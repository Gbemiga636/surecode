"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icons";

const GROUPS: {
  label: string;
  items: { href: string; label: string; icon: IconName; flag?: string }[];
}[] = [
  {
    label: "Codes",
    items: [
      { href: "/home", label: "Sure codes", icon: "shield" },
      { href: "/builder", label: "Build combos", icon: "layers" },
      { href: "/edit", label: "Edit long codes", icon: "layers" },
      { href: "/codes", label: "Plenty codes", icon: "dashboard" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/picks", label: "Picks & analysis", icon: "target" },
      { href: "/predictions", label: "Predictions", icon: "calendar" },
      { href: "/past", label: "Past codes", icon: "chart" },
    ],
  },
  {
    label: "Practice",
    items: [
      { href: "/demo", label: "Demo wallet", icon: "wallet", flag: "FREE" },
      { href: "/leaderboard", label: "Leaderboard", icon: "trophy", flag: "FREE" },
      { href: "/saved", label: "Saved", icon: "bookmark" },
    ],
  },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/home": {
    title: "Sure codes",
    subtitle: "Safe · Larger · Longshot · cross-sport · AI play-out",
  },
  "/builder": {
    title: "Build combos",
    subtitle: "Choose markets · we book the strongest codes",
  },
  "/edit": {
    title: "Edit long codes",
    subtitle: "Trim weak legs · rebuild shorter slips",
  },
  "/picks": {
    title: "Picks & analysis",
    subtitle: "Overall · value · combos · AI desk",
  },
  "/codes": {
    title: "Plenty of codes",
    subtitle: "SAFE · VALUE · AI · COMBO from the crawler",
  },
  "/predictions": {
    title: "Predictions",
    subtitle: "Favourite tips from live SportyBet prices",
  },
  "/saved": {
    title: "Saved",
    subtitle: "Your preferences and generated codes",
  },
  "/demo": {
    title: "Demo wallet",
    subtitle: "Virtual ₦ bank · no real money",
  },
  "/leaderboard": {
    title: "Leaderboard",
    subtitle: "Ranked by virtual returns",
  },
  "/past": {
    title: "Past codes",
    subtitle: "Archive with date filters",
  },
  "/how": {
    title: "How it works",
    subtitle: "From crawl to openable SportyBet code",
  },
};

export function AppChrome({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const meta = TITLES[path] ?? { title: "SureCode", subtitle: "SportyBet intelligence" };

  useEffect(() => {
    setOpen(false);
  }, [path]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="layout">
      <div
        className={`nav-backdrop ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />
      <aside className={`sidebar ${open ? "open" : ""}`} id="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden>
            SC
          </span>
          <span className="brand-text">SureCode</span>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>

        {GROUPS.map((g) => (
          <div key={g.label} className="nav-group">
            <div className="nav-label">{g.label}</div>
            {g.items.map((item) => {
              const on = path === item.href || path.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${on ? "on" : ""}`}
                  aria-current={on ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span className="nav-t">{item.label}</span>
                  {item.flag && <span className="nav-free">{item.flag}</span>}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="nav-label">Help</div>
        <Link href="/how" className={`nav-item ${path === "/how" ? "on" : ""}`}>
          <Icon name="brain" />
          <span className="nav-t">How it works</span>
        </Link>

        <div className="side-foot">
          <div className="side-user">
            <span className="avatar">{email[0]?.toUpperCase() ?? "U"}</span>
            <span className="side-email" title={email}>
              {email}
            </span>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="signout-link">
              Sign out
            </button>
          </form>
          <p className="side-live">
            <span className="live-dot" />
            Markets refresh on crawl
          </p>
        </div>
      </aside>

      <div className="app">
        <div className="topbar">
          <div className="topbar-titles">
            <h1>{meta.title}</h1>
            <div className="sub">{meta.subtitle}</div>
          </div>
          <div className="top-right">
            <span className="chip chip-live">
              <span className="live-dot" />
              SportyBet NG
            </span>
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="sidebar"
            >
              <Icon name="menu" size={20} />
            </button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
