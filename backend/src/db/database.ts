import fs from "fs";
import path from "path";

// Database connection.
//
// Two engines behind one async API:
//
//  * Remote (production / persistent): a Turso (libSQL) database, configured
//    with TURSO_DATABASE_URL + TURSO_AUTH_TOKEN. This is a *shared* database,
//    so data written by one serverless instance is visible to all instances and
//    survives redeploys and cold starts. It uses the pure-JS HTTP transport, so
//    there is no native module to bundle.
//
//  * Local / fallback: an in-process SQLite database via sql.js. Used for local
//    development (file at backend/data/mcq.db) and, if no Turso database is
//    configured, on serverless (in-memory, i.e. ephemeral) so the app still
//    runs.
const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "data/mcq.db");
const RAW_REMOTE_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || "";
// Turso's HTTP API supports both `turso://` and `libsql://` databases, but the
// libSQL client only understands `libsql:`/`https:`/`http:`. Normalise either
// scheme to `https://` so one client works for every Turso database.
const REMOTE_URL = RAW_REMOTE_URL.replace(/^(turso|libsql):\/\//, "https://");
const REMOTE_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined;

export const isRemote = !!REMOTE_URL && !REMOTE_URL.startsWith("file:");
const IN_MEMORY = !isRemote && (!!process.env.VERCEL || process.env.DB_IN_MEMORY === "1");

type AnyDb = any;

let remoteClient: AnyDb = null;
let localDb: AnyDb = null;
let saveTimer: NodeJS.Timeout | null = null;

async function loadSqlJs(): Promise<any> {
  if (IN_MEMORY) {
    // Pure-JS asm.js build: no .wasm binary to ship/read on serverless.
    const mod: any = await import("sql.js/dist/sql-asm.js");
    const factory = mod.default || mod;
    return factory();
  }
  const initSqlJs = (await import("sql.js")).default;
  return initSqlJs();
}

export async function getDb(): Promise<AnyDb> {
  if (isRemote) {
    if (remoteClient) return remoteClient;
    const { createClient } = await import("@libsql/client/http");
    remoteClient = createClient({ url: REMOTE_URL, authToken: REMOTE_TOKEN, intMode: "number" });
    return remoteClient;
  }

  if (localDb) return localDb;
  const SQL = await loadSqlJs();
  if (IN_MEMORY) {
    localDb = new SQL.Database();
    return localDb;
  }
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    localDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    localDb = new SQL.Database();
  }
  return localDb;
}

function persistLocal() {
  if (IN_MEMORY || !localDb) return;
  const data = localDb.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function schedulePersist() {
  if (IN_MEMORY) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistLocal(), 250);
}

// libSQL rejects `undefined` bind parameters; treat it as SQL NULL.
function normalizeParams(params: any[]): any[] {
  return params.map((p) => (p === undefined ? null : p));
}

export async function run(db: AnyDb, sql: string, params: any[] = []): Promise<void> {
  if (isRemote) {
    await db.execute({ sql, args: normalizeParams(params) });
    return;
  }
  db.run(sql, params);
  schedulePersist();
}

export async function all(db: AnyDb, sql: string, params: any[] = []): Promise<any[]> {
  if (isRemote) {
    const res = await db.execute({ sql, args: normalizeParams(params) });
    return res.rows.map((r: any) => ({ ...r }));
  }
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export async function get(db: AnyDb, sql: string, params: any[] = []): Promise<any> {
  const rows = await all(db, sql, params);
  return rows[0] || null;
}

// Runs a multi-statement script (used for the schema).
export async function execScript(db: AnyDb, sql: string): Promise<void> {
  if (isRemote) {
    const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
    if (statements.length) await db.batch(statements, "write");
    return;
  }
  db.exec(sql);
  schedulePersist();
}

export async function closeDb(): Promise<void> {
  if (remoteClient) {
    remoteClient.close();
    remoteClient = null;
  }
  if (localDb) {
    persistLocal();
    localDb.close();
    localDb = null;
  }
}
