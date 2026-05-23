/**
 * AI Provider Abstraction
 * ─────────────────────────────────────────────────────────────
 * To swap providers, change ACTIVE_PROVIDER in .env.local.
 * All providers expose an OpenAI-compatible /chat/completions
 * endpoint, so the fetch logic is identical — only the base
 * URL, model name, and API key change.
 *
 * Supported today:  groq | deepseek | openai | anthropic
 * Adding a new one: add a block to PROVIDERS below. That's it.
 */

export type Provider = "groq" | "deepseek" | "openai" | "anthropic";

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  /** Models available for this provider */
  models: { id: string; label: string }[];
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY ?? "",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      { id: "llama-3.3-70b-versatile", label: "LLaMA 3.3 70B" },
      { id: "llama-3.1-8b-instant",    label: "LLaMA 3.1 8B (fast)" },
      { id: "mixtral-8x7b-32768",      label: "Mixtral 8x7B" },
      { id: "gemma2-9b-it",            label: "Gemma 2 9B" },
    ],
  },

  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    defaultModel: "deepseek-coder",
    models: [
      { id: "deepseek-coder",  label: "DeepSeek Coder" },
      { id: "deepseek-chat",   label: "DeepSeek Chat" },
      // Add deepseek-v4 here when it launches, no other changes needed
    ],
  },

  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    defaultModel: "gpt-4o",
    models: [
      { id: "gpt-4o",       label: "GPT-4o" },
      { id: "gpt-4o-mini",  label: "GPT-4o Mini" },
      { id: "o1-mini",      label: "o1 Mini" },
    ],
  },

  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    defaultModel: "claude-sonnet-4-20250514",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
};

export function getProvider(): ProviderConfig {
  const key = (process.env.ACTIVE_PROVIDER ?? "groq") as Provider;
  const config = PROVIDERS[key];
  if (!config) throw new Error(`Unknown provider: "${key}". Check ACTIVE_PROVIDER in .env.local`);
  if (!config.apiKey) throw new Error(`Missing API key for provider "${key}". Add it to .env.local`);
  return config;
}

/** Exposed to the client — no secrets */
export function getPublicProviderInfo() {
  const key = (process.env.ACTIVE_PROVIDER ?? "groq") as Provider;
  const config = PROVIDERS[key];
  return {
    name: config.name,
    models: config.models,
    defaultModel: config.defaultModel,
  };
}
