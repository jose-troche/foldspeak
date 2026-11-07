import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { utcDayKey } from "../src/budget/NeuronCounter";

const stub = (name = "global") => env.NEURON_COUNTER.get(env.NEURON_COUNTER.idFromName(name));
const DAY1 = Date.parse("2026-11-07T12:00:00Z");
const DAY1_LATE = Date.parse("2026-11-07T23:59:59Z");
const DAY2 = Date.parse("2026-11-08T00:00:01Z");

describe("NeuronCounter (SQLite-backed Durable Object)", () => {
  it("reserves while under budget and refuses once the estimate would cross it", async () => {
    const c = stub("reserve");
    expect(await c.reserve(30, 100, DAY1)).toMatchObject({ allowed: true, spent: 30 });
    expect(await c.reserve(30, 100, DAY1)).toMatchObject({ allowed: true, spent: 60 });
    expect(await c.reserve(30, 100, DAY1)).toMatchObject({ allowed: true, spent: 90 });
    expect(await c.reserve(30, 100, DAY1)).toMatchObject({ allowed: false, spent: 90, exhausted: true });
    expect(await c.status(100, DAY1)).toMatchObject({ spent: 90, exhausted: false });
  });

  it("resets when the UTC day changes", async () => {
    const c = stub("reset");
    await c.reserve(95, 100, DAY1);
    expect((await c.reserve(10, 100, DAY1_LATE)).allowed).toBe(false);
    expect(await c.reserve(10, 100, DAY2)).toMatchObject({ allowed: true, spent: 10, day: "2026-11-08" });
  });

  it("reconciles estimates against actual usage, never below zero", async () => {
    const c = stub("reconcile");
    await c.reserve(40, 100, DAY1);
    expect(await c.reconcile(-15, DAY1)).toBe(25);
    expect(await c.reconcile(-1000, DAY1)).toBe(0);
    expect(await c.reconcile(-5, DAY2)).toBe(0);
  });

  it("persists across instances (storage, not memory)", async () => {
    await stub("persist").reserve(12, 100, DAY1);
    expect((await stub("persist").status(100, DAY1)).spent).toBe(12);
  });

  it("day keys are UTC", () => {
    expect(utcDayKey(new Date("2026-11-07T23:30:00-05:00"))).toBe("2026-11-08");
  });
});
