/**
 * Thin OpenAI chat helper (OPENAI_API_KEY required).
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chatJson<T>(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<T | null> {
  const text = await chatText({
    ...opts,
    system:
      opts.system +
      "\nRespond with valid JSON only. No markdown fences, no commentary.",
  });
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export async function chatText(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS) || 8_000),
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ] satisfies ChatMessage[],
      }),
    });
    if (!res.ok) {
      console.warn("[openai]", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn("[openai]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Free-form text (no forced JSON). */
export async function chatPlain(opts: {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS) || 6_000),
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 280,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}
