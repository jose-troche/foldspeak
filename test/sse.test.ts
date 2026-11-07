import { describe, expect, it } from "vitest";
import { estimateNeurons, eventText, neuronsFor, sseToText } from "../src/ai/narrate";

async function run(chunks: string[]) {
  const { transform, done } = sseToText();
  const enc = new TextEncoder();
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
      c.close();
    },
  });
  const out = await new Response(src.pipeThrough(transform)).text();
  return { out, result: await done };
}

describe("Workers AI SSE → text", () => {
  it("reads both event shapes, including digits that only arrive OpenAI-style", async () => {
    const { out } = await run([
      'data: {"response":"Length: "}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"238"}}]}\n\n',
      'data: {"response":" residues"}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(out).toBe("Length: 238 residues");
  });

  it("handles events split across chunk boundaries", async () => {
    const { out } = await run(['data: {"respo', 'nse":"Hel', 'lo"}\n', '\ndata: {"response":" world"}\n\n']);
    expect(out).toBe("Hello world");
  });

  it("captures usage and skips malformed events", async () => {
    const { out, result } = await run([
      "data: {not json}\n\n",
      'data: {"response":"ok"}\n\n',
      'data: {"response":"","usage":{"prompt_tokens":900,"completion_tokens":12}}\n\n',
    ]);
    expect(out).toBe("ok");
    expect(result.usage).toEqual({ prompt_tokens: 900, completion_tokens: 12 });
    expect(result.text).toBe("ok");
  });

  it("handles a final event without a trailing newline", async () => {
    const { out } = await run(['data: {"response":"tail"}']);
    expect(out).toBe("tail");
  });

  it("eventText coerces numeric tokens", () => {
    expect(eventText({ response: 42 })).toBe("42");
    expect(eventText({ choices: [{ text: "x" }] })).toBe("x");
    expect(eventText({})).toBe("");
  });
});

describe("neuron estimates", () => {
  it("matches the spec's arithmetic for the 3B model (~32 neurons per call)", () => {
    expect(neuronsFor("@cf/meta/llama-3.2-3b-instruct", 3000, 600)).toBeCloseTo(32.16, 1);
  });

  it("unknown models are priced conservatively high", () => {
    expect(neuronsFor("@cf/some/huge-model", 3000, 600)).toBeGreaterThan(100);
  });

  it("estimates scale with prompt length", () => {
    const short = estimateNeurons("@cf/meta/llama-3.2-3b-instruct", [{ role: "user", content: "x".repeat(400) }]);
    const long = estimateNeurons("@cf/meta/llama-3.2-3b-instruct", [{ role: "user", content: "x".repeat(40000) }]);
    expect(long).toBeGreaterThan(short);
  });
});
