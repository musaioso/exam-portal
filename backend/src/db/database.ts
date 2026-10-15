import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";

// On serverless (Vercel) the filesystem is ephemeral/read-only, so we keep the
// database fully in memory and reload the demo data on each cold start.
const SERVERLESS = !!process.env.VERCEL || process.env.DB_IN_MEMORY === "1";

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "data/mcq.db");

let db: Database | null = null;
let saveTimer: NodeJS.Timeout | null = null;

async function loadSql(): Promise<any> {
  if (SERVERLESS) {
    // Pure-JS asm.js build: no .wasm binary to ship/read on serverless.
    const mod: any = await import("sql.js/dist/sql-asm.js");
    const factory = mod.default || mod;
    return factory();
  }
  return initSqlJs();
}

export async function getDb(): Promise<Database> {
  if (db) return db;
  const SQL = await loadSql();
  let fresh: Database;
  if (SERVERLESS) {
    fresh = new SQL.Database();
  } else {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      fresh = new SQL.Database(fileBuffer);
    } else {
      fresh = new SQL.Database();
    }
  }
  db = fresh;
  return fresh;
}

export function persist(dbInstance: Database) {
  if (SERVERLESS) return; // in-memory only
  const data = dbInstance.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function schedulePersist(dbInstance: Database) {
  if (SERVERLESS) return; // in-memory only
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(dbInstance), 250);
}

export function run(dbInstance: Database, sql: string, params: any[] = []) {
  dbInstance.run(sql, params);
  schedulePersist(dbInstance);
}

export function all(dbInstance: Database, sql: string, params: any[] = []): any[] {
  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

export function get(dbInstance: Database, sql: string, params: any[] = []): any {
  const rows = all(dbInstance, sql, params);
  return rows[0] || null;
}

export function closeDb() {
  if (db) {
    persist(db);
    db.close();
    db = null;
  }
}
