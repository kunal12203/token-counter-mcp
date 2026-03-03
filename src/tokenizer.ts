import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export interface CountResult {
  inputTokens: number;
  model: string;
}

/**
 * Count tokens in a plain text string by wrapping it as a single user message.
 */
export async function countTextTokens(text: string, model = "claude-opus-4-6"): Promise<CountResult> {
  const response = await getClient().messages.countTokens({
    model,
    messages: [{ role: "user", content: text }],
  });
  return { inputTokens: response.input_tokens, model };
}

export interface MessageParam {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * Count tokens in a full conversation (messages + optional system prompt).
 * Mirrors what the API would actually charge as input tokens.
 */
export async function countMessageTokens(
  messages: MessageParam[],
  system?: string,
  model = "claude-opus-4-6",
): Promise<CountResult> {
  const response = await getClient().messages.countTokens({
    model,
    messages: messages as Anthropic.MessageParam[],
    ...(system ? { system } : {}),
  });
  return { inputTokens: response.input_tokens, model };
}
