export type RouteDecision = {
  provider: string;
  model: string;
  reason: string;
};

const REASON_SIGNALS = [
  "architect", "architecture", "design system", "tradeoff", "tradeoffs",
  "compare", "vs ", " vs ", "pros and cons", "best approach", "best way",
  "should i use", "which is better", "explain why", "why does", "how does",
  "difference between", "when to use", "refactor entire", "restructure",
  "system design", "scalab", "performance implication",
];

const CODE_SIGNALS = [
  "write", "create", "build", "implement", "generate", "make a",
  "fix", "debug", "bug", "error", "exception", "not working", "broken",
  "refactor", "improve", "optimise", "optimize", "clean up",
  "add feature", "add a", "unit test", "write test", "test for",
  "convert", "migrate", "rewrite", "function that", "class that",
  "component", "api endpoint", "hook ", "middleware",
];

const QUICK_SIGNALS = [
  "what is", "what are", "define ", "meaning of", "example of",
  "how do i", "how to ", "syntax for", "quick", "simple",
  "show me", "list ", "give me",
];

export function routeMessage(
  userMessage: string,
  configuredProviders: string[]
): RouteDecision {
  const msg = userMessage.toLowerCase();
  const wordCount = msg.split(/\s+/).length;
  const has = (signals: string[]) => signals.some((s) => msg.includes(s));

  // Bug fix #6: "deepseek-v4-pro" / "deepseek-v4-flash" / the openrouter
  // slug below are marketing names, not real API model ids — DeepSeek's own
  // "V4 Flash" model is exposed at the API level simply as "deepseek-chat".
  // Sending the marketing name as the `model` field causes the upstream
  // provider to reject the request with a "model not found" error. These
  // now point at the ids actually registered in lib/providers.ts.
  if (configuredProviders.includes("deepseek") && (has(REASON_SIGNALS) || wordCount > 80)) {
    return { provider: "deepseek", model: "deepseek-chat", reason: "auto -> DeepSeek V4 Flash (reasoning-length task)" };
  }

  if (configuredProviders.includes("qwen") && has(CODE_SIGNALS)) {
    return { provider: "qwen", model: "qwen3-coder-plus", reason: "auto -> Qwen3 Coder (coding)" };
  }

  if (configuredProviders.includes("groq") && (has(QUICK_SIGNALS) || wordCount < 15)) {
    return { provider: "groq", model: "llama-3.3-70b-versatile", reason: "auto -> Groq LLaMA (fast)" };
  }

  if (configuredProviders.includes("deepseek")) {
    return { provider: "deepseek", model: "deepseek-chat", reason: "auto -> DeepSeek V4 Flash (default)" };
  }

  if (configuredProviders.includes("openrouter")) {
    return { provider: "openrouter", model: "deepseek/deepseek-chat:free", reason: "auto -> OpenRouter DeepSeek (free)" };
  }

  const fallback = configuredProviders[0] ?? "groq";
  return { provider: fallback, model: "", reason: `auto -> ${fallback} (fallback)` };
}