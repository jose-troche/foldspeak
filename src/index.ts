import { Hono } from "hono";
import type { AppBindings } from "./env";
import { AppError, errorResponse } from "./lib/errors";
import { rateLimit } from "./middleware/rateLimit";
import { search } from "./routes/search";
import { protein } from "./routes/protein";
import { narrate } from "./routes/narrate";
import curated from "../scripts/curated.json";

export { NeuronCounter } from "./budget/NeuronCounter";

const app = new Hono<AppBindings>();

app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
});

app.get("/api/health", (c) => c.json({ ok: true }));

/** Public config the page needs. The Turnstile site key is public by design. */
app.get("/api/config", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY });
});

/** The showcase set. "Surprise me" draws only from here, never from all of UniProt. */
app.get("/api/curated", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  return c.json({ proteins: curated.proteins });
});

app.use("/api/search", rateLimit("BROWSE_LIMITER"));
app.use("/api/protein/*", rateLimit("BROWSE_LIMITER"));
app.use("/api/narrate", rateLimit("NARRATE_LIMITER"));

app.route("/api/search", search);
app.route("/api/protein", protein);
app.route("/api/narrate", narrate);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return errorResponse(c, new AppError("NOT_FOUND", "No such endpoint."));
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof AppError) return errorResponse(c, err);
  console.error("unhandled", err);
  return errorResponse(c, new AppError("INTERNAL_ERROR", "Something went wrong on our side."));
});

export default app;
