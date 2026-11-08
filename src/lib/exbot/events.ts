import type { SupabaseClient } from "@supabase/supabase-js";

export type Level = "info" | "trade" | "warn" | "error";

/** Journal line for the member's dashboard, plus an optional Telegram copy. Never throws. */
export async function logEvent(sb: SupabaseClient, userId: string | null, level: Level, message: string, who?: string): Promise<void> {
  try {
    await sb.from("exbot_events").insert({ user_id: userId, level, message: message.slice(0, 2000) });
  } catch {
    /* journal failures must not stop trading */
  }
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (token && chat && level !== "info") {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `exbot${who ? ` [${who}]` : ""}: ${message}` }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      /* optional */
    }
  }
}
