import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { createQuestion } from "./helpers";
import { applyCorrections, undoCorrections } from "../src/services/batch/correct";

before(async () => { await migrate(); });

test("apply keeps the id, writes a revision, and undo restores the before values", async () => {
  const q = await createQuestion({ pageNumber: 55, answer: "A" });
  const db = await getDb();
  const runId = randomUUID();
  const itemId = randomUUID();
  await run(db, "INSERT INTO correction_runs (id,subject_id,status,created_at) VALUES (?,?,?,?)",
    [runId, q.subjectId, "review", Date.now()]);
  await run(db, `INSERT INTO correction_items (id,run_id,question_id,verdict,current_json,proposed_json,status,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [itemId, runId, q.id, "wrong_page", JSON.stringify({ page_number: 55 }),
      JSON.stringify({ page_number: 57 }), "proposed", Date.now()]);

  assert.deepEqual(await applyCorrections(runId, [itemId], "teacher"), { applied: 1 });
  const after = await all(db, "SELECT id,page_number FROM questions WHERE id=?", [q.id]);
  assert.deepEqual(after.map((r: any) => [r.id, r.page_number]), [[q.id, 57]]);
  const revisions = await all(db, "SELECT before_json FROM question_revisions WHERE run_id=?", [runId]);
  assert.equal(revisions.length, 1);

  assert.deepEqual(await undoCorrections(runId, "teacher"), { restored: 1 });
  const restored = await all(db, "SELECT id,page_number FROM questions WHERE id=?", [q.id]);
  assert.deepEqual(restored.map((r: any) => [r.id, r.page_number]), [[q.id, 55]]);
});

test("apply refuses an answer that is not one of the existing options", async () => {
  const q = await createQuestion({ pageNumber: 55, answer: "A", options: ["A", "B", "C", "D"] });
  const db = await getDb();
  const runId = randomUUID();
  const itemId = randomUUID();
  await run(db, "INSERT INTO correction_runs (id,subject_id,status,created_at) VALUES (?,?,?,?)",
    [runId, q.subjectId, "review", Date.now()]);
  await run(db, `INSERT INTO correction_items (id,run_id,question_id,verdict,current_json,proposed_json,status,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [itemId, runId, q.id, "needs manual edit", JSON.stringify({ answer: "A" }),
      JSON.stringify({ answer: "Z" }), "proposed", Date.now()]);

  assert.deepEqual(await applyCorrections(runId, [itemId], "teacher"), { applied: 0 });
  const after = await all(db, "SELECT answer FROM questions WHERE id=?", [q.id]);
  assert.equal(after[0].answer, "A");
});
