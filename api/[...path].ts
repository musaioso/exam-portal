// Vercel serverless entry point.
//
// All /api/* requests are routed here (catch-all function). The Express app is
// created once per instance and the in-memory SQLite database is migrated and
// seeded on first use, so the deployed demo is immediately usable.
import { createApp } from "../backend/src/app";
import { ensureReady } from "../backend/src/serverless";

const app = createApp();

export default async function handler(req: any, res: any) {
  try {
    await ensureReady();
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ error: "Database warmup failed", detail: String(err?.message || err) })
    );
    return;
  }
  return app(req, res);
}
