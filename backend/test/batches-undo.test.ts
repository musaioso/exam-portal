import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("undo prunes deleted questions from exams", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  const existingId = randomUUID();
  const generatedId = randomUUID();
  const examId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,prompt,marks,created_at) VALUES (?,?,?,?,?,?)`,
    [existingId, subjectId, "mcq", "Existing?", 1, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,created_at) VALUES (?,?,?,?,?)`,
    [batchId, subjectId, "google", "m", Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,prompt,marks,batch_id,created_at) VALUES (?,?,?,?,?,?,?)`,
    [generatedId, subjectId, "mcq", "Generated?", 3, batchId, Date.now()]);
  await run(db, `INSERT INTO exams
    (id,title,subject_id,subject_ids,chapter_ids,question_ids,duration_minutes,total_marks,created_by,is_published,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [examId, "Undo exam", subjectId, JSON.stringify([subjectId]), "[]", JSON.stringify([existingId, generatedId]), 30, 4, "t", 1, Date.now()]);

  await undoBatch(batchId);
  const exam = await all(db, "SELECT question_ids,total_marks FROM exams WHERE id=?", [examId]);
  assert.deepEqual(JSON.parse(exam[0].question_ids), [existingId]);
  assert.equal(exam[0].total_marks, 1);
});

test("undo refuses a traversal id and leaves the batch cache intact", async () => {
  const root = path.resolve(process.cwd(), "data", "batches");
  fs.mkdirSync(root, { recursive: true });
  const sentinel = path.join(root, "sentinel.txt");
  fs.writeFileSync(sentinel, "keep");
  assert.deepEqual(await undoBatch(".."), { deleted: 0 });
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
});
