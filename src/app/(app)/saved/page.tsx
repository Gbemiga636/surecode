import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { sportyOpenUrl } from "@/lib/sporty";
import { SavePrefsForm } from "@/components/SavePrefsForm";
import { PageHeader } from "@/components/PageHeader";

export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: prefs }, { data: saved }, { data: generated }] = await Promise.all([
    supabase.from(T.preferences).select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from(T.savedPicks)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from(T.generatedCodes)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div>
      <PageHeader
        kicker="You"
        title="Saved & generated"
        subtitle="Preferences, saved picks, and SportyBet codes this account has booked."
      />

      <SavePrefsForm
        initial={{
          game_type: prefs?.game_type ?? "result",
          min_confidence: Number(prefs?.min_confidence ?? 0.55),
          max_odds: Number(prefs?.max_odds ?? 5),
        }}
      />

      <h2 className="mt-10 font-display text-lg font-bold">Generated codes</h2>
      <div className="mt-3 space-y-2">
        {(generated ?? []).length === 0 && (
          <p className="text-sm text-ink/55">None yet — book from Expert / Predictions / Combos.</p>
        )}
        {(generated ?? []).map((g) => (
          <div key={g.id} className="sc-card flex flex-wrap justify-between gap-2 p-3 text-sm">
            <div>
              <p className="font-mono font-bold">{g.code}</p>
              <p className="text-ink/45">
                {g.origin} · odds {g.total_odds != null ? Number(g.total_odds).toFixed(2) : "—"}
              </p>
            </div>
            <a
              className="sc-btn-ghost text-xs"
              href={g.share_url || sportyOpenUrl(g.code)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </a>
          </div>
        ))}
      </div>

      <h2 className="mt-10 font-display text-lg font-bold">Saved picks</h2>
      <div className="mt-3 space-y-2">
        {(saved ?? []).length === 0 && <p className="text-sm text-ink/55">No saved picks yet.</p>}
        {(saved ?? []).map((s) => (
          <div key={s.id} className="sc-card p-3 text-sm">
            <p className="font-semibold">
              {s.home} vs {s.away}
            </p>
            <p className="text-ink/55">
              {s.pick} @ {s.odds ?? "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
