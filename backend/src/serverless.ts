import { getDb } from "./db/database";
import { migrate } from "./db/migrate";
import { seedDatabase } from "./db/seed";

// Runs once per serverless instance: create the schema and, on a fresh
// in-memory database, load the demo data so the deployed demo is usable.
let ready: Promise<void> | null = null;

export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await getDb();
      await migrate();
      await seedDatabase();
    })().catch((e) => {
      ready = null; // allow a retry on the next request
      throw e;
    });
  }
  return ready;
}
