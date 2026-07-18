export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// ── Per-model pricing (per 1M tokens) ─────────────────────────────────────────
// Pricing sources:
//   Groq:     https://console.groq.com/docs/pricing (2025-04)
//   DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
//   Qwen:     https://help.aliyun.com/zh/model-studio/getting-started/models (2025-04)
//   OpenAI:   https://openai.com/api/pricing/ (2025-04)
//   OpenRouter: varies by model; uses middle-band pricing

type PricingEntry = {
  input: number;   // $ per 1M input tokens
  output: number;  // $ per 1M output tokens
};

const PROVIDER_PRICING: Record<string, Record<string, PricingEntry>> = {
  groq: {
    "qwen-2.5-coder-32b":           { input: 0.79, output: 0.79 },
    "deepseek-r1-distill-llama-70b": { input: 0.75, output: 0.99 },
    "llama-3.3-70b-versatile":       { input: 0.59, output: 0.79 },
  },
  deepseek: {
    "deepseek-chat":  { input: 0.27, output: 1.10 },
    "deepseek-reasoner": { input: 0.14, output: 0.28 },
  },
  qwen: {
    "qwen3-coder-plus": { input: 3.50, output: 7.00 },
    "qwen3-coder-32b":  { input: 2.00, output: 6.00 },
    "qwen3-max":        { input: 4.00, output: 12.00 },
    "qwq-32b":          { input: 2.00, output: 6.00 },
  },
  openai: {
    "gpt-4o":       { input: 2.50, output: 10.00 },
    "gpt-4o-mini":  { input: 0.15, output: 0.60 },
    "o3-mini":      { input: 1.10, output: 4.40 },
    "gpt-4.1":      { input: 2.00, output: 8.00 },
  },
  openrouter: {
    "deepseek/deepseek-chat:free":      { input: 0, output: 0 },
    "deepseek/deepseek-r1:free":        { input: 0, output: 0 },
    "qwen/qwen3-coder-plus:free":       { input: 0, output: 0 },
    "qwen/qwen3-max:free":              { input: 0, output: 0 },
    "google/gemini-2.0-flash-001:free": { input: 0, output: 0 },
  },
};

const FALLBACK_PRICING: PricingEntry = { input: 2.00, output: 8.00 };

function getProviderName(model: string): string | null {
  for (const [provider, models] of Object.entries(PROVIDER_PRICING)) {
    if (models[model]) return provider;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function buildTokenUsage(
  llmResponse: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } },
  providerId: string,
  model: string
): TokenUsage {
  const usage = llmResponse.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (promptTokens + completionTokens);

  let pricing: PricingEntry = FALLBACK_PRICING;

  // Try exact model match first
  const providerModels = PROVIDER_PRICING[providerId];
  if (providerModels?.[model]) {
    pricing = providerModels[model];
  } else {
    // Try auto-detecting provider from model name
    const detectedProvider = getProviderName(model);
    if (detectedProvider) {
      const pm = PROVIDER_PRICING[detectedProvider];
      if (pm?.[model]) pricing = pm[model];
    }
    // Fallback: try matching model prefix
    for (const [, models] of Object.entries(PROVIDER_PRICING)) {
      const match = Object.entries(models).find(([key]) => model.includes(key) || key.includes(model));
      if (match) { pricing = match[1]; break; }
    }
  }

  const costInput  = (promptTokens / 1_000_000) * pricing.input;
  const costOutput = (completionTokens / 1_000_000) * pricing.output;
  const estimatedCostUsd = costInput + costOutput;

  return { promptTokens, completionTokens, totalTokens, estimatedCostUsd };
}

export function sumUsage(usages: (TokenUsage | null)[]): TokenUsage | null {
  const valid = usages.filter((u): u is TokenUsage => u !== null);
  if (valid.length === 0) return null;
  return {
    promptTokens: valid.reduce((s, u) => s + u.promptTokens, 0),
    completionTokens: valid.reduce((s, u) => s + u.completionTokens, 0),
    totalTokens: valid.reduce((s, u) => s + u.totalTokens, 0),
    estimatedCostUsd: valid.reduce((s, u) => s + u.estimatedCostUsd, 0),
  };
}

export function formatCost(usd: number): string {
  if (usd === 0) return "Free";
  if (usd < 0.001) return "<$0.001";
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
