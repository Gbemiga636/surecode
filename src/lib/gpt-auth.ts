/**
 * Defaults baked for surecodev1 — no Vercel env required for GPT Actions.
 */
export const SURECODE_SITE_URL = "https://surecodev1.vercel.app";

/** Bearer token for Custom GPT Actions — share this with your GPT person only. */
export const GPT_API_SECRET_DEFAULT = "sc_gpt_8qgGk5OIchSiUBPp6e0dbuw9JCMjZKzAvFDXxmof";

function clean(v: string | null | undefined): string {
  return (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

/**
 * Every secret that unlocks the GPT API. The baked-in default always works, so an unrelated
 * env var (e.g. CRAWL_SECRET set for cron) can never lock the Custom GPT out.
 */
function acceptedSecrets(): string[] {
  return [GPT_API_SECRET_DEFAULT, process.env.GPT_API_SECRET, process.env.CRAWL_SECRET]
    .map(clean)
    .filter((s) => s.length >= 16);
}

/** Pull a token from any header shape ChatGPT Actions can send (Bearer, Basic, custom). */
function presentedTokens(request: Request): string[] {
  const out: string[] = [];
  const auth = clean(request.headers.get("authorization"));
  if (auth) {
    const m = auth.match(/^(bearer|token|basic)\s+(.+)$/i);
    const value = clean(m ? m[2] : auth);
    out.push(value);
    if (m && m[1].toLowerCase() === "basic") {
      try {
        const decoded = atob(value);
        out.push(...decoded.split(":").map(clean));
      } catch {
        /* not base64 */
      }
    }
  }
  for (const h of ["x-gpt-secret", "x-api-key", "api-key", "x-api-secret"]) {
    const v = clean(request.headers.get(h));
    if (v) out.push(v.replace(/^bearer\s+/i, ""));
  }
  const q = new URL(request.url).searchParams;
  for (const k of ["key", "api_key", "token"]) {
    const v = clean(q.get(k));
    if (v) out.push(v);
  }
  return out.filter(Boolean);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function gptAuthorized(request: Request): boolean {
  const secrets = acceptedSecrets();
  return presentedTokens(request).some((t) => secrets.some((s) => safeEqual(t, s)));
}

/** Why a request was rejected, without revealing any secret. */
export function gptAuthHint(request: Request): string {
  const auth = request.headers.get("authorization");
  if (!auth && !presentedTokens(request).length) {
    return "No API key received. In the GPT Action set Authentication → API Key → Auth Type: Bearer, and paste the key.";
  }
  return "API key not recognised. Re-paste the key exactly (no spaces or quotes) with Auth Type: Bearer.";
}

export function gptUnauthorized(request: Request): Response {
  return Response.json(
    { ok: false, error: "Unauthorized", hint: gptAuthHint(request) },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="SureCode GPT API"' } },
  );
}

export function siteBaseUrl(request?: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  if (request) {
    const u = new URL(request.url);
    if (u.host.includes("surecodev1.vercel.app")) return SURECODE_SITE_URL;
  }
  return SURECODE_SITE_URL;
}
