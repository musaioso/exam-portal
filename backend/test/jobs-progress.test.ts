import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { startServer } from "./helpers";
import { deriveLegacyStem } from "../src/services/jobs/legacy";
import { jobProgress } from "../src/services/jobs/progress";
import { listJobs } from "../src/services/jobs/store";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("derives a stem from a legacy CQ prompt", () => {
  assert.equal(
    deriveLegacyStem("উদ্দীপক: রহিম গ্রামে থাকে। (ক) রহিম কোথায় থাকে?"),
    "রহিম গ্রামে থাকে।"
  );
  assert.equal(deriveLegacyStem("উদ্দীপক: ১৯৪৭ সালে দেশ ভাগ হয় (খ) ব্যাখ্যা কর।"), "১৯৪৭ সালে দেশ ভাগ হয়");
  assert.equal(deriveLegacyStem("What is a river?"), null);
});

test("counts standalone shorts only, and legacy CQs as passages", async () => {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  const insert = (type: string, prompt: string, extra: Record<string, any> = {}) =>
    run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,prompt,marks,passage_group,passage_stem,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), subjectId, chapterId, type, prompt, extra.marks ?? 1,
        extra.passage_group ?? null, extra.passage_stem ?? null, Date.now()]);

  await insert("mcq", "Q1"); await insert("mcq", "Q2");
  await insert("short", "Standalone short", { marks: 2 });
  await insert("long", "উদ্দীপক: গল্প এক (ক) প্রশ্ন");
  await insert("long", "উদ্দীপক: গল্প এক (খ) প্রশ্ন");
  await insert("long", "উদ্দীপক: গল্প এক (গ) প্রশ্ন");
  await insert("long", "উদ্দীপক: গল্প এক (ঘ) প্রশ্ন");
  await insert("short", "উদ্দীপক: নাটক দুই (ক) প্রশ্ন", { marks: 3, passage_group: "g2", passage_stem: "নাটক দুই" });
  await insert("long", "উদ্দীপক: নাটক দুই (খ) প্রশ্ন", { marks: 7, passage_group: "g2", passage_stem: "নাটক দুই" });

  const progress = await jobProgress(db, {
    id: "j", subject_id: subjectId, chapter_id: chapterId, pattern_id: null, exam_label: "SSC 2027",
    targets: { mcq: 40, short: 10, passage: 12 }, status: "active", notes: null, created_at: 0, updated_at: 0,
  } as any);

  assert.equal(progress.mcq.done, 2);
  assert.equal(progress.short.done, 1);       // the 3-mark passage part is not standalone
  assert.equal(progress.passage.done, 2);     // legacy CQ + grouped passage
  assert.equal(progress.mcq.target, 40);

  // Task 4 also attaches progress to the job list.
  const jobId = randomUUID();
  await run(db, `INSERT INTO generation_jobs (id,subject_id,chapter_id,exam_label,targets,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`, [jobId, subjectId, chapterId, "SSC 2027", JSON.stringify({ mcq: 40 }), "t", Date.now(), Date.now()]);
  const jobs = await listJobs(db);
  assert.equal(jobs.find((j: any) => j.id === jobId).progress.mcq.done, 2);
});
