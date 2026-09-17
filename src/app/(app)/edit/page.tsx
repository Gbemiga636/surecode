import { PageHeader } from "@/components/PageHeader";
import { EditCodeForm } from "@/components/EditCodeForm";

export const dynamic = "force-dynamic";

export default function EditCodePage() {
  return (
    <div>
      <PageHeader
        kicker="Rebuild"
        title="Edit long codes"
        subtitle="Paste a long SportyBet code — we trim started/weak legs and book shorter high-probability alternatives."
      />
      <EditCodeForm />
    </div>
  );
}
