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
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface PublicProvider {
  id: ProviderId;
  name: string;
  configured: boolean;
  defaultModel: string;
  models: ModelConfig[];
}

// ── Deprecated model remapping ────────────────────────────────────────────────
const DEPRECATED_MODEL_MAP: Record<string, string> = {
  "deepseek-reasoner": "deepseek/deepseek-chat:free",
  "deepseek-chat": "deepseek/deepseek-chat:free",
};

export function resolveModel(modelId: string): string {
  return DEPRECATED_MODEL_MAP[modelId] ?? modelId;
}

// ── Provider definitions ──────────────────────────────────────────────────────
const PROVIDERS: Record<ProviderId, Omit<ProviderConfig, "apiKey">> = {
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

// ── Config helpers ────────────────────────────────────────────────────────────
function getApiKey(providerId: ProviderId): string {
  const keyMap: Record<ProviderId, string | undefined> = {
    groq:      process.env.GROQ_API_KEY,
    deepseek:  process.env.DEEPSEEK_API_KEY,
    qwen:      process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY,
    openai:    process.env.OPENAI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    auto:      undefined,
  };
  const key = keyMap[providerId];
  if (!key) throw new Error(`${providerId} API key not configured`);
  return key;
}

export function getProvider(providerId?: string): ProviderConfig {
  const id = (providerId || "auto") as ProviderId;
  if (id === "auto") {
    return {
      id: "auto",
      name: "Auto Router",
      baseUrl: "",
      apiKey: "",
      defaultModel: "",
      models: [],
    };
  }
  const cfg = PROVIDERS[id];
  if (!cfg) throw new Error(`Unknown provider: ${id}`);
  const apiKey = getApiKey(id);
  return { ...cfg, apiKey };
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
