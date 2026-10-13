import { createHash, timingSafeEqual } from "node:crypto";
import { GPT_API_SECRET_DEFAULT, gptAuthorized } from "@/lib/gpt-auth";
import { GPT_INSTRUCTIONS } from "@/lib/gpt-instructions";
import { checkPredictionLogAuth } from "@/lib/prediction-log-auth";
import { handleMcpMessage, type JsonSchema, type McpTool } from "@/lib/mcp";
import { GET as sureCodes } from "@/app/api/gpt/sure/route";
import { GET as metrics } from "@/app/api/gpt/metrics/route";
import { GET as fixtures } from "@/app/api/gpt/fixtures/route";
import { GET as history } from "@/app/api/gpt/history/route";
import { GET as health } from "@/app/api/gpt/health/route";
import { GET as predictionLog } from "@/app/api/prediction-log/route";
import { GET as performanceReport } from "@/app/api/prediction-log/report/route";
import { GET as selectionLift } from "@/app/api/prediction-log/selection-lift/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Handler = (request: Request) => Promise<Response>;
type Access = "full" | "gpt";

const NO_STORE = { "Cache-Control": "no-store" };
const MIN_KEY_LENGTH = 24;

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

function presentedTokens(request: Request): string[] {
  const auth = (request.headers.get("authorization") ?? "").trim();
  const bearer = auth.match(/^bearer\s+(.+)$/i);
  const q = new URL(request.url).searchParams;
  return [bearer?.[1], request.headers.get("x-api-key"), q.get("key")]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
}

/**
 * MCP_API_KEY (header or ?key=) or PREDICTION_LOG_API_KEY (header only) → every tool.
 * The Custom GPT key → the same tools ChatGPT has.
 */
function accessFor(request: Request): Access | null {
  const mcpKey = (process.env.MCP_API_KEY ?? "").trim();
  if (mcpKey.length >= MIN_KEY_LENGTH && presentedTokens(request).some((t) => timingSafeEqual(digest(t), digest(mcpKey)))) {
    return "full";
  }
  if (checkPredictionLogAuth(request).ok) return "full";
  if (gptAuthorized(request)) return "gpt";
  return null;
}

async function callRoute(handler: Handler, path: string, args: Record<string, unknown>, key: string | undefined) {
  if (!key) return { ok: false, text: "This tool is not configured on the server (missing API key env var)." };
  const url = new URL(path, "https://surecode.internal");
  for (const [k, v] of Object.entries(args)) url.searchParams.set(k, String(v));
  const res = await handler(new Request(url, { headers: { authorization: `Bearer ${key}` } }));
  return { ok: res.ok, text: await res.text() };
}

const str = (description: string, values?: string[]) => ({ type: "string", description, ...(values ? { enum: values } : {}) });
const int = (description: string) => ({ type: "integer", description });
const schema = (properties: JsonSchema["properties"] = {}): JsonSchema => ({ type: "object", properties, additionalProperties: false });

const AUDIT_FILTERS: JsonSchema["properties"] = {
  from: str("Start date YYYY-MM-DD (UTC, inclusive)"),
  to: str("End date YYYY-MM-DD (UTC, inclusive)"),
  date_field: str("Which timestamp from/to apply to", ["created", "kickoff"]),
  sport: str("e.g. football, basketball, tennis, hockey"),
  league: str("League name contains (case-insensitive)"),
  market: str("Exact market, e.g. 1X2, Winner, Over/Under"),
  product_tier: str("Sure tier", ["safe", "boost", "longshot"]),
  model_version: str("Exact model_version"),
  data_origin: str("prospective = logged live; recovered = rebuilt from stored codes", ["prospective", "recovered"]),
};

function gptTool(name: string, title: string, description: string, handler: Handler, path: string, props?: JsonSchema["properties"]): McpTool {
  return {
    name,
    title,
    description,
    inputSchema: schema(props),
    run: (args) => callRoute(handler, path, args, GPT_API_SECRET_DEFAULT),
  };
}

function auditTool(name: string, title: string, description: string, handler: Handler, path: string, props: JsonSchema["properties"]): McpTool {
  return {
    name,
    title,
    description,
    inputSchema: schema(props),
    run: (args) => callRoute(handler, path, args, process.env.PREDICTION_LOG_API_KEY?.trim()),
  };
}

const GPT_TOOLS: McpTool[] = [
  gptTool(
    "get_sure_codes",
    "Today's Sure codes",
    "Booked SportyBet share codes on the Sure board with every leg (Safe slots 1-3, Boost 4-6, Longshot 7-9).",
    sureCodes,
    "/api/gpt/sure",
    { mode: str("Which tier", ["all", "safe", "boost", "longshot"]), day: str("Africa/Lagos day YYYY-MM-DD (default today)") },
  ),
  gptTool(
    "get_metrics",
    "Model metrics",
    "Leg hit rate, Brier score, log loss, calibration (ECE), Wilson intervals and flat-stake ROI by market and league, plus slip results and data-quality flags.",
    metrics,
    "/api/gpt/metrics",
    { days: int("Look-back window, 7-365 (default 90)"), minSample: int("Minimum legs per group, 1-200 (default 10)") },
  ),
  gptTool(
    "get_fixtures",
    "Upcoming fixtures",
    "Upcoming SportyBet fixtures with odds, overround and de-vigged market probabilities.",
    fixtures,
    "/api/gpt/fixtures",
    {
      sport: str("Sport filter (default all)"),
      hours: int("Kickoff window in hours, 1-120 (default 24)"),
      limit: int("Max fixtures, 1-150 (default 40)"),
      league: str("League name contains"),
    },
  ),
  gptTool("get_history", "Settled history", "Recent settled legs and slips with outcomes.", history, "/api/gpt/history", {
    limit: int("Max rows, 1-200 (default 50)"),
    days: int("Look-back window, 1-365 (default 30)"),
  }),
  gptTool("health_check", "Health check", "API status and data freshness.", health, "/api/gpt/health"),
];

const AUDIT_TOOLS: McpTool[] = [
  auditTool(
    "get_prediction_log",
    "Prediction audit log",
    "Row-level audit log of every published prediction (odds at prediction, closing odds, result, tier, slot, timestamps).",
    predictionLog,
    "/api/prediction-log",
    {
      ...AUDIT_FILTERS,
      result: str("Result", ["pending", "win", "loss", "void", "cancelled"]),
      slip_code: str("Exact booking code"),
      event_id: str("SportyBet event id"),
      limit: int("Rows, 1-1000 (default 100)"),
      offset: int("Paging offset"),
      order: str("Sort by date", ["desc", "asc"]),
    },
  ),
  auditTool(
    "get_performance_report",
    "Official performance report",
    "Legs vs slips, per tier, calibration (Brier / log loss), CLV and ROI. Use eval=1 for the clean pre-kickoff evaluation set.",
    performanceReport,
    "/api/prediction-log/report",
    { ...AUDIT_FILTERS, eval: str("1 = only rows generated before kickoff", ["1", "0"]) },
  ),
  auditTool(
    "get_selection_lift",
    "Selection lift (matched control)",
    "Selected high-confidence picks vs comparable rejected candidates (same tier, sport, market, day, lead time, implied probability ±tolerance, league when possible). Selection Lift = selected hit rate − matched rejected hit rate, with 95% interval.",
    selectionLift,
    "/api/prediction-log/selection-lift",
    {
      from: str("First candidate day YYYY-MM-DD"),
      to: str("Last candidate day YYYY-MM-DD"),
      min_implied: { type: "number", description: "High-confidence threshold on 1/odds, 0.05-0.99 (default 0.70; only Safe picks reach 0.70, use ~0.3 to include Boost/Longshot)" },
      tolerance: { type: "number", description: "Max implied-probability gap, 0.01-0.15 (default 0.05)" },
      controls: int("Controls per selected pick, 1-10 (default 3)"),
    },
  ),
];

const TOOL_NAMES: [string, string][] = [
  ["getSureCodes", "get_sure_codes"],
  ["getMetrics", "get_metrics"],
  ["getFixtures", "get_fixtures"],
  ["getHistory", "get_history"],
  ["healthCheck", "health_check"],
  ["SureCode Actions", "SureCode tools"],
  ["Actions", "tools"],
];

const INSTRUCTIONS = TOOL_NAMES.reduce((text, [from, to]) => text.split(from).join(to), GPT_INSTRUCTIONS);
const AUDIT_NOTE = `

## Audit tools (full access only)
- get_prediction_log: row-level published predictions with odds at prediction time, closing odds and results.
- get_performance_report: official legs/slips/tier performance; pass eval=1 for the clean pre-kickoff set.
- get_selection_lift: matched-control comparison of selected vs comparable rejected candidates. Never mix Safe, Boost and Longshot; quote n and the 95% interval; say "not enough data" when the interval is wide.`;

const ERROR = (status: number, message: string, extra: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status, headers: { ...NO_STORE, ...extra } });

/** POST /api/mcp — MCP endpoint for Claude custom connectors. */
export async function POST(request: Request) {
  const access = accessFor(request);
  if (!access) {
    return ERROR(401, "Unauthorized: add ?key=<your key> to the connector URL or send Authorization: Bearer <key>", {
      "WWW-Authenticate": 'Bearer realm="SureCode MCP"',
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: NO_STORE });
  }

  const ctx = {
    tools: access === "full" ? [...GPT_TOOLS, ...AUDIT_TOOLS] : GPT_TOOLS,
    instructions: access === "full" ? INSTRUCTIONS + AUDIT_NOTE : INSTRUCTIONS,
    serverName: "surecode",
    serverVersion: "1.0.0",
  };

  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleMcpMessage(m, ctx)))).filter(Boolean);
    return replies.length ? Response.json(replies, { headers: NO_STORE }) : new Response(null, { status: 202 });
  }
  const reply = await handleMcpMessage(body, ctx);
  return reply ? Response.json(reply, { headers: NO_STORE }) : new Response(null, { status: 202 });
}

const notAllowed = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
