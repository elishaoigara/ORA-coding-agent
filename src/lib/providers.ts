export type ProviderId = "auto" | "groq" | "deepseek" | "qwen" | "openai" | "anthropic" | "openrouter";

export interface ProviderConfig {
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
    defaultModel: "deepseek-v4-flash",
    models: [
      // ── Current models ────────────────────────────────────────────────
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash ★ (Chat)" },
      { id: "deepseek-v4-pro",   label: "DeepSeek V4 Pro (Reasoner)" },
      // ── Legacy aliases (deprecated 2026/07/24) ────────────────────────
      { id: "deepseek-chat",     label: "DeepSeek V3 Chat (deprecated)" },
      { id: "deepseek-reasoner", label: "DeepSeek R1 Reasoner (deprecated)" },
    ],
  },
  qwen: {
    name: "Qwen / Model Studio",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    defaultModel: "qwen3-coder-plus",
    models: [
      // ── DeepSeek via Model Studio ──────────────────────────────────────
      { id: "deepseek-v3.2",                        label: "DeepSeek V3.2 ★" },
      { id: "deepseek-v4-pro",                      label: "DeepSeek V4 Pro" },
      { id: "deepseek-v4-flash",                    label: "DeepSeek V4 Flash" },

      // ── Qwen3 Coder ───────────────────────────────────────────────────
      { id: "qwen3-coder-plus",                     label: "Qwen3 Coder Plus ★" },
      { id: "qwen3-coder-plus-2025-09-23",          label: "Qwen3 Coder Plus (2025-09-23)" },
      { id: "qwen3-coder-plus-2025-07-22",          label: "Qwen3 Coder Plus (2025-07-22)" },
      { id: "qwen3-coder-next",                     label: "Qwen3 Coder Next" },
      { id: "qwen3-coder-480b-a35b-instruct",       label: "Qwen3 Coder 480B" },
      { id: "qwen3-coder-30b-a3b-instruct",         label: "Qwen3 Coder 30B" },
      { id: "qwen3-coder-flash",                    label: "Qwen3 Coder Flash" },
      { id: "qwen3-coder-flash-2025-07-28",         label: "Qwen3 Coder Flash (2025-07-28)" },

      // ── Qwen3.7 ───────────────────────────────────────────────────────
      { id: "qwen3.7-max",                          label: "Qwen3.7 Max" },
      { id: "qwen3.7-max-2026-05-20",               label: "Qwen3.7 Max (2026-05-20)" },

      // ── Qwen3.6 ───────────────────────────────────────────────────────
      { id: "qwen3.6-max-preview",                  label: "Qwen3.6 Max Preview" },
      { id: "qwen3.6-plus",                         label: "Qwen3.6 Plus" },
      { id: "qwen3.6-plus-2026-04-02",              label: "Qwen3.6 Plus (2026-04-02)" },
      { id: "qwen3.6-27b",                          label: "Qwen3.6 27B" },
      { id: "qwen3.6-35b-a3b",                      label: "Qwen3.6 35B A3B" },
      { id: "qwen3.6-flash",                        label: "Qwen3.6 Flash" },
      { id: "qwen3.6-flash-2026-04-16",             label: "Qwen3.6 Flash (2026-04-16)" },

      // ── Qwen3.5 ───────────────────────────────────────────────────────
      { id: "qwen3.5-122b-a10b",                    label: "Qwen3.5 122B A10B" },
      { id: "qwen3.5-397b-a17b",                    label: "Qwen3.5 397B A17B" },
      { id: "qwen3.5-27b",                          label: "Qwen3.5 27B" },
      { id: "qwen3.5-35b-a3b",                      label: "Qwen3.5 35B A3B" },
      { id: "qwen3.5-plus",                         label: "Qwen3.5 Plus" },
      { id: "qwen3.5-plus-2026-02-15",              label: "Qwen3.5 Plus (2026-02-15)" },
      { id: "qwen3.5-plus-2026-04-20",              label: "Qwen3.5 Plus (2026-04-20)" },
      { id: "qwen3.5-flash",                        label: "Qwen3.5 Flash" },
      { id: "qwen3.5-flash-2026-02-23",             label: "Qwen3.5 Flash (2026-02-23)" },

      // ── Qwen3 (text) ──────────────────────────────────────────────────
      { id: "qwen3-max",                            label: "Qwen3 Max ★" },
      { id: "qwen3-max-preview",                    label: "Qwen3 Max Preview" },
      { id: "qwen3-max-2026-01-23",                 label: "Qwen3 Max (2026-01-23)" },
      { id: "qwen3-max-2025-09-23",                 label: "Qwen3 Max (2025-09-23)" },
      { id: "qwen3-235b-a22b",                      label: "Qwen3 235B A22B" },
      { id: "qwen3-235b-a22b-thinking-2507",        label: "Qwen3 235B Thinking (2507)" },
      { id: "qwen3-235b-a22b-instruct-2507",        label: "Qwen3 235B Instruct (2507)" },
      { id: "qwen3-32b",                            label: "Qwen3 32B" },
      { id: "qwen3-30b-a3b",                        label: "Qwen3 30B A3B" },
      { id: "qwen3-30b-a3b-thinking-2507",          label: "Qwen3 30B Thinking (2507)" },
      { id: "qwen3-30b-a3b-instruct-2507",          label: "Qwen3 30B Instruct (2507)" },
      { id: "qwen3-next-80b-a3b-thinking",          label: "Qwen3 Next 80B Thinking" },
      { id: "qwen3-next-80b-a3b-instruct",          label: "Qwen3 Next 80B Instruct" },
      { id: "qwen3-14b",                            label: "Qwen3 14B" },
      { id: "qwen3-8b",                             label: "Qwen3 8B" },
      { id: "qwen3-0.6b",                           label: "Qwen3 0.6B (tiny/fast)" },

      // ── Qwen3 Vision/Multimodal ───────────────────────────────────────
      { id: "qwen3-vl-235b-a22b-thinking",          label: "Qwen3 VL 235B Thinking" },
      { id: "qwen3-vl-235b-a22b-instruct",          label: "Qwen3 VL 235B Instruct" },
      { id: "qwen3-vl-30b-a3b-thinking",            label: "Qwen3 VL 30B Thinking" },
      { id: "qwen3-vl-30b-a3b-instruct",            label: "Qwen3 VL 30B Instruct" },
      { id: "qwen3-vl-plus",                        label: "Qwen3 VL Plus" },
      { id: "qwen3-vl-plus-2025-09-23",             label: "Qwen3 VL Plus (2025-09-23)" },
      { id: "qwen3-vl-plus-2025-12-19",             label: "Qwen3 VL Plus (2025-12-19)" },
      { id: "qwen3-vl-flash",                       label: "Qwen3 VL Flash" },
      { id: "qwen3-vl-flash-2026-01-22",            label: "Qwen3 VL Flash (2026-01-22)" },
      { id: "qwen3-vl-flash-2025-10-15",            label: "Qwen3 VL Flash (2025-10-15)" },
      { id: "qwen3-vl-8b-thinking",                 label: "Qwen3 VL 8B Thinking" },
      { id: "qwen3-vl-8b-instruct",                 label: "Qwen3 VL 8B Instruct" },

      // ── Qwen Max/Plus/Flash (stable aliases) ─────────────────────────
      { id: "qwen-max",                             label: "Qwen Max ★" },
      { id: "qwen-plus",                            label: "Qwen Plus" },
      { id: "qwen-plus-latest",                     label: "Qwen Plus (latest)" },
      { id: "qwen-plus-2025-07-28",                 label: "Qwen Plus (2025-07-28)" },
      { id: "qwen-plus-2025-09-11",                 label: "Qwen Plus (2025-09-11)" },
      { id: "qwen-plus-2025-07-14",                 label: "Qwen Plus (2025-07-14)" },
      { id: "qwen-plus-2025-04-28",                 label: "Qwen Plus (2025-04-28)" },
      { id: "qwen-flash",                           label: "Qwen Flash" },
      { id: "qwen-flash-2025-07-28",                label: "Qwen Flash (2025-07-28)" },
      { id: "qwen-turbo",                           label: "Qwen Turbo" },

      // ── Qwen Vision ───────────────────────────────────────────────────
      { id: "qwen-vl-ocr-2025-11-20",               label: "Qwen VL OCR (2025-11-20)" },
      { id: "qwen-vl-ocr",                          label: "Qwen VL OCR" },
      { id: "qwen-vl-plus",                         label: "Qwen VL Plus" },
      { id: "qwen-vl-max",                          label: "Qwen VL Max" },

      // ── Qwen Translation ─────────────────────────────────────────────
      { id: "qwen-mt-plus",                         label: "Qwen MT Plus" },
      { id: "qwen-mt-turbo",                        label: "Qwen MT Turbo" },
      { id: "qwen-mt-flash",                        label: "Qwen MT Flash" },
      { id: "qwen-mt-lite",                         label: "Qwen MT Lite" },

      // ── Qwen Character ───────────────────────────────────────────────
      { id: "qwen-plus-character",                  label: "Qwen Plus Character" },
      { id: "qwen-flash-character",                 label: "Qwen Flash Character" },

      // ── Reasoning ────────────────────────────────────────────────────
      { id: "qwq-plus",                             label: "QwQ Plus" },
      { id: "qvq-max",                              label: "QVQ Max (visual reasoning)" },
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