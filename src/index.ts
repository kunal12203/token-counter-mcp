#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { countTextTokens, countMessageTokens, type MessageParam } from "./tokenizer.js";
import { addUsageEntry, loadSession, resetSession, getHistory } from "./storage.js";
import { calculateCost, getPricing, formatCost, formatTokens } from "./costs.js";

const server = new Server(
  { name: "token-counter-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate via stdio — no console.log to stdout
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
