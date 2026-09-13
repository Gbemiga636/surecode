import { createClient } from "@/lib/supabase/server";
import { T } from "@/lib/db";
import { lagosDay } from "@/lib/sure-engine";
import { sportyOpenUrl } from "@/lib/sporty";
import { PageHeader } from "@/components/PageHeader";
import { CodeActions } from "@/components/CodeActions";
import { ReadMore } from "@/components/ReadMore";

export default async function CodesPage() {
  const supabase = await createClient();
  const day = lagosDay();
  const { data: today } = await supabase
    .from(T.codes)
    .select("*")
    .eq("day", day)
    .order("created_at", { ascending: false })
    .limit(40);

  const { data: recent } = await supabase
    .from(T.codes)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (today?.length ? today : recent) ?? [];

  return (
    <div>
      <PageHeader
        kicker="Library"
        title="Plenty of codes"
        subtitle="SAFE · VALUE · AI · COMBO slips from the crawler. Copy, open, or demo-stake."
      />
      {!rows.length && (
        <div className="sc-empty text-sm text-ink/55">
          No codes yet. Apply <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-xs">schema-features.sql</code>{" "}
          then run <code className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-xs">npm run crawl</code>.
        </div>
      )}
      <div className="space-y-3">
        {rows.map((r) => (
          <article key={r.id} className="sc-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-pitch">
                  {r.code_type} · {r.day}
                </p>
                <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-wider text-ink">
                  {r.code}
                </p>
                <p className="mt-1 text-sm text-ink/55">
                  Odds {r.total_odds != null ? Number(r.total_odds).toFixed(2) : "—"}
                  {r.confidence != null
                    ? ` · ~${Math.round(Number(r.confidence) * 100)}%`
                    : ""}
                </p>
              </div>
              <CodeActions
                code={r.code}
                openUrl={r.share_url || sportyOpenUrl(r.code)}
                codeId={r.id}
              />
            </div>
            {r.rationale && (
              <div className="mt-3 border-t border-[var(--line)] pt-3">
                <ReadMore text={r.rationale} limit={90} />
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
