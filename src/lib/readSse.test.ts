import { describe, expect, it } from "vitest";
import { readSse, type ServerSentEvent } from "./readSse";

describe("readSse", () => {
  it("preserves event names across arbitrarily split chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: us",
      "age\ndata: {\"usage\":",
      "{\"total_tokens\":12}}\n\n",
      "data: {\"type\":\"done\"}\n\n",
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      })
    );
    const events: ServerSentEvent[] = [];

    await readSse(response, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { event: "usage", data: '{"usage":{"total_tokens":12}}' },
      { event: "message", data: '{"type":"done"}' },
    ]);
  });

  it("joins multiline data fields", async () => {
    const response = new Response("data: first\ndata: second");
    const events: ServerSentEvent[] = [];
    await readSse(response, (event) => {
      events.push(event);
    });
    expect(events[0].data).toBe("first\nsecond");
  });
});
