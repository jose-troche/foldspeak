import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export interface BudgetStatus {
  day: string;
  spent: number;
  budget: number;
  exhausted: boolean;
}

export interface Reservation extends BudgetStatus {
  allowed: boolean;
}

/** UTC day key. The Workers AI free allocation resets at 00:00 UTC. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Approximate daily neuron spend: the circuit breaker that stops a bad day becoming
 * a bill. A Durable Object, not KV, because it is written on every LLM call and KV's
 * 1,000 writes/day cannot absorb that. SQLite-backed so it runs on the Free plan.
 *
 * A single global instance (`idFromName("global")`) serializes every reservation, so
 * two concurrent requests cannot both squeeze under the threshold.
 */
export class NeuronCounter extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, neurons REAL NOT NULL)");
  }

  private spentOn(day: string): number {
    const row = this.sql.exec<{ neurons: number }>("SELECT neurons FROM spend WHERE day = ?", day).toArray()[0];
    return row?.neurons ?? 0;
  }

  private add(day: string, neurons: number): number {
    // Resetting on day change: yesterday's row is simply discarded.
    this.sql.exec("DELETE FROM spend WHERE day <> ?", day);
    this.sql.exec(
      "INSERT INTO spend (day, neurons) VALUES (?1, MAX(0, ?2)) ON CONFLICT(day) DO UPDATE SET neurons = MAX(0, neurons + ?2)",
      day,
      neurons,
    );
    return this.spentOn(day);
  }

  status(budget: number, now: number = Date.now()): BudgetStatus {
    const day = utcDayKey(new Date(now));
    const spent = this.spentOn(day);
    return { day, spent, budget, exhausted: spent >= budget };
  }

  /** Reserve an estimated spend. Increments only if the estimate fits under the budget. */
  reserve(estimate: number, budget: number, now: number = Date.now()): Reservation {
    const day = utcDayKey(new Date(now));
    const spent = this.spentOn(day);
    if (spent + estimate > budget) {
      return { day, spent, budget, exhausted: true, allowed: false };
    }
    const after = this.add(day, estimate);
    return { day, spent: after, budget, exhausted: after >= budget, allowed: true };
  }

  /** Correct a reservation once actual usage is known (delta may be negative). */
  reconcile(delta: number, now: number = Date.now()): number {
    return this.add(utcDayKey(new Date(now)), delta);
  }
}

export function counterStub(ns: DurableObjectNamespace<NeuronCounter>): DurableObjectStub<NeuronCounter> {
  return ns.get(ns.idFromName("global"));
}
