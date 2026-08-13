// ── Environment validation ────────────────────────────────────────────────────
// A single source of truth for "what env vars does this deployment have set,
// and what does that mean for which features work". Used by /api/health and
// can be imported anywhere a route wants a quick, honest answer instead of
// discovering a missing var three fetch calls deep.

export interface EnvCheck {
  key: string;
  required: boolean;
  present: boolean;
  description: string;
}

export interface EnvReport {
  ok: boolean; // true if every REQUIRED var is present
  checks: EnvCheck[];
  warnings: string[];
}

const CHECKS: Omit<EnvCheck, "present">[] = [
  {
    key: "GITHUB_PAT",
    required: false,
    description: "GitHub personal access token — needed for the repo browser, pushing commits, and cross-device history sync (gist scope).",
  },
  {
    key: "APP_PASSWORD",
    required: false,
    description: "Optional password gate for all sensitive API routes.",
  },
  {
    key: "GROQ_API_KEY",
    required: false,
    description: "Enables the Groq provider (fast Llama/Qwen models).",
  },
  {
    key: "DEEPSEEK_API_KEY",
    required: false,
    description: "Enables the DeepSeek provider.",
  },
  {
    key: "QWEN_API_KEY",
    required: false,
    description: "Enables the Qwen provider (or set DASHSCOPE_API_KEY).",
  },
  {
    key: "DASHSCOPE_API_KEY",
    required: false,
    description: "Alternate env var name for the Qwen / DashScope API key.",
  },
  {
    key: "OPENAI_API_KEY",
    required: false,
    description: "Enables the OpenAI provider.",
  },
  {
    key: "OPENROUTER_API_KEY",
    required: false,
    description: "Enables the OpenRouter provider (aggregates many free/paid models).",
  },
  {
    key: "AGENT_WATCHDOG_MS",
    required: false,
    description: "Per-request time budget for the agent loop before it hands off to a continuation batch. Defaults to 45000ms.",
  },
];

/**
 * Builds a full report of which env vars are set. Nothing here is strictly
 * "required" at the process level (the app boots fine with zero keys — it
 * just can't call any model provider), but we still surface the practical
 * requirement: at least one LLM provider key, or the model pickers are all
 * "not configured" and every chat/agent request will fail immediately.
 */
export function checkEnv(): EnvReport {
  const checks: EnvCheck[] = CHECKS.map((c) => ({
    ...c,
    present: !!process.env[c.key],
  }));

  const warnings: string[] = [];

  const providerKeys = ["GROQ_API_KEY", "DEEPSEEK_API_KEY", "QWEN_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];
  const anyProviderConfigured = checks.some((c) => providerKeys.includes(c.key) && c.present);
  if (!anyProviderConfigured) {
    warnings.push("No LLM provider API key is set — chat and the agent will fail on every request. Set at least one of: " + providerKeys.join(", ") + ".");
  }

  if (!checks.find((c) => c.key === "GITHUB_PAT")?.present) {
    warnings.push("GITHUB_PAT is not set — the GitHub panel, repo browsing, pushing, and cross-device sync are all disabled.");
  }

  // Nothing is hard-"required" to boot, so `ok` reflects whether the app is
  // actually usable rather than whether the process crashes.
  const ok = anyProviderConfigured;

  return { ok, checks, warnings };
}
