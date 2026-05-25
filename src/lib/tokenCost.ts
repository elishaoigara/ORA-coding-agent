/**
 * Token pricing and cost estimation for all ORA providers.
 *
 * Pricing is in USD per 1M tokens (same unit as the Claude Code source uses).
 * Update the tables below whenever providers change their pricing.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ModelPricing {
  inputPer1M: number;   // $ per 1M input tokens
  outputPer1M: number;  // $ per 1M output tokens
}

// ── Pricing tables ────────────────────────────────────────────────────────────
// Sources: provider pricing pages as of May 2026.

const GROQ_PRICING: Record<string, ModelPricing> = {
  "llama-3.3-70b-versatile":    { inputPer1M: 0.59,  outputPer1M: 0.79 },
  "llama-3.1-8b-instant":       { inputPer1M: 0.05,  outputPer1M: 0.08 },
  "moonshotai/kimi-k2-instruct":{ inputPer1M: 1.00,  outputPer1M: 3.00 },
  "mixtral-8x7b-32768":         { inputPer1M: 0.24,  outputPer1M: 0.24 },
};

const DEEPSEEK_PRICING: Record<string, ModelPricing> = {
  "deepseek-chat":     { inputPer1M: 0.27, outputPer1M: 1.10 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
};

const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-4o":                { inputPer1M: 2.50,  outputPer1M: 10.00 },
  "gpt-4o-mini":           { inputPer1M: 0.15,  outputPer1M: 0.60  },
  "o1":                    { inputPer1M: 15.00, outputPer1M: 60.00 },
  "o1-mini":               { inputPer1M: 3.00,  outputPer1M: 12.00 },
  "o3-mini":               { inputPer1M: 1.10,  outputPer1M: 4.40  },
  "gpt-4-turbo":           { inputPer1M: 10.00, outputPer1M: 30.00 },
};

const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":         { inputPer1M: 15.00, outputPer1M: 75.00 },
  "claude-sonnet-4-6":       { inputPer1M: 3.00,  outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001":{ inputPer1M: 1.00,  outputPer1M: 5.00  },
  "claude-3-5-sonnet-20241022":{ inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.80, outputPer1M: 4.00  },
};

const QWEN_PRICING: Record<string, ModelPricing> = {
  "qwen3-coder-plus":   { inputPer1M: 3.50,  outputPer1M: 14.00 },
  "qwen3-coder-flash":  { inputPer1M: 0.50,  outputPer1M: 2.00  },
  "qwen3-max":          { inputPer1M: 4.00,  outputPer1M: 16.00 },
  "deepseek-v3.2":      { inputPer1M: 0.27,  outputPer1M: 1.10  },
  "deepseek-v4-pro":    { inputPer1M: 0.50,  outputPer1M: 2.00  },
};

const PROVIDER_PRICING: Record<string, Record<string, ModelPricing>> = {
  groq:      GROQ_PRICING,
  deepseek:  DEEPSEEK_PRICING,
  openai:    OPENAI_PRICING,
  anthropic: ANTHROPIC_PRICING,
  qwen:      QWEN_PRICING,
};

// Fallback pricing when model isn't in the table (e.g. a new model you added)
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  groq:      { inputPer1M: 0.20,  outputPer1M: 0.40  },
  deepseek:  { inputPer1M: 0.27,  outputPer1M: 1.10  },
  openai:    { inputPer1M: 2.50,  outputPer1M: 10.00 },
  anthropic: { inputPer1M: 3.00,  outputPer1M: 15.00 },
  qwen:      { inputPer1M: 1.00,  outputPer1M: 4.00  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getPricing(providerId: string, modelId: string): ModelPricing {
  const table = PROVIDER_PRICING[providerId] ?? {};

  // Exact match first
  if (table[modelId]) return table[modelId];

  // Prefix match (handles dated variants like "qwen3-coder-plus-2025-09-23")
  const prefix = Object.keys(table).find((k) => modelId.startsWith(k));
  if (prefix) return table[prefix];

  return FALLBACK_PRICING[providerId] ?? { inputPer1M: 1.00, outputPer1M: 3.00 };
}

export function calcCostUsd(
  promptTokens: number,
  completionTokens: number,
  providerId: string,
  modelId: string,
): number {
  const pricing = getPricing(providerId, modelId);
  return (
    (promptTokens    / 1_000_000) * pricing.inputPer1M +
    (completionTokens / 1_000_000) * pricing.outputPer1M
  );
}

export function buildTokenUsage(
  rawUsage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined,
  providerId: string,
  modelId: string,
): TokenUsage | null {
  if (!rawUsage) return null;
  const promptTokens     = rawUsage.prompt_tokens ?? 0;
  const completionTokens = rawUsage.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCostUsd: calcCostUsd(promptTokens, completionTokens, providerId, modelId),
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(usd: number): string {
  if (usd === 0)    return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  if (usd < 1)      return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function sumUsage(usages: (TokenUsage | undefined | null)[]): TokenUsage {
  return usages.reduce<TokenUsage>(
    (acc, u) => {
      if (!u) return acc;
      return {
        promptTokens:     acc.promptTokens + u.promptTokens,
        completionTokens: acc.completionTokens + u.completionTokens,
        totalTokens:      acc.totalTokens + u.totalTokens,
        estimatedCostUsd: acc.estimatedCostUsd + u.estimatedCostUsd,
      };
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
  );
}