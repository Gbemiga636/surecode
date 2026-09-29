"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icons";

export type LikeTarget = {
  code: string;
  source?: string;
  lane?: string | null;
  day?: string | null;
};

type Ctx = {
  liked: Set<string>;
  selected: Map<string, LikeTarget>;
  busy: boolean;
  toggleLike: (t: LikeTarget) => Promise<void>;
  toggleSelect: (t: LikeTarget) => void;
  likeSelected: () => Promise<void>;
  unlikeSelected: () => Promise<void>;
  clearSelection: () => void;
};

const LikeContext = createContext<Ctx | null>(null);

const norm = (c: string) => c.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const MIGRATION_HINT = "Liked codes need a one-time setup: run sql/schema-liked.sql in Supabase.";

export function useLikes() {
  return useContext(LikeContext);
}

export function LikeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Map<string, LikeTarget>>(new Map());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/liked?codesOnly=1")
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.ok) setLiked(new Set((j.codes as string[]).map(norm)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const save = useCallback(async (targets: LikeTarget[]) => {
    const res = await fetch("/api/liked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: targets }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.needsMigration ? MIGRATION_HINT : j.error || "Could not save");
    return (j.saved as string[]).map(norm);
  }, []);

  const remove = useCallback(async (codes: string[]) => {
    const res = await fetch("/api/liked", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.needsMigration ? MIGRATION_HINT : j.error || "Could not remove");
  }, []);

  const toggleLike = useCallback(
    async (t: LikeTarget) => {
      const code = norm(t.code);
      const wasLiked = liked.has(code);
      setLiked((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.delete(code);
        else next.add(code);
        return next;
      });
      try {
        if (wasLiked) {
          await remove([code]);
          setToast(`Removed ${code} from liked codes`);
        } else {
          await save([{ ...t, code }]);
          setToast(`Liked ${code}. Results update after kickoff.`);
        }
        if (path === "/liked") router.refresh();
      } catch (e) {
        setLiked((prev) => {
          const next = new Set(prev);
          if (wasLiked) next.add(code);
          else next.delete(code);
          return next;
        });
        setToast(e instanceof Error ? e.message : "Something went wrong");
      }
    },
    [liked, save, remove, path, router],
  );

  const toggleSelect = useCallback((t: LikeTarget) => {
    const code = norm(t.code);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(code)) next.delete(code);
      else next.set(code, { ...t, code });
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Map()), []);

  const likeSelected = useCallback(async () => {
    const targets = [...selected.values()];
    if (!targets.length) return;
    setBusy(true);
    try {
      const saved = await save(targets);
      setLiked((prev) => new Set([...prev, ...targets.map((t) => t.code), ...saved]));
      setSelected(new Map());
      setToast(`Liked ${targets.length} code${targets.length === 1 ? "" : "s"}`);
      if (path === "/liked") router.refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [selected, save, path, router]);

  const unlikeSelected = useCallback(async () => {
    const codes = [...selected.keys()];
    if (!codes.length) return;
    setBusy(true);
    try {
      await remove(codes);
      setLiked((prev) => {
        const next = new Set(prev);
        codes.forEach((c) => next.delete(c));
        return next;
      });
      setSelected(new Map());
      setToast(`Removed ${codes.length} code${codes.length === 1 ? "" : "s"}`);
      router.refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [selected, remove, router]);

  const value = useMemo<Ctx>(
    () => ({
      liked,
      selected,
      busy,
      toggleLike,
      toggleSelect,
      likeSelected,
      unlikeSelected,
      clearSelection,
    }),
    [liked, selected, busy, toggleLike, toggleSelect, likeSelected, unlikeSelected, clearSelection],
  );

  const count = selected.size;
  const onLikedPage = path === "/liked";

  return (
    <LikeContext.Provider value={value}>
      {children}
      {count > 0 && (
        <div className="lk-bar" role="region" aria-label="Selected codes">
          <span className="lk-bar-count">
            <Icon name="check" size={15} />
            {count} selected
          </span>
          {onLikedPage ? (
            <button type="button" className="lk-bar-btn lk-bar-danger" disabled={busy} onClick={unlikeSelected}>
              <Icon name="close" size={15} />
              Remove
            </button>
          ) : (
            <button type="button" className="lk-bar-btn" disabled={busy} onClick={likeSelected}>
              <Icon name="heart" size={15} />
              {busy ? "Saving…" : "Like all"}
            </button>
          )}
          <button type="button" className="lk-bar-ghost" onClick={clearSelection}>
            Clear
          </button>
          {!onLikedPage && (
            <Link href="/liked" className="lk-bar-ghost">
              View liked
            </Link>
          )}
        </div>
      )}
      {toast && (
        <div className={`lk-toast${count > 0 ? " lk-toast-up" : ""}`} role="status">
          {toast}
        </div>
      )}
    </LikeContext.Provider>
  );
}

export function LikeToggle({ target, showSelect = true }: { target: LikeTarget; showSelect?: boolean }) {
  const ctx = useLikes();
  if (!ctx) return null;
  const code = norm(target.code);
  const isLiked = ctx.liked.has(code);
  const isSelected = ctx.selected.has(code);

  return (
    <span className="lk-toggle">
      <button
        type="button"
        className={`lk-heart${isLiked ? " is-on" : ""}`}
        aria-pressed={isLiked}
        aria-label={isLiked ? `Unlike ${code}` : `Like ${code}`}
        title={isLiked ? "Liked. Click to remove" : "Like this code to track its result"}
        onClick={() => ctx.toggleLike(target)}
      >
        <Icon name="heart" size={16} className="lk-heart-ic" />
        <span className="lk-heart-t">{isLiked ? "Liked" : "Like"}</span>
      </button>
      {showSelect && (
        <button
          type="button"
          className={`lk-select${isSelected ? " is-on" : ""}`}
          aria-pressed={isSelected}
          aria-label={isSelected ? `Deselect ${code}` : `Select ${code}`}
          title="Select several codes, then like them together"
          onClick={() => ctx.toggleSelect(target)}
        >
          <span className="lk-box">{isSelected && <Icon name="check" size={12} />}</span>
          <span className="lk-select-t">Select</span>
        </button>
      )}
    </span>
  );
}
