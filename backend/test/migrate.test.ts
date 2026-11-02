import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get, getDb, run } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("migrate creates question_challenges and records schema version 14", async () => {
  const db = await getDb();
  const table = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='question_challenges'");
  assert.ok(table);
  const meta = await get(db, "SELECT value FROM app_meta WHERE key='schema_version'");
  assert.equal(meta.value, "14");
});

test("migrate aligns chapter numbers with their titles and strips the prefix", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const singleId = randomUUID();
  const rangeId = randomUUID();
  const rangeTitle = "পরিচ্ছেদ ৩৯-৪৩: বাগর্থ, বাগধারা";
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)",
    [subjectId, "Migrate Subject", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,created_at) VALUES (?,?,?,?,?,?)",
    [singleId, subjectId, 1, "CH. 11: The Economic Indicators", "CH. 11: The Economic Indicators", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,created_at) VALUES (?,?,?,?,?,?)",
    [rangeId, subjectId, 42, rangeTitle, "Chapter 40: বাগর্থ", Date.now()]);

  await migrate();

  const single = await get(db, "SELECT number, title, title_bn FROM chapters WHERE id=?", [singleId]);
  assert.equal(single.number, 11);
  assert.equal(single.title, "The Economic Indicators");
  assert.equal(single.title_bn, "The Economic Indicators");
  // A range title keeps its own number even when title_bn happens to name one.
  const range = await get(db, "SELECT number, title, title_bn FROM chapters WHERE id=?", [rangeId]);
  assert.equal(range.number, 42);
  assert.equal(range.title, rangeTitle);
  assert.equal(range.title_bn, "বাগর্থ");
});
