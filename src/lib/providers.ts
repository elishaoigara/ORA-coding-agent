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

// DeepSeek retired the legacy deepseek-chat/deepseek-reasoner aliases on
// 24 July 2026. Keep saved conversations working by resolving those aliases
// inside the selected provider's namespace.
const DEEPSEEK_MODEL_ALIASES: Record<string, string> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
};

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  "deepseek-chat": "deepseek/deepseek-v4-flash:free",
  "deepseek-reasoner": "deepseek/deepseek-v4-flash:free",
  "deepseek/deepseek-chat:free": "deepseek/deepseek-v4-flash:free",
};

export function resolveModel(modelId: string, providerId?: ProviderId): string {
  if (providerId === "deepseek") return DEEPSEEK_MODEL_ALIASES[modelId] ?? modelId;
  if (providerId === "openrouter") return OPENROUTER_MODEL_ALIASES[modelId] ?? modelId;
  return modelId;
}

// ── Provider definitions ──────────────────────────────────────────────────────
type RealProviderId = Exclude<ProviderId, "auto">;

const PROVIDERS: Record<RealProviderId, Omit<ProviderConfig, "apiKey">> = {
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", contextWindow: 131_072 },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", contextWindow: 131_072 },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", contextWindow: 131_072 },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", contextWindow: 1_000_000 },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", contextWindow: 1_000_000 },
    ],
  },
  qwen: {
    id: "qwen",
    name: "Qwen (Alibaba Cloud)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3-coder-plus",
    models: [
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", contextWindow: 1_000_000 },
      { id: "qwen3-coder-next", label: "Qwen3 Coder Next", contextWindow: 262_144 },
      { id: "qwen3-coder-flash", label: "Qwen3 Coder Flash", contextWindow: 1_000_000 },
      { id: "qwen3-max", label: "Qwen3 Max", contextWindow: 262_144 },
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
    defaultModel: "deepseek/deepseek-v4-flash:free",
    models: [
      { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash", contextWindow: 1_048_576 },
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
  const cfg = PROVIDERS[id as RealProviderId];
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

/** Returns just the ids of providers that currently have a valid API key configured. */
export function getConfiguredProviderIds(): RealProviderId[] {
  return getAllPublicProviders()
    .filter((p) => p.configured)
    .map((p) => p.id as RealProviderId);
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
