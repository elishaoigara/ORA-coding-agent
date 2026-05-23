export type ProviderId = "auto" | "groq" | "deepseek" | "qwen" | "openai" | "anthropic";

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  models: { id: string; label: string }[];
}

const PROVIDERS: Record<Exclude<ProviderId, "auto">, ProviderConfig> = {
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY ?? "",
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      { id: "llama-3.3-70b-versatile",    label: "LLaMA 3.3 70B" },
      { id: "llama-3.1-8b-instant",        label: "LLaMA 3.1 8B (fast)" },
      { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2" },
      { id: "mixtral-8x7b-32768",          label: "Mixtral 8x7B" },
    ],
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat",     label: "DeepSeek V3 (Chat)" },
      { id: "deepseek-reasoner", label: "DeepSeek R1 (Reasoner)" },
    ],
  },
  qwen: {
    name: "Qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    defaultModel: "qwen3-coder-plus",
    models: [
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus" },
      { id: "qwen3-max",        label: "Qwen3 Max" },
      { id: "qwen3-plus",       label: "Qwen3 Plus" },
      { id: "qwen3-turbo",      label: "Qwen3 Turbo (fast)" },
    ],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    defaultModel: "gpt-4o",
    models: [
      { id: "gpt-4o",      label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    ],
  },
  anthropic: {
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    defaultModel: "claude-sonnet-4-6",
    models: [
      { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
};

export function getProvider(id?: string): ProviderConfig {
  const key = (id ?? process.env.ACTIVE_PROVIDER ?? "groq") as Exclude<ProviderId, "auto">;
  const config = PROVIDERS[key];
  if (!config) throw new Error(`Unknown provider: "${key}"`);
  if (!config.apiKey) throw new Error(`Missing API key for provider "${key}". Add it to .env.local`);
  return config;
}

export function getAllPublicProviders() {
  return Object.entries(PROVIDERS).map(([id, config]) => ({
    id,
    name: config.name,
    models: config.models,
    defaultModel: config.defaultModel,
    configured: Boolean(config.apiKey),
  }));
}