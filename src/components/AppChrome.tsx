"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icons";

const MAIN: { href: string; label: string; icon: IconName; flag?: string }[] = [
  { href: "/home", label: "Sure codes", icon: "shield" },
  { href: "/edit", label: "Edit long codes", icon: "layers" },
  { href: "/codes", label: "Plenty codes", icon: "dashboard" },
  { href: "/predictions", label: "Predictions", icon: "calendar" },
  { href: "/expert", label: "Expert picks", icon: "target" },
  { href: "/value", label: "Value picks", icon: "gem" },
  { href: "/analysis", label: "AI analysis", icon: "pulse" },
  { href: "/combos", label: "Value combos", icon: "layers" },
  { href: "/saved", label: "Saved codes", icon: "bookmark" },
  { href: "/demo", label: "Demo wallet", icon: "wallet", flag: "FREE" },
  { href: "/leaderboard", label: "Leaderboard", icon: "trophy", flag: "FREE" },
  { href: "/past", label: "Past codes", icon: "chart" },
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/home": {
    title: "Sure codes of the day",
    subtitle: "2–3 quality games · stronger odds — open, copy, or demo-stake",
  },
  "/edit": {
    title: "Edit long codes",
    subtitle: "Paste a long SportyBet code → shorter high-probability rebuilds",
  },
  "/codes": {
    title: "Plenty of codes",
    subtitle: "SAFE · VALUE · AI · COMBO slips published by the crawler",
  },
  "/predictions": {
    title: "Match predictions",
    subtitle: "Tip-style favourites from live odds — select and book a code",
  },
  "/expert": {
    title: "Expert picks",
    subtitle: "Confidence-ranked picks — estimates, never guarantees",
  },
  "/value": {
    title: "Value picks",
    subtitle: "Bigger-price opportunities where the model beats the market",
  },
  "/analysis": {
    title: "AI match analysis",
    subtitle: "De-vigged probabilities with Over 2.5 / BTTS context",
  },
  "/combos": {
    title: "Value combos",
    subtitle: "Ready-made accumulators — book one in a click",
  },
  "/saved": {
    title: "Saved codes",
    subtitle: "Preferences and every code this account has generated",
  },
  "/demo": {
    title: "Demo bet simulator",
    subtitle: "Virtual ₦ bank — practice slips with no real money",
  },
  "/leaderboard": {
    title: "Demo wallet leaderboard",
    subtitle: "Ranked by virtual returns",
  },
  "/past": {
    title: "Past codes",
    subtitle: "Full forever archive — filter by date · win/loss track record",
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
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const meta = TITLES[path] ?? { title: "SureCode", subtitle: "Live SportyBet intelligence" };

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
          <span className="logo">
            <Icon name="bolt" size={17} className="logo-ico" />
          </span>
          <span className="brand-text">
            SureCode <em>AI</em>
          </span>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="nav-label">Main</div>
        {MAIN.map((item) => {
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
            Live · crawl every ~20 min
          </p>
          <p className="side-risk">18+ · Bet responsibly</p>
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
              SportyBet · NG
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
