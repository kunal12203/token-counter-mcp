import { encode } from "gpt-tokenizer";

// Lazy-load Anthropic SDK only if the API key is present
let _anthropicClient: import("@anthropic-ai/sdk").default | null = null;

function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function getAnthropicClient(): Promise<import("@anthropic-ai/sdk").default> {
  if (!_anthropicClient) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _anthropicClient = new Anthropic();
  }
  return _anthropicClient;
}

export interface CountResult {
  inputTokens: number;
  model: string;
  exact: boolean; // true = Anthropic API, false = local approximation
  method: "api" | "local";
}

export interface MessageParam {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

// ── Local estimation ──────────────────────────────────────────────────────────
// Uses gpt-tokenizer (cl100k_base BPE). Claude 3/4 tokenizer is proprietary,
// but their vocabularies are similar enough that counts are within ~1-3%.
// Adds Anthropic's per-message overhead (4 tokens/message + 2 reply-priming tokens).
function countLocal(text: string): number {
  return encode(text).length;
}

function localMessageTokens(messages: MessageParam[], system?: string): number {
  let total = 0;

  if (system) {
    total += countLocal(system) + 4; // system message overhead
  }

  for (const msg of messages) {
    total += 4; // per-message overhead (role + separator tokens)
    if (typeof msg.content === "string") {
      total += countLocal(msg.content);
    } else {
      for (const block of msg.content) {
        if (block.text) total += countLocal(block.text);
      }
    }
  }

  total += 2; // reply-priming tokens
  return total;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Count tokens in a plain text string.
 * Uses Anthropic API (exact) when ANTHROPIC_API_KEY is set, otherwise local estimate.
 */
export async function countTextTokens(text: string, model = "claude-opus-4-6"): Promise<CountResult> {
  if (hasApiKey()) {
    const client = await getAnthropicClient();
    const response = await client.messages.countTokens({
      model,
      messages: [{ role: "user", content: text }],
    });
    return { inputTokens: response.input_tokens, model, exact: true, method: "api" };
  }

  return {
    inputTokens: countLocal(text) + 4 + 2, // single message overhead
    model,
    exact: false,
    method: "local",
  };
}

/**
 * Count tokens in a full conversation (messages + optional system prompt).
 * Uses Anthropic API (exact) when ANTHROPIC_API_KEY is set, otherwise local estimate.
 */
export async function countMessageTokens(
  messages: MessageParam[],
  system?: string,
  model = "claude-opus-4-6",
): Promise<CountResult> {
  if (hasApiKey()) {
    const client = await getAnthropicClient();
    const response = await client.messages.countTokens({
      model,
      messages: messages as Parameters<import("@anthropic-ai/sdk").default["messages"]["countTokens"]>[0]["messages"],
      ...(system ? { system } : {}),
    });
    return { inputTokens: response.input_tokens, model, exact: true, method: "api" };
  }

  return {
    inputTokens: localMessageTokens(messages, system),
    model,
    exact: false,
    method: "local",
  };
}
