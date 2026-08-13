import type { ProviderConfig } from "@/lib/providers";
import type {
  AgentCompletion,
  AgentCompletionRequest,
} from "./types";

const MAX_TOKENS = 32_000;

export class ProviderRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string
  ) {
    super(`Provider request failed with status ${status}`);
    this.name = "ProviderRequestError";
  }
}

function isQwenProvider(baseUrl: string): boolean {
  return baseUrl.includes("dashscope") || baseUrl.includes("aliyun");
}

function isQwenModel(model: string): boolean {
  return /^(qwen|qwq|qvq)/i.test(model);
}

function providerHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };

  if (provider.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = "https://github.com/elishaoigara/ORA-coding-agent";
    headers["X-Title"] = "ORA Coding Agent";
  }

  return headers;
}

function requestBody(
  provider: ProviderConfig,
  request: AgentCompletionRequest
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
    tools: request.tools,
    tool_choice: request.forceText ? "none" : "auto",
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    stream: false,
  };

  if (isQwenProvider(provider.baseUrl) && isQwenModel(request.model)) {
    body.enable_thinking = false;
  }

  return body;
}

export async function createAgentCompletion(
  provider: ProviderConfig,
  request: AgentCompletionRequest,
  timeoutMs: number,
  requestSignal?: AbortSignal
): Promise<AgentCompletion> {
  const abortController = new AbortController();
  const abortFromRequest = () => abortController.abort();
  requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: providerHeaders(provider),
      body: JSON.stringify(requestBody(provider, request)),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new ProviderRequestError(response.status, await response.text());
    }

    return (await response.json()) as AgentCompletion;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}
