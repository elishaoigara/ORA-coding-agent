export interface ServerSentEvent {
  event: string;
  data: string;
}

function parseEvent(block: string): ServerSentEvent | null {
  let event = "message";
  const data: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim() || "message";
    if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }

  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

/** Reads an SSE response without losing events split across network chunks. */
export async function readSse(
  response: Response,
  onEvent: (event: ServerSentEvent) => void | Promise<void>
): Promise<void> {
  if (!response.body) throw new Error("The server returned an empty stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const parsed = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) await onEvent(parsed);
        boundary = buffer.indexOf("\n\n");
      }

      if (done) {
        completed = true;
        break;
      }
    }

    const trailing = parseEvent(buffer);
    if (trailing) await onEvent(trailing);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
