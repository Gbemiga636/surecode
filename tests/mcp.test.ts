import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TOOL_TEXT, handleMcpMessage, pickArgs, type McpContext } from "../src/lib/mcp";

const calls: Record<string, unknown>[] = [];
const ctx: McpContext = {
  serverName: "surecode",
  serverVersion: "1.0.0",
  instructions: "be honest",
  tools: [
    {
      name: "echo",
      title: "Echo",
      description: "echo",
      inputSchema: { type: "object", properties: { a: { type: "string", description: "a" }, n: { type: "integer", description: "n" } } },
      run: async (args) => {
        calls.push(args);
        return { ok: true, text: JSON.stringify(args) };
      },
    },
    {
      name: "big",
      title: "Big",
      description: "big",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ ok: false, text: "x".repeat(MAX_TOOL_TEXT + 10) }),
    },
  ],
};

test("initialize negotiates a supported protocol version and returns instructions", async () => {
  const r = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx)) as any;
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.equal(r.result.instructions, "be honest");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  const old = (await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctx)) as any;
  assert.equal(old.result.protocolVersion, "2025-11-25");
});

test("notifications get no reply", async () => {
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx), null);
});

test("tools/list marks every tool read-only", async () => {
  const r = (await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, ctx)) as any;
  assert.deepEqual(r.result.tools.map((t: any) => t.name), ["echo", "big"]);
  assert.ok(r.result.tools.every((t: any) => t.annotations.readOnlyHint === true));
});

test("tools/call passes only declared primitive arguments", async () => {
  const r = (await handleMcpMessage(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { a: "x", n: 3, evil: "y", obj: {} } } },
    ctx,
  )) as any;
  assert.equal(r.result.isError, false);
  assert.deepEqual(JSON.parse(r.result.content[0].text), { a: "x", n: 3 });
  assert.deepEqual(pickArgs(ctx.tools[0].inputSchema, { a: "  ", n: Number.NaN }), {});
});

test("tool errors and oversized output are reported, unknown tools rejected", async () => {
  const big = (await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "big" } }, ctx)) as any;
  assert.equal(big.result.isError, true);
  assert.match(big.result.content[0].text, /truncated/);
  const unknown = (await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } }, ctx)) as any;
  assert.equal(unknown.error.code, -32602);
  const missing = (await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "resources/list" }, ctx)) as any;
  assert.equal(missing.error.code, -32601);
});
