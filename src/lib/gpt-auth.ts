/**
 * Defaults baked for surecodev1 — no Vercel env required for GPT Actions.
 * Prefer env when present (local override).
 */
export const SURECODE_SITE_URL = "https://surecodev1.vercel.app";

/** Bearer token for Custom GPT Actions — share this with your GPT person only. */
export const GPT_API_SECRET_DEFAULT = "sc_gpt_8qgGk5OIchSiUBPp6e0dbuw9JCMjZKzAvFDXxmof";

/** Auth for Custom GPT Actions (Bearer token). */
export function gptAuthorized(request: Request): boolean {
  const secret =
    process.env.GPT_API_SECRET ||
    process.env.CRAWL_SECRET ||
    GPT_API_SECRET_DEFAULT;
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const hdr = request.headers.get("x-gpt-secret") || "";
  return bearer === secret || hdr === secret;
}

export function siteBaseUrl(request?: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (env) return env;
  if (request) {
    const u = new URL(request.url);
    // Prefer production domain when request host is vercel preview / localhost
    if (u.host.includes("surecodev1.vercel.app")) return SURECODE_SITE_URL;
  }
  return SURECODE_SITE_URL;
}
