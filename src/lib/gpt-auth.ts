/** Auth for Custom GPT Actions (Bearer token). */
export function gptAuthorized(request: Request): boolean {
  const secret = process.env.GPT_API_SECRET || process.env.CRAWL_SECRET || "";
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
    return `${u.protocol}//${u.host}`;
  }
  return "https://YOUR_DOMAIN";
}
