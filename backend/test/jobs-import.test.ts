import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, all, run } from "../src/db/database";
import { startServer } from "./helpers";
import { importReply } from "../src/services/jobs/import";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

const PATTERN = { id: "p", name: "P", subject_id: null, chapter_match: null, is_default: 1,
  parts: [{ kind: "passage", parts: [{ kind: "long", marks: 1 }, { kind: "long", marks: 2 },
    { kind: "long", marks: 3 }, { kind: "long", marks: 4 }] }] } as any;

async function setup(kind = "passage") {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID(), jobId = randomUUID(), runId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  await run(db, "INSERT INTO generation_jobs (id,subject_id,chapter_id,exam_label,targets,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [jobId, subjectId, chapterId, "SSC 2027", "{}", "t", Date.now(), Date.now()]);
  await run(db, "INSERT INTO generation_runs (id,job_id,kind,requested,created_by,created_at) VALUES (?,?,?,?,?,?)",
    [runId, jobId, kind, 2, "t", Date.now()]);
  const job = { id: jobId, subject_id: subjectId, chapter_id: chapterId } as any;
  const genRun = { id: runId, job_id: jobId } as any;
  return { db, subjectId, chapterId, jobId, runId, job, genRun };
}

const fourParts = (stem: string) => ({
  stem,
  parts: [
    { question: "Q1", answer: "A1", scheme: "S1" },
    { question: "Q2", answer: "A2", scheme: "S2" },
    { question: "Q3", answer: "A3", scheme: "S3" },
    { question: "Q4", answer: "A4", scheme: "S4" },
  ],
});

test("expands a passage into four grouped rows and counts one unit", async () => {
  const { db, job, genRun, chapterId } = await setup();
  const result = await importReply({
    db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("একটি উদ্দীপক")] },
  });
  assert.equal(result.imported, 1);
  assert.equal(result.importedRows, 4);
  const rows = await all(db, "SELECT * FROM questions WHERE job_id=? ORDER BY passage_index", [job.id]);
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((r: any) => r.passage_group)).size, 1);
  assert.deepEqual(rows.map((r: any) => r.passage_part), ["ক", "খ", "গ", "ঘ"]);
  assert.deepEqual(rows.map((r: any) => r.marks), [1, 2, 3, 4]);
  assert.equal(rows[0].passage_stem, "একটি উদ্দীপক");
  assert.match(rows[2].prompt, /^উদ্দীপক: একটি উদ্দীপক \(গ\) Q3$/);
  assert.equal(rows[0].chapter_id, chapterId);
});

test("skips a whole passage when one part collides", async () => {
  const { db, job, genRun } = await setup();
  await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("দুই নম্বর উদ্দীপক")] } });
  const again = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("দুই নম্বর উদ্দীপক"), fourParts("তিন নম্বর উদ্দীপক")] } });
  assert.equal(again.skipped, 1);
  assert.equal(again.skippedInChapter, 1);
  assert.equal(again.imported, 1);
  const groups = await all(db, "SELECT DISTINCT passage_group FROM questions WHERE chapter_id=?", [job.chapter_id]);
  assert.equal(groups.length, 2);
});

test("reports a subject-wide collision in its own bucket", async () => {
  const { db, job, genRun, subjectId, chapterId } = await setup();
  const otherChapter = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [otherChapter, subjectId, 2, "Other", Date.now()]);
  await run(db, "INSERT INTO questions (id,subject_id,chapter_id,type,prompt,marks,created_at) VALUES (?,?,?,?,?,?,?)",
    [randomUUID(), subjectId, otherChapter, "long", "উদ্দীপক: অন্য অধ্যায় (ক) Q", 1, Date.now()]);
  const result = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("অন্য অধ্যায়")] } });
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedInSubject, 1);
  assert.ok(chapterId);
});

test("dry run validates without writing", async () => {
  const { db, job, genRun } = await setup();
  const before = (await all(db, "SELECT id FROM questions")).length;
  const result = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t", dryRun: true,
    payload: { passages: [fourParts("শুকনো উদ্দীপক")] } });
  assert.equal(result.imported, 1);
  assert.equal(result.importedRows, 4);
  assert.equal((await all(db, "SELECT id FROM questions")).length, before);
});

test("skips a repeat inside the same reply", async () => {
  const { db, job, genRun } = await setup();
  const result = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("একই উদ্দীপক"), fourParts("একই উদ্দীপক")] } });
  assert.equal(result.imported, 1);
  assert.equal(result.importedRows, 4);
  assert.equal(result.skipped, 1);
  const groups = await all(db, "SELECT DISTINCT passage_group FROM questions WHERE chapter_id=?", [job.chapter_id]);
  assert.equal(groups.length, 1);
});

test("a part collision names the part in the skip reason", async () => {
  const { db, job, genRun } = await setup();
  // A stored stem wins over the legacy derivation, so the stem does not collide
  // but the part's full prompt does.
  await run(db, `INSERT INTO questions
    (id,subject_id,chapter_id,type,prompt,passage_stem,marks,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [randomUUID(), job.subject_id, job.chapter_id, "long",
      "উদ্দীপক: নতুন উদ্দীপক (খ) Q2", "অন্য একটি উদ্দীপক", 2, Date.now()]);
  const result = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("নতুন উদ্দীপক")] } });
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedInChapter, 1);
  assert.match(result.skips[0].reason, /part খ/);
  assert.equal((await all(db, "SELECT id FROM questions WHERE generation_run_id=?", [genRun.id])).length, 0);
});

test("imports a short reply with the pattern's marks and no options", async () => {
  const { db, job, genRun } = await setup("short");
  const SHORT_PATTERN = { id: "s", name: "S", subject_id: null, chapter_match: null, is_default: 0,
    parts: [{ kind: "short", marks: 2 }] } as any;
  const result = await importReply({ db, job, run: genRun, pattern: SHORT_PATTERN, userId: "t",
    payload: { questions: [{ prompt: "ব্যাখ্যা কর", answer: "উত্তর", explanation: "কারণ", page_number: 9 }] } });
  assert.equal(result.imported, 1);
  assert.equal(result.importedRows, 1);
  const rows = await all(db, "SELECT * FROM questions WHERE generation_run_id=?", [genRun.id]);
  assert.equal(rows[0].type, "short");
  assert.equal(rows[0].marks, 2);
  assert.equal(rows[0].options, null);
  assert.equal(rows[0].passage_group, null);
  assert.equal(rows[0].page_number, 9);
});
