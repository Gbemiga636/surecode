import { redirect } from "next/navigation";
import { getViewer } from "@/lib/exbot/viewer";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function ExbotLogin() {
  if (await getViewer()) redirect("/exbot");
  return (
    <main className="login">
      <div className="panel">
        <div className="brand">
          <div className="logo">ex</div>
          <div>
            <h1>exbot</h1>
            <small>Crypto trends · US options</small>
          </div>
        </div>
        <p className="muted small">Automated trading on Bybit, Binance and Alpaca, with paper trading first. Sign in, or create an account with any email.</p>
        <LoginForm />
      </div>
    </main>
  );
}
