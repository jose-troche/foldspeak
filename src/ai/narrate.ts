import type { Env } from "../env";
import type { Depth, Dossier } from "../dossier/schema";
import { buildMessages, type ChatMessage } from "./prompts";

/** Neurons per million tokens, from the Workers AI pricing page. */
export const NEURON_RATES: Record<string, { input: number; output: number }> = {
  "@cf/meta/llama-3.2-3b-instruct": { input: 4625, output: 30475 },
  "@cf/meta/llama-3.2-1b-instruct": { input: 2457, output: 18252 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { input: 4119, output: 34868 },
};
/** Unknown model: assume something expensive so the breaker errs on the safe side. */
const FALLBACK_RATE = { input: 30_000, output: 200_000 };

export const MAX_OUTPUT_TOKENS = 700;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function neuronsFor(model: string, inputTokens: number, outputTokens: number): number {
  const rate = NEURON_RATES[model] ?? FALLBACK_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}

/** Worst-case estimate for a call: full prompt, maximum output. */
export function estimateNeurons(model: string, messages: ChatMessage[]): number {
  const input = estimateTokens(messages.map((m) => m.content).join("\n"));
  return neuronsFor(model, input, MAX_OUTPUT_TOKENS);
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface NarrationResult {
  text: string;
  usage: Usage | undefined;
}

interface SseEvent {
  response?: unknown;
  choices?: { delta?: { content?: unknown }; text?: unknown }[];
  usage?: Usage;
}

/**
 * Workers AI streams a mix of two event shapes: the legacy `{"response": "..."}` and
 * OpenAI-style `{"choices":[{"delta":{"content":"..."}}]}`. In practice some tokens
 * (digits, for one) arrive only in the second shape, so both must be read or the
 * narration silently loses every number.
 */
export function eventText(ev: SseEvent): string {
  const candidates = [ev.response, ev.choices?.[0]?.delta?.content, ev.choices?.[0]?.text];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
    if (typeof c === "number") return String(c);
  }
  return "";
}

/**
 * Convert Workers AI's server-sent events (`data: {"response":"..."}`) into a plain
 * UTF-8 text stream, accumulating the full text and usage for caching and budget
 * reconciliation. `done` rejects if the upstream stream errors, so a truncated
 * narration is never cached.
 */
export function sseToText(): { transform: TransformStream<Uint8Array, Uint8Array>; done: Promise<NarrationResult> } {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let text = "";
  let usage: Usage | undefined;
  let resolve!: (r: NarrationResult) => void;
  let reject!: (e: unknown) => void;
  const done = new Promise<NarrationResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Avoid an unhandled rejection if nobody awaits `done`.
  done.catch(() => {});

  const handleLine = (line: string, ctrl: TransformStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const json = JSON.parse(data) as SseEvent;
      const piece = eventText(json);
      if (piece) {
        text += piece;
        ctrl.enqueue(encoder.encode(piece));
      }
      if (json.usage) usage = json.usage;
    } catch {
      // A malformed event is skipped, not fatal.
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, nl), ctrl);
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(ctrl) {
      buffer += decoder.decode();
      if (buffer) handleLine(buffer, ctrl);
      resolve({ text, usage });
    },
    cancel(reason) {
      reject(reason ?? new Error("stream cancelled"));
    },
  });
  return { transform, done };
}

export interface NarrationStream {
  stream: ReadableStream<Uint8Array>;
  done: Promise<NarrationResult>;
  estimate: number;
  model: string;
  /** Estimated prompt tokens, used when the AI binding reports no usage. */
  inputTokens: number;
}

export function narrationEstimate(env: Env, dossier: Dossier, depth: Depth): number {
  return estimateNeurons(env.AI_MODEL, buildMessages(dossier, depth));
}

/** Start a streaming, grounded narration. The caller has already reserved budget. */
export async function startNarration(env: Env, dossier: Dossier, depth: Depth): Promise<NarrationStream> {
  const messages = buildMessages(dossier, depth);
  const model = env.AI_MODEL;
  const upstream = (await env.AI.run(model as keyof AiModels, {
    messages,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
  } as never)) as unknown;

  if (!(upstream instanceof ReadableStream)) {
    throw new Error("Workers AI did not return a stream");
  }
  const { transform, done } = sseToText();
  const stream = (upstream as ReadableStream<Uint8Array>).pipeThrough(transform);
  // If the upstream errors mid-stream, pipeThrough errors the readable side; surface that in `done`.
  const inputTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
  return { stream, done, estimate: estimateNeurons(model, messages), model, inputTokens };
}

/** Actual neurons for a finished call, from reported usage when available. */
export function actualNeurons(model: string, inputTokens: number, result: NarrationResult): number {
  const input = result.usage?.prompt_tokens ?? inputTokens;
  const output = result.usage?.completion_tokens ?? estimateTokens(result.text);
  return neuronsFor(model, input, output);
}
