import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { undoBatch } from "../src/services/batch/store";

before(async () => { await migrate(); });

test("undo deletes only the batch's questions", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  const existingId = randomUUID();
  const generatedId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,prompt,created_at) VALUES (?,?,?,?,?)`,
    [existingId, subjectId, "mcq", "Existing?", Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,created_at) VALUES (?,?,?,?,?)`,
    [batchId, subjectId, "google", "m", Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,prompt,batch_id,created_at) VALUES (?,?,?,?,?,?)`,
    [generatedId, subjectId, "mcq", "Generated?", batchId, Date.now()]);

  assert.deepEqual(await undoBatch(batchId), { deleted: 1 });
  const left = await all(db, "SELECT id FROM questions WHERE subject_id=?", [subjectId]);
  assert.deepEqual(left.map((r: any) => r.id), [existingId]);
});
