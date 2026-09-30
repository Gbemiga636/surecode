"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { LegResult, LikedOutcome, LikedRow } from "@/lib/liked";
import { Icon, type IconName } from "@/components/Icons";
import { LikeToggle, useLikes } from "@/components/LikedCodes";
import { sportIcon } from "@/components/OddsTicker";
import { sourceLabel, sourcePage } from "@/lib/liked-source";

type StatusFilter = "ALL" | LikedOutcome;
type Sort = "newest" | "oldest" | "oddsHigh" | "oddsLow";

const LANES: { key: string; label: string }[] = [
  { key: "all", label: "All lanes" },
  { key: "safe", label: "Safe" },
  { key: "boost", label: "Larger" },
  { key: "longshot", label: "Longshot" },
  { key: "plenty", label: "Plenty codes" },
  { key: "custom", label: "Custom / pasted" },
];

const PERIODS: { key: string; label: string; days: number }[] = [
  { key: "all", label: "All time", days: 0 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];

const STATUS_META: Record<LikedOutcome, { label: string; icon: IconName; cls: string }> = {
  WON: { label: "Won", icon: "check", cls: "lb-won" },
  LOST: { label: "Lost", icon: "close", cls: "lb-lost" },
  PENDING: { label: "Pending", icon: "clock", cls: "lb-pending" },
  VOID: { label: "Void", icon: "shield", cls: "lb-void" },
};

const LEG_ICON: Record<LegResult["status"], IconName> = {
  won: "check",
  lost: "close",
  void: "shield",
  pending: "clock",
  unknown: "pulse",
};

const PAGE_ICON: Record<string, IconName> = {
  home: "shield",
  codes: "layers",
  past: "clock",
  saved: "heart",
  manual: "target",
};

function laneKey(lane: string | null, source: string): string {
  const l = (lane ?? "").toLowerCase();
  // Plenty codes saved before lanes were prefixed stored the bare code type ("safe").
  if (l.startsWith("plenty") || sourcePage(source) === "codes") return "plenty";
  if (l === "safe" || l === "boost" || l === "longshot") return l;
  return "custom";
}

function laneLabel(lane: string | null, source: string): string {
  const key = laneKey(lane, source);
  if (key === "plenty") return (lane ?? "plenty").replace(/^plenty-/, "").toUpperCase();
  return LANES.find((l) => l.key === key)?.label ?? "Custom";
}

type PageStat = { key: string; label: string; liked: number; won: number; lost: number; pending: number };

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 100) : null;
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function LikedBoard({ rows, needsSetup }: { rows: LikedRow[]; needsSetup: boolean }) {
  const router = useRouter();
  const likes = useLikes();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [lane, setLane] = useState("all");
  const [page, setPage] = useState("all");
  const [sport, setSport] = useState("all");
  const [period, setPeriod] = useState("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const sports = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => (r.legs ?? []).forEach((l) => s.add((l.sport ?? "football").toLowerCase())));
    return [...s].sort();
  }, [rows]);

  const counts = useMemo(() => {
    const c = { ALL: rows.length, WON: 0, LOST: 0, PENDING: 0, VOID: 0 } as Record<StatusFilter, number>;
    rows.forEach((r) => (c[r.outcome] = (c[r.outcome] ?? 0) + 1));
    return c;
  }, [rows]);

  const pages = useMemo(() => {
    const m = new Map<string, PageStat>();
    for (const r of rows) {
      const key = sourcePage(r.source);
      const s = m.get(key) ?? { key, label: sourceLabel(key), liked: 0, won: 0, lost: 0, pending: 0 };
      s.liked++;
      if (r.outcome === "WON") s.won++;
      else if (r.outcome === "LOST") s.lost++;
      else if (r.outcome === "PENDING") s.pending++;
      m.set(key, s);
    }
    return [...m.values()].sort(
      (a, b) => (pct(b.won, b.won + b.lost) ?? -1) - (pct(a.won, a.won + a.lost) ?? -1) || b.liked - a.liked,
    );
  }, [rows]);

  const decided = counts.WON + counts.LOST;
  const hitRate = decided ? Math.round((counts.WON / decided) * 100) : null;
  const bestWin = rows
    .filter((r) => r.outcome === "WON")
    .reduce((m, r) => Math.max(m, Number(r.total_odds ?? 0)), 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const days = PERIODS.find((p) => p.key === period)?.days ?? 0;
    const since = days ? Date.now() - days * 86_400_000 : 0;
    const list = rows.filter((r) => {
      if (status !== "ALL" && r.outcome !== status) return false;
      if (lane !== "all" && laneKey(r.lane, r.source) !== lane) return false;
      if (page !== "all" && sourcePage(r.source) !== page) return false;
      if (sport !== "all" && !(r.legs ?? []).some((l) => (l.sport ?? "football").toLowerCase() === sport))
        return false;
      if (since && new Date(r.created_at).getTime() < since) return false;
      if (!q) return true;
      const hay = [
        r.code,
        r.note ?? "",
        r.loss_summary ?? "",
        ...(r.legs ?? []).flatMap((l) => [l.home, l.away, l.league ?? "", l.pickLabel]),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    return list.sort((a, b) => {
      if (sort === "oddsHigh") return Number(b.total_odds ?? 0) - Number(a.total_odds ?? 0);
      if (sort === "oddsLow") return Number(a.total_odds ?? 0) - Number(b.total_odds ?? 0);
      const d = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return sort === "oldest" ? -d : d;
    });
  }, [rows, query, status, lane, page, sport, period, sort]);

  async function checkResults() {
    setChecking(true);
    setCheckMsg(null);
    try {
      const res = await fetch("/api/liked/refresh", { method: "POST" });
      const j = await res.json();
      setCheckMsg(
        j.ok
          ? j.settled
            ? `${j.settled} code${j.settled === 1 ? "" : "s"} settled.`
            : "Checked. Nothing new has finished yet."
          : j.error || "Check failed",
      );
      router.refresh();
    } catch {
      setCheckMsg("Check failed. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function addCode(e: React.FormEvent) {
    e.preventDefault();
    const code = newCode.trim();
    if (!code || !likes) return;
    await likes.toggleLike({ code, source: "manual" });
    setNewCode("");
    router.refresh();
  }

  function selectVisible() {
    if (!likes) return;
    visible.forEach((r) => {
      if (!likes.selected.has(r.code)) likes.toggleSelect({ code: r.code });
    });
  }

  const filtersActive =
    query || status !== "ALL" || lane !== "all" || page !== "all" || sport !== "all" || period !== "all";

  return (
    <div className="lb">
      <header className="dh-hero sc-rise">
        <div className="dh-hero-copy">
          <p className="sc-page-kicker">
            <Icon name="heart" size={13} className="dh-kicker-ic" /> Your liked codes
          </p>
          <h2 className="dh-title">
            Track every code <span className="dh-title-grad">you backed.</span>
          </h2>
          <p className="dh-sub">
            Won, lost or pending, with the exact leg and score that decided it. Results update
            automatically after full time; tap “Check results” to refresh now.
          </p>
        </div>
        <ul className="dh-stats" aria-label="Liked summary">
          <li className="dh-stat">
            <span className="dh-stat-ic">
              <Icon name="heart" size={18} />
            </span>
            <strong>{rows.length}</strong>
            <span>Liked</span>
          </li>
          <li className="dh-stat">
            <span className="dh-stat-ic">
              <Icon name="gauge" size={18} />
            </span>
            <strong>{hitRate != null ? `${hitRate}%` : "—"}</strong>
            <span>
              Hit rate ({counts.WON}/{decided})
            </span>
          </li>
          <li className="dh-stat">
            <span className="dh-stat-ic">
              <Icon name="clock" size={18} />
            </span>
            <strong>{counts.PENDING}</strong>
            <span>Pending</span>
          </li>
          <li className="dh-stat">
            <span className="dh-stat-ic">
              <Icon name="trophy" size={18} />
            </span>
            <strong>{bestWin ? `${bestWin.toFixed(2)}×` : "—"}</strong>
            <span>Best win</span>
          </li>
        </ul>
      </header>

      {needsSetup && (
        <div className="lb-setup sc-rise">
          <Icon name="lock" size={20} />
          <div>
            <p className="font-bold">One-time setup needed</p>
            <p>
              Open Supabase → SQL editor and run <code>sql/schema-liked.sql</code> from the repo. Then
              reload this page.
            </p>
          </div>
        </div>
      )}

      {pages.length > 0 && (
        <section className="lb-pages sc-rise" aria-label="Win rate by page">
          <div className="lb-pages-head">
            <p className="lb-pages-k">
              <Icon name="gauge" size={14} /> Win rate by page
            </p>
            <p className="lb-pages-sub">Where your liked codes came from, and how each page performed.</p>
          </div>
          <div className="lb-pages-grid">
            {pages.map((p) => {
              const d = p.won + p.lost;
              const win = pct(p.won, d);
              const loss = pct(p.lost, d);
              const on = page === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`lb-page${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setPage(on ? "all" : p.key)}
                >
                  <span className="lb-page-top">
                    <span className="lb-page-ic">
                      <Icon name={PAGE_ICON[p.key] ?? "layers"} size={15} />
                    </span>
                    <span className="lb-page-name">{p.label}</span>
                    <span className="lb-page-n">{p.liked} liked</span>
                  </span>
                  <span className="lb-page-rates">
                    <span className="lb-page-win">
                      <strong>{win != null ? `${win}%` : "—"}</strong> win
                    </span>
                    <span className="lb-page-loss">
                      <strong>{loss != null ? `${loss}%` : "—"}</strong> loss
                    </span>
                  </span>
                  <span className="lb-page-bar" aria-hidden>
                    <span className="lb-page-bar-w" style={{ width: `${win ?? 0}%` }} />
                    <span className="lb-page-bar-l" style={{ width: `${loss ?? 0}%` }} />
                  </span>
                  <span className="lb-page-foot">
                    {p.won} won · {p.lost} lost · {p.pending} pending
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="lb-tools sc-card" aria-label="Filters">
        <div className="lb-row">
          <label className="lb-search">
            <Icon name="target" size={16} />
            <input
              type="search"
              placeholder="Search code, team, league or pick…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search liked codes"
            />
          </label>
          <form className="lb-add" onSubmit={addCode}>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Paste any SportyBet code"
              aria-label="Add a code to liked"
            />
            <button type="submit" className="sc-btn" disabled={!newCode.trim()}>
              <Icon name="heart" size={15} />
              Like
            </button>
          </form>
        </div>

        <div className="lb-tabs" role="tablist" aria-label="Result">
          {(["ALL", "WON", "LOST", "PENDING", "VOID"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={`lb-tab${status === s ? " is-on" : ""} lb-tab-${s.toLowerCase()}`}
              onClick={() => setStatus(s)}
            >
              {s === "ALL" ? "All" : STATUS_META[s].label}
              <span className="lb-tab-n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="lb-row lb-selects">
          <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Lane">
            {LANES.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
          <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="Liked from page">
            <option value="all">All pages</option>
            {pages.map((p) => (
              <option key={p.key} value={p.key}>
                From {p.label}
              </option>
            ))}
          </select>
          <select value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport">
            <option value="all">All sports</option>
            {sports.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="oddsHigh">Highest odds</option>
            <option value="oddsLow">Lowest odds</option>
          </select>
          <div className="lb-actions">
            {visible.length > 0 && (
              <button type="button" className="sc-btn-ghost" onClick={selectVisible}>
                <Icon name="check" size={15} />
                Select shown
              </button>
            )}
            <button type="button" className="sc-btn" onClick={checkResults} disabled={checking}>
              <Icon name="pulse" size={15} />
              {checking ? "Checking…" : "Check results"}
            </button>
          </div>
        </div>
        {checkMsg && <p className="lb-msg">{checkMsg}</p>}
      </section>

      <p className="lb-count">
        Showing <strong>{visible.length}</strong> of {rows.length}
        {filtersActive && (
          <button
            type="button"
            className="lb-clear"
            onClick={() => {
              setQuery("");
              setStatus("ALL");
              setLane("all");
              setPage("all");
              setSport("all");
              setPeriod("all");
            }}
          >
            Clear filters
          </button>
        )}
      </p>

      {!rows.length && !needsSetup && (
        <div className="sc-empty">
          <p className="font-display text-lg font-bold text-[var(--ink)]">No liked codes yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm">
            Tap <strong>Like</strong> on any code, or tick <strong>Select</strong> on several and
            press <strong>Like all</strong>. You can also paste a SportyBet code above.
          </p>
        </div>
      )}
      {rows.length > 0 && !visible.length && (
        <div className="sc-empty text-sm">No liked codes match these filters.</div>
      )}

      <div className="lb-list">
        {visible.map((r, idx) => {
          const meta = STATUS_META[r.outcome] ?? STATUS_META.PENDING;
          const legs = r.legs ?? [];
          const results = r.leg_results ?? [];
          const done = results.filter((x) => x.status === "won" || x.status === "lost" || x.status === "void").length;
          const expanded = open[r.id] ?? r.outcome === "LOST";
          return (
            <article
              key={r.id}
              className={`lb-card sc-rise ${meta.cls}`}
              style={{ animationDelay: `${Math.min(idx, 8) * 50}ms` }}
            >
              <div className="lb-card-head">
                <div>
                  <div className="lb-chips">
                    <span className={`lb-status ${meta.cls}`}>
                      <Icon name={meta.icon} size={13} />
                      {meta.label}
                    </span>
                    <span className="sport-chip">{laneLabel(r.lane, r.source)}</span>
                    <span className="lb-from">
                      <Icon name={PAGE_ICON[sourcePage(r.source)] ?? "layers"} size={12} />
                      From {sourceLabel(r.source)}
                    </span>
                    {r.day && <span className="lb-day">{r.day}</span>}
                  </div>
                  <p className="lb-code">{r.code}</p>
                  <p className="lb-meta">
                    {legs.length} leg{legs.length === 1 ? "" : "s"} · odds{" "}
                    <strong>{r.total_odds != null ? Number(r.total_odds).toFixed(2) : "—"}</strong>
                    {legs.length > 0 && ` · ${done}/${legs.length} settled`}
                    {r.settled_at ? ` · settled ${fmtDate(r.settled_at)}` : r.checked_at ? ` · checked ${fmtDate(r.checked_at)}` : ""}
                  </p>
                </div>
                <div className="lb-card-actions">
                  <LikeToggle target={{ code: r.code }} />
                  <a
                    className="sc-btn-ghost"
                    href={r.share_url || `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(r.code)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="external" size={15} />
                    Open
                  </a>
                </div>
              </div>

              {legs.length > 0 && (
                <div className="lb-progress" aria-hidden>
                  {legs.map((_, i) => (
                    <span key={i} className={`lb-seg lb-seg-${results[i]?.status ?? "pending"}`} />
                  ))}
                </div>
              )}

              {r.outcome === "LOST" && r.loss_summary && (
                <div className="lb-why">
                  <p className="lb-why-k">
                    <Icon name="target" size={14} /> What caused the loss
                  </p>
                  <p>{r.loss_summary}</p>
                  {results
                    .map((x, i) => ({ x, leg: legs[i] }))
                    .filter(({ x }) => x.status === "lost")
                    .map(({ x, leg }, i) => (
                      <p key={i} className="lb-why-leg">
                        <strong>
                          {leg?.home} v {leg?.away}:
                        </strong>{" "}
                        {x.reason}
                      </p>
                    ))}
                </div>
              )}

              {legs.length > 0 && (
                <>
                  <button
                    type="button"
                    className="lb-expand"
                    aria-expanded={expanded}
                    onClick={() => setOpen((o) => ({ ...o, [r.id]: !expanded }))}
                  >
                    {expanded ? "Hide legs" : "Show all legs"}
                    <Icon name={expanded ? "chevronLeft" : "chevronRight"} size={14} className="lb-expand-ic" />
                  </button>
                  {expanded && (
                    <ul className="lb-legs">
                      {legs.map((leg, i) => {
                        const res = results[i];
                        const st = res?.status ?? "pending";
                        return (
                          <li key={i} className={`lb-leg lb-leg-${st}`}>
                            <span className="lb-leg-ic">
                              <Icon name={LEG_ICON[st]} size={13} />
                            </span>
                            <div className="lb-leg-body">
                              <p className="lb-leg-match">
                                <Icon name={sportIcon(leg.sport)} size={13} className="lb-leg-sport" />
                                {leg.home} <span>vs</span> {leg.away}
                                {res?.homeScore != null && res?.awayScore != null && (
                                  <span className="lb-score">
                                    {res.homeScore}–{res.awayScore}
                                  </span>
                                )}
                              </p>
                              <p className="lb-leg-pick">
                                {leg.pickLabel}
                                {leg.league ? ` · ${leg.league}` : ""}
                              </p>
                              {res?.reason && st !== "won" && <p className="lb-leg-reason">{res.reason}</p>}
                            </div>
                            <span className="lb-leg-odds">{Number(leg.odds || 0).toFixed(2)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
              {!legs.length && (
                <p className="lb-leg-reason px-5 pb-4">
                  Legs for this code couldn’t be loaded, so it can’t be settled automatically.
                </p>
              )}
            </article>
          );
        })}
      </div>

      <p className="lb-foot">
        Results come from SportyBet final scores. Some markets (e.g. first-half picks) can’t be
        settled from the full-time score and stay pending. Past results don’t guarantee future
        ones. 18+, bet responsibly.
      </p>
    </div>
  );
}
