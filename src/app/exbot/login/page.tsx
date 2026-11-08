import { redirect } from "next/navigation";
import { getViewer } from "@/lib/exbot/viewer";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function ExbotLogin() {
  if (await getViewer()) redirect("/exbot");
  return (
    <main className="login">
      <div className="panel">
        <h1>exbot</h1>
        <p className="muted small">Automated crypto trading. Sign in, or create an account with any email.</p>
        <LoginForm />
      </div>
    </main>
  );
}
