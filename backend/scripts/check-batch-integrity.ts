import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function main() {
  const real = process.env.MCQ_INTEGRITY_DB || path.resolve(process.cwd(), "data/mcq.db");
  if (!fs.existsSync(real)) {
    console.log(`No real database at ${real}; integrity check skipped.`);
    return;
  }

  const copy = path.join(os.tmpdir(), `mcq-integrity-${Date.now()}.db`);
  fs.copyFileSync(real, copy);
  process.env.DB_PATH = copy;
  process.env.DB_IN_MEMORY = "0";
  for (const key of ["MCQ_DATABASE_URL", "TURSO_DATABASE_URL", "LIBSQL_URL", "MCQ_AUTH_TOKEN", "TURSO_AUTH_TOKEN", "LIBSQL_AUTH_TOKEN"]) {
    delete process.env[key];
  }

  const { getDb, all, run, closeDb } = await import("../src/db/database");
  const { migrate } = await import("../src/db/migrate");
  const { applyCorrections, undoCorrections } = await import("../src/services/batch/correct");

  const db = await getDb();
  const beforeIds = (await all(db, "SELECT id FROM questions ORDER BY id")).map((r: any) => r.id);
  const beforeCounts = await all(db, "SELECT subject_id, COUNT(*) AS n FROM questions GROUP BY subject_id");
  await migrate();
  const afterIds = (await all(db, "SELECT id FROM questions ORDER BY id")).map((r: any) => r.id);
  const afterCounts = await all(db, "SELECT subject_id, COUNT(*) AS n FROM questions GROUP BY subject_id");
  assert.deepEqual(afterIds, beforeIds, "question ids changed during migration");
  assert.deepEqual(afterCounts, beforeCounts, "question counts changed during migration");

  const subjectId = randomUUID();
  const questionId = randomUUID();
  const runId = randomUUID();
  const itemId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "Integrity Check", `integrity-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,difficulty,prompt,options,answer,page_number,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [questionId, subjectId, "mcq", "medium", "Integrity check?", JSON.stringify(["A", "B", "C", "D"]), "A", 55, Date.now()]);
  await run(db, "INSERT INTO correction_runs (id,subject_id,status,created_at) VALUES (?,?,?,?)", [runId, subjectId, "review", Date.now()]);
  await run(db, `INSERT INTO correction_items (id,run_id,question_id,verdict,current_json,proposed_json,status,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [itemId, runId, questionId, "wrong_page", JSON.stringify({ page_number: 55 }), JSON.stringify({ page_number: 57 }), "proposed", Date.now()]);

  await applyCorrections(runId, [itemId], "integrity-check");
  const applied = (await all(db, "SELECT id,page_number FROM questions WHERE id=?", [questionId]))[0];
  assert.equal(applied.id, questionId, "correction changed the question id");
  assert.equal(applied.page_number, 57, "correction did not apply the page");

  await undoCorrections(runId, "integrity-check");
  const restored = (await all(db, "SELECT id,page_number FROM questions WHERE id=?", [questionId]))[0];
  assert.equal(restored.id, questionId, "undo changed the question id");
  assert.equal(restored.page_number, 55, "undo did not restore the page");

  console.log(`Integrity check OK: ${beforeIds.length} existing questions unchanged; correction apply/undo preserved the id.`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
