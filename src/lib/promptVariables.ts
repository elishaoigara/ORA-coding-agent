const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]{0,39})\s*\}\}/g;

export function extractPromptVariables(prompt: string): string[] {
  const names = new Set<string>();
  for (const match of prompt.matchAll(VARIABLE_PATTERN)) names.add(match[1]);
  return [...names];
}

export function resolvePromptVariables(prompt: string, values: Record<string, string>): string {
  return prompt.replace(VARIABLE_PATTERN, (full, name: string) => {
    const value = values[name]?.trim();
    return value ? value : full;
  });
}
