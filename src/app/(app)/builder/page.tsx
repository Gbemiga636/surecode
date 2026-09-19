import { PageHeader } from "@/components/PageHeader";
import { ComboBuilderForm } from "@/components/ComboBuilderForm";

export const dynamic = "force-dynamic";

export default function BuilderPage() {
  return (
    <div>
      <PageHeader
        kicker="Custom"
        title="Build your combos"
        subtitle="Select markets (Over 0.5, corners, BTTS…) — we analyse today’s fixtures and book the best SportyBet codes."
      />
      <ComboBuilderForm />
    </div>
  );
}
