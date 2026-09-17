"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export function PastFilters({
  months,
  years,
}: {
  months: string[];
  years: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    // clearing month when day set and vice versa avoids confusion
    if (key === "day" && value) next.delete("month");
    if (key === "month" && value) next.delete("day");
    start(() => router.push(`${pathname}?${next.toString()}`));
  }

  const month = sp.get("month") || "all";
  const year = sp.get("year") || "all";
  const day = sp.get("day") || "";
  const outcome = sp.get("outcome") || "all";

  return (
    <div
      className={`sc-card mb-5 space-y-3 p-4 ${pending ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap gap-3">
        <label className="min-w-[140px] flex-1 text-xs font-bold text-[var(--muted)]">
          Day
          <input
            type="date"
            className="sc-input mt-1"
            value={day}
            onChange={(e) => setParam("day", e.target.value)}
          />
        </label>
        <label className="min-w-[140px] flex-1 text-xs font-bold text-[var(--muted)]">
          Month
          <select
            className="sc-input mt-1"
            value={month}
            onChange={(e) => setParam("month", e.target.value)}
          >
            <option value="all">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[110px] flex-1 text-xs font-bold text-[var(--muted)]">
          Year
          <select
            className="sc-input mt-1"
            value={year}
            onChange={(e) => setParam("year", e.target.value)}
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[120px] flex-1 text-xs font-bold text-[var(--muted)]">
          Result
          <select
            className="sc-input mt-1"
            value={outcome}
            onChange={(e) => setParam("outcome", e.target.value)}
          >
            <option value="all">All</option>
            <option value="WON">Won</option>
            <option value="LOST">Lost</option>
            <option value="PENDING">Pending</option>
            <option value="VOID">Void</option>
          </select>
        </label>
      </div>
      {(day || month !== "all" || year !== "all" || outcome !== "all") && (
        <button
          type="button"
          className="text-xs font-bold text-[var(--accent)] underline-offset-2 hover:underline"
          onClick={() => start(() => router.push(pathname))}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
