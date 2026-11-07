import type { NeuronCounter } from "./budget/NeuronCounter";

/** Every binding the Worker uses. The single source of binding types. */
export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  PROTEIN_CACHE: KVNamespace;
  NARRATION_CACHE: KVNamespace;
  BROWSE_LIMITER: RateLimit;
  NARRATE_LIMITER: RateLimit;
  NEURON_COUNTER: DurableObjectNamespace<NeuronCounter>;
  AI_MODEL: string;
  NEURON_DAILY_BUDGET: string;
  USER_AGENT: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  NCBI_API_KEY: string;
}

/** Hono generic for routes and middleware. */
export interface AppBindings {
  Bindings: Env;
}
