#!/usr/bin/env node
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
import { addUsageEntry, loadSession, resetSession, getHistory } from "./storage.js";
import { calculateCost, getPricing, formatCost, formatTokens } from "./costs.js";

// ─── Dashboard event bus ──────────────────────────────────────────────────────
// Fires "update" whenever log_usage is called so live dashboard clients refresh.
const usageEmitter = new EventEmitter();
usageEmitter.setMaxListeners(100);

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Counter — Live Dashboard</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh;padding:24px 20px}
    .header{display:flex;align-items:center;gap:10px;margin-bottom:5px}
    h1{font-size:1.2rem;font-weight:600;color:#f0f6fc}
    .dot{width:9px;height:9px;border-radius:50%;background:#3fb950;flex-shrink:0;animation:pulse 2s ease-in-out infinite}
    .dot.off{background:#f85149;animation:none}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}
    .sub{color:#8b949e;font-size:.78rem;margin-bottom:22px}
    .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:22px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px}
    .card-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:#8b949e;margin-bottom:7px}
    .card-value{font-size:1.5rem;font-weight:700;color:#f0f6fc;line-height:1}
    .card-value.purple{color:#d2a8ff}
    .card-note{font-size:.65rem;color:#6e7681;margin-top:3px}
    h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.07em;color:#8b949e;margin-bottom:9px}
    .wrap{background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
    table{width:100%;border-collapse:collapse;font-size:.82rem}
    th{padding:9px 13px;text-align:left;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:#8b949e;background:#161b22;border-bottom:1px solid #30363d;white-space:nowrap}
    td{padding:9px 13px;border-bottom:1px solid #21262d;white-space:nowrap}
    tr:last-child td{border-bottom:none}
    .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:.71rem;background:#1c2a4a;color:#58a6ff;font-weight:500}
    .cost{color:#d2a8ff;font-weight:500}
    .dim{color:#6e7681}
    .new td{background:#1a2e1a!important;transition:background 1.5s ease}
    .empty{text-align:center;padding:38px;color:#6e7681;font-size:.83rem}
  </style>
</head>
<body>
  <div class="header">
    <div class="dot" id="dot"></div>
    <h1>Token Counter — Live</h1>
  </div>
  <p class="sub" id="sub">Connecting…</p>

  <div class="cards">
    <div class="card">
      <div class="card-label">Est. Session Cost</div>
      <div class="card-value purple" id="c-cost">—</div>
      <div class="card-note">approximate</div>
    </div>
    <div class="card">
      <div class="card-label">Input Tokens</div>
      <div class="card-value" id="c-in">—</div>
    </div>
    <div class="card">
      <div class="card-label">Output Tokens</div>
      <div class="card-value" id="c-out">—</div>
    </div>
    <div class="card">
      <div class="card-label">Cache Read</div>
      <div class="card-value" id="c-cr">—</div>
    </div>
    <div class="card">
      <div class="card-label">Cache Write</div>
      <div class="card-value" id="c-cw">—</div>
    </div>
    <div class="card">
      <div class="card-label">API Calls</div>
      <div class="card-value" id="c-n">—</div>
    </div>
  </div>

  <h2>Recent Calls</h2>
  <div class="wrap">
    <table>
      <thead>
        <tr>
          <th>Time</th><th>Model</th><th>Description</th>
          <th>Input</th><th>Output</th><th>Cache R/W</th><th>Est. Cost</th>
        </tr>
      </thead>
      <tbody id="tbody">
        <tr><td colspan="7" class="empty">Waiting for first log_usage call…</td></tr>
      </tbody>
    </table>
  </div>

  <script>
    function fmt(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n)}
    function cost(usd){
      if(usd===0)return '~$0.00';
      if(usd<0.0001)return '~$0.00';
      const s=parseFloat(usd.toPrecision(2));
      if(s<0.01)return '~$'+s.toFixed(4);
      if(s<1)return '~$'+s.toFixed(3);
      return '~$'+s.toFixed(2);
    }
    function hhmm(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
    function mdl(m){return m.replace('claude-','')}

    const dot=document.getElementById('dot');
    const sub=document.getElementById('sub');
    const es=new EventSource('/events');

    es.onerror=()=>{dot.className='dot off';sub.textContent='Disconnected — retrying…'};
    es.onopen=()=>{dot.className='dot'};

    es.onmessage=(e)=>{
      const d=JSON.parse(e.data);
      const t=d.totals;
      sub.textContent='Session started '+new Date(d.startedAt).toLocaleString()+' · '+d.entries.length+' calls';
      document.getElementById('c-cost').textContent=cost(t.totalCost);
      document.getElementById('c-in').textContent=fmt(t.inputTokens);
      document.getElementById('c-out').textContent=fmt(t.outputTokens);
      document.getElementById('c-cr').textContent=fmt(t.cacheReadTokens);
      document.getElementById('c-cw').textContent=fmt(t.cacheWriteTokens);
      document.getElementById('c-n').textContent=d.entries.length;

      const tbody=document.getElementById('tbody');
      if(!d.entries.length){
        tbody.innerHTML='<tr><td colspan="7" class="empty">Waiting for first log_usage call…</td></tr>';
        return;
      }
      tbody.innerHTML=[...d.entries].reverse().slice(0,25).map((entry,i)=>\`
        <tr class="\${i===0?'new':''}">
          <td class="dim">\${hhmm(entry.timestamp)}</td>
          <td><span class="badge">\${mdl(entry.model)}</span></td>
          <td class="\${entry.description?'':'dim'}">\${entry.description||'—'}</td>
          <td>\${fmt(entry.inputTokens)}</td>
          <td>\${fmt(entry.outputTokens)}</td>
          <td class="dim">\${fmt(entry.cacheReadTokens)}/\${fmt(entry.cacheWriteTokens)}</td>
          <td class="cost">\${cost(entry.totalCost)}</td>
        </tr>\`).join('');
      const nr=tbody.querySelector('tr.new');
      if(nr)setTimeout(()=>nr.classList.remove('new'),1500);
    };
  </script>
</body>
</html>`;

// ─── Handler registration (called on each Server instance) ───────────────────

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

        const entry = addUsageEntry(
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          description,
        );

        usageEmitter.emit("update"); // push live update to dashboard clients

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

// ─── Start ────────────────────────────────────────────────────────────────────

function addCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/** Build a fresh MCP Server instance with all tools registered. */
function createMcpServer(): Server {
  const s = new Server(
    { name: "token-counter-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerHandlers(s);
  return s;
}

// ─── Rate limiter (per IP, in-memory) ────────────────────────────────────────
const RATE_LIMIT = 60;          // max requests per window
const RATE_WINDOW_MS = 60_000;  // 1-minute window

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
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    });
    res.end(JSON.stringify({ error: "Rate limit exceeded. Max 60 requests/minute." }));
    return false;
  }
  return true;
}

async function startHttpServer(port: number) {
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    addCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // Health check — Railway uses this to confirm the service is up
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "token-counter-mcp", sessions: transports.size }));
      return;
    }

    // Live dashboard UI
    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    // SSE stream for dashboard live updates
    if (url.pathname === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      const send = () => {
        try { res.write(`data: ${JSON.stringify(loadSession())}\n\n`); } catch { /* client gone */ }
      };
      send();
      usageEmitter.on("update", send);
      const heartbeat = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => { clearInterval(heartbeat); usageEmitter.off("update", send); });
      return;
    }

    // SSE endpoint — MCP client opens a persistent GET connection here
    if (url.pathname === "/sse" && req.method === "GET") {
      if (!checkRateLimit(req, res)) return;
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => transports.delete(transport.sessionId);

      const sessionServer = createMcpServer();
      await sessionServer.connect(transport);
      return;
    }

    // Message endpoint — MCP client POSTs JSON-RPC messages here
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

    res.writeHead(404);
    res.end();
  });

  httpServer.listen(port, () => {
    process.stderr.write(`Token Counter MCP running on port ${port}\n`);
    process.stderr.write(`SSE endpoint: http://0.0.0.0:${port}/sse\n`);
  });
}

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
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      const send = () => {
        try { res.write(`data: ${JSON.stringify(loadSession())}\n\n`); } catch { /* client gone */ }
      };
      send();
      usageEmitter.on("update", send);
      const heartbeat = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => { clearInterval(heartbeat); usageEmitter.off("update", send); });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  srv.listen(port, () => {
    process.stderr.write(`Dashboard → http://localhost:${port}\n`);
  });
}

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT) : null;

  if (port) {
    // HTTP/SSE mode — Railway sets PORT automatically
    await startHttpServer(port);
  } else {
    // stdio mode — local Claude Code use
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Also serve the live dashboard on a separate port so you can watch usage in a browser
    startDashboardServer(8080);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
