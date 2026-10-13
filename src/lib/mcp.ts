/**
 * Minimal stateless MCP server (Streamable HTTP transport, JSON responses only)
 * so Claude custom connectors can use the same read-only data as the Custom GPT.
 * Tools-only: no sessions, no server-initiated messages, no SSE stream.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

export type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  additionalProperties?: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  run: (args: Record<string, string | number | boolean>) => Promise<{ ok: boolean; text: string }>;
};

export type McpContext = {
  tools: McpTool[];
  instructions: string;
  serverName: string;
  serverVersion: string;
};

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: unknown };
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

/** Tool results are capped so one call can't blow up the model's context. */
export const MAX_TOOL_TEXT = 120_000;

const ok = (id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const fail = (id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** Keep only declared, primitive arguments. */
export function pickArgs(schema: JsonSchema, raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in schema.properties)) continue;
    if (typeof v === "string" ? v.trim() !== "" : typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean") {
      out[k] = v as string | number | boolean;
    }
  }
  return out;
}

/** Handle one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleMcpMessage(msg: unknown, ctx: McpContext): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, -32600, "Invalid Request");
  const m = msg as JsonRpcRequest;
  const isNotification = !("id" in m) || m.id === undefined;
  const id = isNotification ? null : (m.id ?? null);
  if (typeof m.method !== "string") return isNotification ? null : fail(id, -32600, "Invalid Request");
  if (isNotification) return null;

  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const requested = String(params.protocolVersion ?? "");
      return ok(id, {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: ctx.serverName, version: ctx.serverVersion },
        instructions: ctx.instructions,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: ctx.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = ctx.tools.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        const res = await tool.run(pickArgs(tool.inputSchema, params.arguments));
        const text =
          res.text.length > MAX_TOOL_TEXT
            ? `${res.text.slice(0, MAX_TOOL_TEXT)}\n…[truncated at ${MAX_TOOL_TEXT} characters — narrow the filters or lower the limit]`
            : res.text;
        return ok(id, { content: [{ type: "text", text }], isError: !res.ok });
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${m.method}`);
  }
}
