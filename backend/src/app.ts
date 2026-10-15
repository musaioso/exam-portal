import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import subjectsRouter from "./routes/subjects";
import questionsRouter from "./routes/questions";
import examsRouter from "./routes/exams";
import usersRouter from "./routes/users";
import { requireAuth } from "./middleware/auth";
import { ensureReady } from "./serverless";

export function createApp() {
  const app = express();

  // API responses must not be cached/ETag-revalidated: a 304 with an empty body
  // breaks fetch/axios clients (and Vite's dev proxy can surface it).
  app.set("etag", false);
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    next();
  });

  const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Allow non-browser tools (no Origin header), a wildcard, or any listed origin.
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));

  // Make sure the schema exists and the demo data is loaded before serving any
  // request. This runs once per instance (see serverless.ts) and is what makes
  // the serverless deployment self-initialising.
  app.use((_req, res, next) => {
    ensureReady()
      .then(() => next())
      .catch((err: unknown) => {
        res.status(500).json({
          error: "Database warmup failed",
          detail: String((err as Error)?.message || err),
        });
      });
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/subjects", subjectsRouter);
  app.use("/api/questions", questionsRouter);
  app.use("/api/exams", examsRouter);
  app.use("/api/users", usersRouter);

  // me endpoint
  app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.user }));

  return app;
}

// Vercel's zero-config Express support looks for a default export of the app
// instance (or an `app.listen` call) inside an entry file such as `src/app.ts`.
export default createApp();
