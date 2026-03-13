#!/usr/bin/env node
import fs from "fs";
import http from "http";
import { EventEmitter } from "events";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { countTextTokens, countMessageTokens, type MessageParam } from "./tokenizer.js";
import { addUsageEntry, loadSession, resetSession, getHistory, getGroupedHistory, type UsageEntry, SESSION_FILE, DASHBOARD_PORT_FILE } from "./storage.js";
import { calculateCost, getPricing, formatCost, formatTokens } from "./costs.js";
import { DASHBOARD_HTML } from "./dashboard.js";

// ─── Dashboard event bus ──────────────────────────────────────────────────────
const usageEmitter = new EventEmitter();
usageEmitter.setMaxListeners(100);


// ─── Dashboard HTML imported from ./dashboard.ts ────────────────────────────

// ─── Handler registration ─────────────────────────────────────────────────────

function registerHandlers(s: Server): void {

s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "count_tokens",
      description:
        "Count how many tokens a piece of text or a full conversation will consume when sent to Claude. " +
        "Uses the official Anthropic token-counting API — results are exact, not estimated. " +
        "Pass `text` for a single string, or `messages` (+ optional `system`) for a full conversation.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Plain text to count tokens for (treated as a single user message).",
          },
          messages: {
            type: "array",
            description: "Full conversation array (alternative to `text`).",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant"] },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
          system: {
            type: "string",
            description: "System prompt to include in the token count (only used with `messages`).",
          },
          model: {
            type: "string",
            description: "Model to use for counting (default: claude-opus-4-6).",
          },
        },
      },
    },
    {
      name: "log_usage",
      description:
        "Record actual token usage from a completed Claude API call. " +
        "Logs input tokens, output tokens, and cache tokens, computes cost, " +
        "and persists everything to ~/.claude/token-counter/ for session and history tracking.",
      inputSchema: {
        type: "object",
        properties: {
          input_tokens: { type: "number", description: "Input tokens from the API response usage object." },
          output_tokens: { type: "number", description: "Output tokens from the API response usage object." },
          cache_read_tokens: { type: "number", description: "Cache read (cache_read_input_tokens) from usage." },
          cache_write_tokens: { type: "number", description: "Cache creation (cache_creation_input_tokens) from usage." },
          model: { type: "string", description: "Model that processed the request (default: claude-opus-4-6)." },
          description: { type: "string", description: "Optional label, e.g. 'chat turn 3' or 'planning phase'." },
          project: { type: "string", description: "Absolute path of the current project directory (e.g. process.cwd()). Used for project-level cost grouping in the dashboard." },
        },
        required: ["input_tokens", "output_tokens"],
      },
    },
    {
      name: "get_session_stats",
      description:
        "Return cumulative token counts and USD cost for the current session. " +
        "A session resets when you call reset_session or when the storage file is cleared.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_usage_history",
      description:
        "Return the N most-recent usage log entries across all sessions (newest first). " +
        "Useful for reviewing past spend or finding expensive calls.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max entries to return (default 20, max 100).",
          },
        },
      },
    },
    {
      name: "reset_session",
      description:
        "Start a fresh session. All in-session totals are zeroed out. " +
        "Global history (in history.json) is NOT cleared.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "estimate_cost",
      description:
        "Estimate the USD cost for a given number of input and output tokens without making an API call.",
      inputSchema: {
        type: "object",
        properties: {
          input_tokens: { type: "number" },
          output_tokens: { type: "number" },
          cache_read_tokens: { type: "number" },
          cache_write_tokens: { type: "number" },
          model: { type: "string", description: "Default: claude-opus-4-6" },
        },
        required: ["input_tokens", "output_tokens"],
      },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────────

s.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      // ── count_tokens ──────────────────────────────────────────────────────
      case "count_tokens": {
        const model = (a.model as string | undefined) ?? "claude-opus-4-6";

        let result: { inputTokens: number; model: string; exact: boolean; method: string };
        if (a.messages) {
          const messages = a.messages as MessageParam[];
          const system = a.system as string | undefined;
          result = await countMessageTokens(messages, system, model);
        } else if (a.text) {
          result = await countTextTokens(a.text as string, model);
        } else {
          throw new Error("Provide either `text` or `messages`.");
        }

        const pricing = getPricing(model);
        const estimatedInputCost = (result.inputTokens / 1_000_000) * pricing.inputPerMillion;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  input_tokens: result.inputTokens,
                  model: result.model,
                  counting_mode: result.exact
                    ? "exact (Anthropic API)"
                    : "approximate (local — set ANTHROPIC_API_KEY for exact counts)",
                  accuracy: result.exact ? "100% exact" : "~97-99% (cl100k_base approximation)",
                  estimated_input_cost_usd: Number(estimatedInputCost.toFixed(8)),
                  estimated_input_cost_formatted: formatCost(estimatedInputCost),
                  note: "Output tokens are unknown until the request completes — use log_usage after.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── log_usage ─────────────────────────────────────────────────────────
      case "log_usage": {
        const inputTokens = Number(a.input_tokens ?? 0);
        const outputTokens = Number(a.output_tokens ?? 0);
        const cacheReadTokens = Number(a.cache_read_tokens ?? 0);
        const cacheWriteTokens = Number(a.cache_write_tokens ?? 0);
        const model = (a.model as string | undefined) ?? "claude-opus-4-6";
        const description = a.description as string | undefined;
        const project = a.project as string | undefined;

        const entry = addUsageEntry(
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          description,
          project,
        );

        usageEmitter.emit("update");

        // Remote sync: fire-and-forget to REMOTE_DASHBOARD_URL if set
        const remoteUrl = process.env.REMOTE_DASHBOARD_URL;
        if (remoteUrl) {
          const ingestUrl = new URL(`${remoteUrl.replace(/\/$/, "")}/ingest`);
          const dashToken = process.env.DASHBOARD_TOKEN;
          if (dashToken) ingestUrl.searchParams.set("token", dashToken);
          fetch(ingestUrl.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
          }).catch(() => { /* ignore — remote dashboard is optional */ });
        }

        const session = loadSession();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  logged: {
                    id: entry.id,
                    model: entry.model,
                    description: entry.description,
                    project: entry.project,
                    tokens: {
                      input: entry.inputTokens,
                      output: entry.outputTokens,
                      cache_read: entry.cacheReadTokens,
                      cache_write: entry.cacheWriteTokens,
                    },
                    cost_usd: Number(entry.totalCost.toFixed(8)),
                    cost_formatted: formatCost(entry.totalCost),
                  },
                  session_running_total: {
                    tokens: {
                      input: session.totals.inputTokens,
                      output: session.totals.outputTokens,
                      cache_read: session.totals.cacheReadTokens,
                      cache_write: session.totals.cacheWriteTokens,
                    },
                    total_cost_usd: Number(session.totals.totalCost.toFixed(8)),
                    total_cost_formatted: formatCost(session.totals.totalCost),
                    entry_count: session.entries.length,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── get_session_stats ─────────────────────────────────────────────────
      case "get_session_stats": {
        const session = loadSession();
        const t = session.totals;
        const totalTokens =
          t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  session_id: session.sessionId,
                  started_at: session.startedAt,
                  entries: session.entries.length,
                  tokens: {
                    input: t.inputTokens,
                    input_formatted: formatTokens(t.inputTokens),
                    output: t.outputTokens,
                    output_formatted: formatTokens(t.outputTokens),
                    cache_read: t.cacheReadTokens,
                    cache_read_formatted: formatTokens(t.cacheReadTokens),
                    cache_write: t.cacheWriteTokens,
                    cache_write_formatted: formatTokens(t.cacheWriteTokens),
                    total: totalTokens,
                    total_formatted: formatTokens(totalTokens),
                  },
                  total_cost_usd: Number(t.totalCost.toFixed(8)),
                  total_cost_formatted: formatCost(t.totalCost),
                  dashboard_url: "http://localhost:8899",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── get_usage_history ─────────────────────────────────────────────────
      case "get_usage_history": {
        const limit = Math.min(Number(a.limit ?? 20), 100);
        const history = getHistory(limit);

        const summary = history.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          model: e.model,
          description: e.description,
          project: e.project,
          tokens: {
            input: e.inputTokens,
            output: e.outputTokens,
            cache_read: e.cacheReadTokens,
            cache_write: e.cacheWriteTokens,
          },
          cost_formatted: formatCost(e.totalCost),
          cost_usd: Number(e.totalCost.toFixed(8)),
        }));

        const grandTotal = history.reduce((acc, e) => acc + e.totalCost, 0);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: history.length,
                  showing: `Last ${limit} entries (newest first)`,
                  total_cost_in_range: formatCost(grandTotal),
                  entries: summary,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── reset_session ─────────────────────────────────────────────────────
      case "reset_session": {
        const newSession = resetSession();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: "Session reset. All running totals are now zero.",
                  new_session_id: newSession.sessionId,
                  started_at: newSession.startedAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── estimate_cost ─────────────────────────────────────────────────────
      case "estimate_cost": {
        const model = (a.model as string | undefined) ?? "claude-opus-4-6";
        const inputTokens = Number(a.input_tokens ?? 0);
        const outputTokens = Number(a.output_tokens ?? 0);
        const cacheReadTokens = Number(a.cache_read_tokens ?? 0);
        const cacheWriteTokens = Number(a.cache_write_tokens ?? 0);

        const costs = calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
        const pricing = getPricing(model);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  model,
                  pricing_per_million_tokens: {
                    input: `$${pricing.inputPerMillion.toFixed(2)}`,
                    output: `$${pricing.outputPerMillion.toFixed(2)}`,
                    cache_read: `$${pricing.cacheReadPerMillion.toFixed(2)}`,
                    cache_write: `$${pricing.cacheWritePerMillion.toFixed(2)}`,
                  },
                  tokens: {
                    input: inputTokens,
                    output: outputTokens,
                    cache_read: cacheReadTokens,
                    cache_write: cacheWriteTokens,
                  },
                  cost_breakdown: {
                    input: formatCost(costs.inputCost),
                    output: formatCost(costs.outputCost),
                    cache_read: formatCost(costs.cacheReadCost),
                    cache_write: formatCost(costs.cacheWriteCost),
                    total: formatCost(costs.totalCost),
                  },
                  total_cost_usd: Number(costs.totalCost.toFixed(8)),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

} // end registerHandlers

// ─── Default server instance (stdio) ─────────────────────────────────────────

const server = new Server(
  { name: "token-counter-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
registerHandlers(server);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function createMcpServer(): Server {
  const s = new Server(
    { name: "token-counter-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerHandlers(s);
  return s;
}

function buildSsePayload(): string {
  const session = loadSession();
  const grouped = getGroupedHistory();
  const history = getHistory(500); // Include recent history for chart analytics
  return JSON.stringify({ session, grouped, history });
}

// ─── In-memory store for HTTP/Railway mode ────────────────────────────────────
// Per-token, no disk writes, resets on redeploy — pure live relay.

const tokenStore = new Map<string, UsageEntry[]>();

function getTokenEntries(token: string): UsageEntry[] {
  if (!tokenStore.has(token)) tokenStore.set(token, []);
  return tokenStore.get(token)!;
}

// Sends flat entries — client rebuilds state + merges with localStorage
function buildTokenSsePayload(token: string): string {
  return JSON.stringify({ entries: getTokenEntries(token) });
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

interface RateBucket { count: number; resetAt: number }
const rateBuckets = new Map<string, RateBucket>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS);

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function checkRateLimit(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfter) });
    res.end(JSON.stringify({ error: "Rate limit exceeded. Max 60 requests/minute." }));
    return false;
  }
  return true;
}

// ─── HTTP server (Railway) ────────────────────────────────────────────────────

async function startHttpServer(port: number) {
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    addCorsHeaders(res);

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "token-counter-mcp", sessions: transports.size }));
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (url.pathname === "/events" && req.method === "GET") {
      const token = url.searchParams.get("token") ?? "";
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      const send = () => { try { res.write(`data: ${buildTokenSsePayload(token)}\n\n`); } catch { /* client gone */ } };
      send();
      usageEmitter.on(`update:${token}`, send);
      const hb = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => { clearInterval(hb); usageEmitter.off(`update:${token}`, send); });
      return;
    }

    if (url.pathname === "/ingest" && req.method === "POST") {
      if (!checkRateLimit(req, res)) return;
      const token = url.searchParams.get("token") ?? "";
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const entry = JSON.parse(body) as UsageEntry;
          if (!entry.id || !entry.timestamp || typeof entry.inputTokens !== "number") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing required fields" }));
            return;
          }
          const entries = getTokenEntries(token);
          entries.push(entry);
          // Cap per-token memory at 500 entries (full history lives in browser localStorage)
          if (entries.length > 500) entries.splice(0, entries.length - 500);
          usageEmitter.emit(`update:${token}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    if (url.pathname === "/sse" && req.method === "GET") {
      if (!checkRateLimit(req, res)) return;
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => transports.delete(transport.sessionId);
      const sessionServer = createMcpServer();
      await sessionServer.connect(transport);
      return;
    }

    if (url.pathname === "/messages" && req.method === "POST") {
      if (!checkRateLimit(req, res)) return;
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Session "${sessionId}" not found — connect via /sse first`);
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404); res.end();
  });

  httpServer.listen(port, () => {
    process.stderr.write(`Token Counter MCP running on port ${port}\n`);
    process.stderr.write(`SSE endpoint: http://0.0.0.0:${port}/sse\n`);
  });
}

// ─── Local dashboard server (stdio mode) ─────────────────────────────────────

function startDashboardServer(port: number) {
  const srv = http.createServer((req, res) => {
    addCorsHeaders(res);
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (url.pathname === "/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      const send = () => { try { res.write(`data: ${buildSsePayload()}\n\n`); } catch { /* client gone */ } };
      send();
      usageEmitter.on("update", send);
      const hb = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => { clearInterval(hb); usageEmitter.off("update", send); });
      return;
    }

    // POST /log — called by Stop hook for automatic token tracking
    if (url.pathname === "/log" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { input_tokens = 0, output_tokens = 0, cache_read_tokens = 0, cache_write_tokens = 0, model = "claude-sonnet-4-6", description = "auto-tracked", project = "" } = JSON.parse(body) as {
            input_tokens?: number; output_tokens?: number; cache_read_tokens?: number;
            cache_write_tokens?: number; model?: string; description?: string; project?: string;
          };
          addUsageEntry(model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, description, project || undefined);
          usageEmitter.emit("update");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.writeHead(404); res.end();
  });

  srv.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(`Dashboard port ${port} in use, trying ${port + 1}\n`);
      port += 1;
      srv.listen(port);
    } else {
      process.stderr.write(`Dashboard error: ${err}\n`);
    }
  });

  srv.listen(port, () => {
    const addr = srv.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    process.stderr.write(`Dashboard → http://localhost:${actualPort}\n`);
    try { fs.writeFileSync(DASHBOARD_PORT_FILE, String(actualPort), "utf8"); } catch { /* ignore */ }
    server.sendLoggingMessage({
      level: "info",
      data: `Token usage dashboard → http://localhost:${actualPort}`,
    }).catch(() => {/* ignore */});

    // Watch session.json for writes from OTHER MCP processes (multiple Claude Code windows).
    // Each window spawns its own MCP process with its own usageEmitter, so cross-process
    // log_usage calls only reach the dashboard via this file watcher.
    let watchDebounce: ReturnType<typeof setTimeout> | null = null;
    function startSessionWatcher() {
      try {
        const watcher = fs.watch(SESSION_FILE, () => {
          if (watchDebounce) clearTimeout(watchDebounce);
          watchDebounce = setTimeout(() => usageEmitter.emit("update"), 50);
        });
        watcher.on("error", () => setTimeout(startSessionWatcher, 2000));
      } catch {
        setTimeout(startSessionWatcher, 2000);
      }
    }
    startSessionWatcher();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv[2] === "setup") {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    process.exit(0);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT) : null;

  if (port) {
    await startHttpServer(port);
  } else {
    const transport = new StdioServerTransport();
    startDashboardServer(8899);
    await server.connect(transport);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
