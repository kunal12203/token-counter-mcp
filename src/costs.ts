// Pricing per 1M tokens (USD) — current as of 2026-03
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6": {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.50,
    cacheWritePerMillion: 18.75,
  },
  "claude-sonnet-4-6": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
  },
  "claude-haiku-4-5": {
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
    cacheReadPerMillion: 0.10,
    cacheWritePerMillion: 1.25,
  },
  // Legacy
  "claude-opus-4-5": {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.50,
    cacheWritePerMillion: 18.75,
  },
  "claude-sonnet-4-5": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
  },
};

const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
  cacheReadPerMillion: 0.30,
  cacheWritePerMillion: 3.75,
};

export function getPricing(model: string): ModelPricing {
  // Try exact match first
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // Try prefix match (e.g. "claude-opus-4-6-20260101" → "claude-opus-4-6")
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key)) return MODEL_PRICING[key]!;
  }

  return DEFAULT_PRICING;
}

export interface TokenCost {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): TokenCost {
  const pricing = getPricing(model);
  // inputTokens may be total (raw+cache) — subtract cache to get raw for cost calc
  const rawInput = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
  const inputCost = (rawInput / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return { inputCost, outputCost, cacheReadCost, cacheWriteCost, totalCost };
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(4)}m` ; // show in milli-dollars
  return `$${usd.toFixed(6)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
