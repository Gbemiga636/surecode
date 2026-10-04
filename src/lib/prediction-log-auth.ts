import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Auth for the read-only prediction log API.
 *
 * The key lives only in the PREDICTION_LOG_API_KEY env var (no baked-in default,
 * not shared with any other secret) and is accepted only in headers — never in
 * the URL, where it would end up in logs and browser history.
 */
const MIN_KEY_LENGTH = 24;

function configuredKey(): string | null {
  const key = (process.env.PREDICTION_LOG_API_KEY ?? "").trim();
  return key.length >= MIN_KEY_LENGTH ? key : null;
}

function presentedKey(request: Request): string | null {
  const auth = (request.headers.get("authorization") ?? "").trim();
  const bearer = auth.match(/^bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const header = (request.headers.get("x-api-key") ?? "").trim();
  return header || null;
}

function digest(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

export type PredictionLogAuth = { ok: true } | { ok: false; response: Response };

export function checkPredictionLogAuth(request: Request): PredictionLogAuth {
  const expected = configuredKey();
  if (!expected) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Prediction log API is not configured" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  const given = presentedKey(request);
  if (!given || !timingSafeEqual(digest(given), digest(expected))) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Unauthorized" },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
            "WWW-Authenticate": 'Bearer realm="SureCode prediction log"',
          },
        },
      ),
    };
  }
  return { ok: true };
}
