import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { get, getDb } from "../src/db/database";
import { startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("migrate creates question_challenges and records schema version 13", async () => {
  const db = await getDb();
  const table = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='question_challenges'");
  assert.ok(table);
  const meta = await get(db, "SELECT value FROM app_meta WHERE key='schema_version'");
  assert.equal(meta.value, "13");
});
