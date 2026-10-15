// Vercel serverless entry point (backend project, Root Directory = backend/).
//
// /api/* requests are routed here. The Express app is created once per instance
// and the in-memory SQLite database is migrated and seeded on first use.
import { createApp } from "../src/app";
import { ensureReady } from "../src/serverless";

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
