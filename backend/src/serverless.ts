import { getDb, all } from "./db/database";
import { migrate, SCHEMA_VERSION } from "./db/migrate";
import { seedDatabase } from "./db/seed";

// Runs once per serverless instance: make sure the schema exists and, on a
// fresh database, load the demo data so the deployed demo is usable.
let ready: Promise<void> | null = null;

// A single round trip that tells us whether this database was already set up by
// an earlier (cold) start. On a brand-new database `app_meta` does not exist
// yet, so the query throws — treat that (and any other failure) as "not ready".
async function isWarm(db: any): Promise<boolean> {
  try {
    const rows = (await all(
      db,
      "SELECT key, value FROM app_meta WHERE key IN ('schema_version','seeded')"
    )) as any[];
    const state: Record<string, string> = {};
    for (const row of rows) state[String(row.key)] = String(row.value);
    return state.schema_version === SCHEMA_VERSION && !!state.seeded;
  } catch {
    return false;
  }
}

export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (await isWarm(db)) return; // already migrated + seeded: 1 query only
      await migrate();
      await seedDatabase();
    })().catch((e) => {
      ready = null; // allow a retry on the next request
      throw e;
    });
  }
  return ready;
}
