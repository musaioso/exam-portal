import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import subjectsRouter from "./routes/subjects";
import questionsRouter from "./routes/questions";
import examsRouter from "./routes/exams";
import usersRouter from "./routes/users";
import backupRouter from "./routes/backup";
import { requireAuth } from "./middleware/auth";
import { ensureReady } from "./serverless";
import { storage, isPersistent, dbLabel, getDb, get, all } from "./db/database";

function createApp() {
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

  // `db`/`persistent` let the UI warn when the server fell back to an
  // ephemeral in-memory database (i.e. no database URL is configured).
  // `dbName` names the database host we landed on, so a silent database swap
  // (e.g. a deployment-scoped Turso database) is immediately visible.
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, db: storage, persistent: isPersistent, dbName: dbLabel })
  );

  // TEMPORARY diagnostic — remove after debugging. Reports which database the
  // live function is really talking to (host, database id, tables, seed state).
  app.get("/api/diag", async (_req, res) => {
    const out: Record<string, unknown> = {
      storage,
      isPersistent,
      vercelEnv: process.env.VERCEL_ENV || null,
      gitSha: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
      envHost: (process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || "(unset)"),
      tokenLen: (process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || "").length,
    };
    const db = await getDb();
    const q = async (name: string, sql: string) => {
      try {
        out[name] = await all(db, sql);
      } catch (e) {
        out[name] = "ERR " + String((e as Error)?.message || e);
      }
    };
    await q("databaseList", "PRAGMA database_list");
    await q("tables", "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    await q("appMeta", "SELECT key, value FROM app_meta ORDER BY key");
    await q("users", "SELECT name, role, created_at FROM users ORDER BY created_at");
    await q("subjectCount", "SELECT COUNT(*) AS n FROM subjects");
    res.json(out);
  });

  app.use("/api/auth", authRouter);
  app.use("/api/subjects", subjectsRouter);
  app.use("/api/questions", questionsRouter);
  app.use("/api/exams", examsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/backup", backupRouter);

  // Me endpoint — this is the profile card a student sees. It deliberately
  // includes their own PIN: they sign in with name + PIN and must be able to
  // read it back (nobody else can — /users stays teacher/admin only).
  app.get("/api/me", requireAuth, async (req, res) => {
    const db = await getDb();
    const u = await get(
      db,
      "SELECT id,name,email,role,grade,section,pin,created_at FROM users WHERE id=?",
      [req.user!.id]
    );
    res.json({ user: u || req.user });
  });

  return app;
}

// Vercel's zero-config Express support looks for a default export of the app
// instance (or an `app.listen` call) inside an entry file such as `src/app.ts`.
export default createApp();
