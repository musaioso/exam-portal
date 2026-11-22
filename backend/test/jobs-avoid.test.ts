import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { startServer } from "./helpers";
import { chapterAvoidList } from "../src/services/jobs/avoid";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

async function chapterWith(summary: string | null) {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,summary,created_at) VALUES (?,?,?,?,?,?)",
    [chapterId, subjectId, 1, "C", summary, Date.now()]);
  return { db, subjectId, chapterId };
}
const jobFor = (subjectId: string, chapterId: string) => ({
  id: "j", subject_id: subjectId, chapter_id: chapterId, pattern_id: null, exam_label: "SSC 2027",
  targets: {}, status: "active", notes: null, created_at: 0, updated_at: 0,
} as any);
const insert = (db: any, subjectId: string, chapterId: string, type: string, prompt: string, created_at: number) =>
  run(db, "INSERT INTO questions (id,subject_id,chapter_id,type,prompt,marks,created_at) VALUES (?,?,?,?,?,?,?)",
    [randomUUID(), subjectId, chapterId, type, prompt, 1, created_at]);

test("lists MCQ prompts for the chapter only, newest first, deduplicated", async () => {
  const { db, subjectId, chapterId } = await chapterWith(null);
  const other = await (async () => {
    const id = randomUUID();
    await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [id, subjectId, 2, "Other", Date.now()]);
    return id;
  })();
  await insert(db, subjectId, chapterId, "mcq", "Old question", 1);
  await insert(db, subjectId, chapterId, "mcq", "New question", 2);
  await insert(db, subjectId, other, "mcq", "Elsewhere", 3);
  await insert(db, subjectId, chapterId, "short", "A short", 4);
  const list = await chapterAvoidList(db, jobFor(subjectId, chapterId), "mcq");
  assert.deepEqual(list, ["New question", "Old question"]);
});

test("lists distinct legacy CQ stems for passages", async () => {
  const { db, subjectId, chapterId } = await chapterWith(null);
  await insert(db, subjectId, chapterId, "long", "উদ্দীপক: গল্প এক (ক) প্রশ্ন", 1);
  await insert(db, subjectId, chapterId, "long", "উদ্দীপক: গল্প এক (খ) প্রশ্ন", 2);
  await insert(db, subjectId, chapterId, "long", "উদ্দীপক: গল্প দুই (ক) প্রশ্ন", 3);
  const list = await chapterAvoidList(db, jobFor(subjectId, chapterId), "passage");
  assert.deepEqual(list, ["গল্প দুই", "গল্প এক"]);
});

test("caps at 200 and keeps the newest", async () => {
  const { db, subjectId, chapterId } = await chapterWith("Summary topic list");
  for (let i = 0; i < 205; i++) await insert(db, subjectId, chapterId, "mcq", `Question ${i}`, i);
  const list = await chapterAvoidList(db, jobFor(subjectId, chapterId), "mcq");
  assert.equal(list.length, 201); // 200 questions + one summary line
  assert.equal(list[0], "Question 204");
  assert.match(list[200], /Summary topic list/);
});
