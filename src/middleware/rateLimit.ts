import type { MiddlewareHandler } from "hono";
import type { AppBindings, Env } from "../env";
import { AppError, errorResponse } from "../lib/errors";

type LimiterName = "BROWSE_LIMITER" | "NARRATE_LIMITER";

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * Per-IP limit via the Workers Rate Limiting binding. Limits are per Cloudflare
 * location, so this is a cheap loose filter against casual abuse, not strict
 * prevention: it is the first layer because it is cheap, not because it is enough.
 */
export function rateLimit(name: LimiterName, periodSeconds = 60): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const limiter = (c.env as Env)[name];
    let allowed = true;
    try {
      ({ success: allowed } = await limiter.limit({ key: clientIp(c.req.raw) }));
    } catch {
      // A limiter outage should not take the site down with it.
      allowed = true;
    }
    if (!allowed) {
      return errorResponse(
        c,
        new AppError("RATE_LIMITED", "Too many requests. Please slow down and try again in a minute.", periodSeconds),
      );
    }
    await next();
  };
}
