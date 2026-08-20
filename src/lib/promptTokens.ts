/**
 * Fast client-side estimate for prompt budgeting.
 * Most modern subword tokenizers average roughly four characters per token in
 * ordinary English/code text; this is guidance only, not billing telemetry.
 */
export function estimatePromptTokens(text: string): number {
  const normalized = text.trim();
  return normalized ? Math.max(1, Math.ceil(normalized.length / 4)) : 0;
}
