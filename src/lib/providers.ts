// ── Provider configuration ────────────────────────────────────────────────────
// Each provider maps to an API base URL + API key + available models.
// Models now include contextWindow for token bar awareness.

export type ProviderId = "auto" | "groq" | "deepseek" | "qwen" | "openai" | "openrouter";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  models: { id: string; label: string }[];
}

const PROVIDERS: Record<Exclude<ProviderId, "auto">, ProviderConfig> = {
  openrouter: {
  name: "OpenRouter (free)",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  defaultModel: "deepseek/deepseek-v4-flash:free",
  models: [
    // ── Free coding models (updated May 2026) ─────────────────────────
    { id: "deepseek/deepseek-v4-flash:free",               label: "DeepSeek V4 Flash ★ (1M ctx)" },
    { id: "qwen/qwen3-coder:free",                         label: "Qwen3 Coder (262K ctx)" },
    { id: "openai/gpt-oss-120b:free",                      label: "OpenAI gpt-oss-120B (131K ctx)" },
    { id: "google/gemini-2.0-flash-exp:free",              label: "Gemini 2.0 Flash (1M ctx)" },
    { id: "z-ai/glm-4.5-air:free",                         label: "GLM 4.5 Air (131K ctx)" },
    { id: "meta-llama/llama-3.3-70b-instruct:free",        label: "LLaMA 3.3 70B (131K ctx)" },
    { id: "qwen/qwen3-235b-a22b:free",                     label: "Qwen3 235B (131K ctx)" },
    { id: "microsoft/mai-ds-r1:free",                      label: "Microsoft MAI-DS-R1 (163K ctx)" },
    { id: "nousresearch/hermes-3-llama-3.1-405b:free",     label: "Hermes 3 405B (131K ctx)" },
    { id: "deepseek/deepseek-r1:free",                     label: "DeepSeek R1 Reasoning (163K ctx)" },
    { id: "deepseek/deepseek-chat:free",                   label: "DeepSeek V3 Chat (163K ctx)" },
  ],
},
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "qwen-2.5-coder-32b",
    models: [
      { id: "qwen-2.5-coder-32b", label: "Qwen 2.5 Coder 32B", contextWindow: 128_000 },
      { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 70B", contextWindow: 128_000 },
      { id: "llama-3.3-70b-versatile", label: "LLaMA 3.3 70B", contextWindow: 128_000 },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: [
      { id: "deepseek-chat", label: "DeepSeek V4 Flash", contextWindow: 1_000_000 },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner (→ V4 Flash)" },
    ],
  },
  qwen: {
    id: "qwen",
    name: "Qwen (Alibaba Cloud)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3-coder-plus",
    models: [
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus ★ (262K ctx)", contextWindow: 262_144 },
      { id: "qwen3-coder-32b", label: "Qwen3 Coder 32B", contextWindow: 32_768 },
      { id: "qwen3-max", label: "Qwen3 Max", contextWindow: 128_000 },
      { id: "qwq-32b", label: "QWQ 32B (reasoning)", contextWindow: 32_768 },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: [
      { id: "gpt-4o", label: "GPT-4o", contextWindow: 128_000 },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", contextWindow: 128_000 },
      { id: "o3-mini", label: "o3 Mini", contextWindow: 200_000 },
      { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1_000_000 },
    ],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat:free",
    models: [
      { id: "deepseek/deepseek-chat:free", label: "DeepSeek V4 Flash ★ (1M ctx)", contextWindow: 1_000_000 },
      { id: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (reasoning)", contextWindow: 128_000 },
      { id: "qwen/qwen3-coder-plus:free", label: "Qwen3 Coder Plus (262K ctx)", contextWindow: 262_144 },
      { id: "qwen/qwen3-max:free", label: "Qwen3 Max", contextWindow: 128_000 },
      { id: "google/gemini-2.0-flash-001:free", label: "Gemini 2.0 Flash", contextWindow: 1_000_000 },
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

export function getAllPublicProviders(): PublicProvider[] {
  const result: PublicProvider[] = [];
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    let configured = true;
    try { getApiKey(id as ProviderId); } catch { configured = false; }
    result.push({
      id: id as ProviderId,
      name: cfg.name,
      configured,
      defaultModel: cfg.defaultModel,
      models: cfg.models,
    });
  }
  return result;
}

export function getAutoProvider(): ProviderConfig {
  return {
    id: "auto",
    name: "Auto Router",
    baseUrl: "",
    apiKey: "",
    defaultModel: "",
    models: [],
  };
}
