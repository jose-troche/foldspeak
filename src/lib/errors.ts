import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "RATE_LIMITED"
  | "TURNSTILE_FAILED"
  | "NOT_FOUND"
  | "NO_STRUCTURE"
  | "UPSTREAM_UNAVAILABLE"
  | "AI_BUDGET_EXHAUSTED"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  RATE_LIMITED: 429,
  TURNSTILE_FAILED: 403,
  NOT_FOUND: 404,
  NO_STRUCTURE: 404,
  UPSTREAM_UNAVAILABLE: 502,
  AI_BUDGET_EXHAUSTED: 503,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
};

export interface ErrorBody {
  error: { code: ErrorCode; message: string; retryAfter?: number };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter: number | undefined;

  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryAfter = retryAfter;
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }

  toBody(): ErrorBody {
    const error: ErrorBody["error"] = { code: this.code, message: this.message };
    if (this.retryAfter !== undefined) error.retryAfter = this.retryAfter;
    return { error };
  }
}

export function errorResponse(c: Context, err: AppError): Response {
  if (err.retryAfter !== undefined) c.header("Retry-After", String(err.retryAfter));
  return c.json(err.toBody(), err.status);
}
