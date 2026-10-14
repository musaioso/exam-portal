import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "data/mcq.db");

let db: Database | null = null;
let saveTimer: NodeJS.Timeout | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

export function persist(dbInstance: Database) {
  const data = dbInstance.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function schedulePersist(dbInstance: Database) {
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