import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { auth, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
let subjectId = "", chapterId = "";
before(async () => {
  server = await startServer();
  const db = await getDb();
  subjectId = randomUUID(); chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)",
    [subjectId, "BGS", `bgs-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [chapterId, subjectId, 3, "The Political Movement", Date.now()]);
});
after(async () => { await server.close(); });

const post = (token: string, path: string, body: any, method = "POST") =>
  fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("creates a job, lists it with progress, edits and deletes it", async () => {
  const teacher = await createUser("teacher");
  const created = await post(teacher.token, "/api/jobs", {
    subject_id: subjectId, chapter_id: chapterId, targets: { mcq: 40, passage: 12 },
  });
  assert.equal(created.status, 200);
  const { job } = await created.json();
  assert.equal(job.exam_label, "SSC 2027");
  assert.equal(job.targets.mcq, 40);
  assert.ok(job.pattern_id);

  const listed = await (await fetch(`${server.baseUrl}/api/jobs?subject_id=${subjectId}`, { headers: auth(teacher.token) })).json();
  const row = listed.jobs.find((j: any) => j.id === job.id);
  assert.equal(row.pattern.parts.length, 3);

  const edited = await post(teacher.token, `/api/jobs/${job.id}`, { targets: { mcq: 20 } }, "PUT");
  assert.equal((await edited.json()).job.targets.mcq, 20);

  const student = await createUser("student");
  assert.equal((await fetch(`${server.baseUrl}/api/jobs`, { headers: auth(student.token) })).status, 403);

  const deleted = await post(teacher.token, `/api/jobs/${job.id}`, {}, "DELETE");
  assert.equal((await deleted.json()).ok, true);
});

test("refuses a job without a chapter", async () => {
  const teacher = await createUser("teacher");
  const res = await post(teacher.token, "/api/jobs", { subject_id: subjectId, targets: { mcq: 5 } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /chapter/i);
});

test("resolves the Bangla উপন্যাস/নাটক pattern from the chapter title", async () => {
  const teacher = await createUser("teacher");
  const db = await getDb();
  const banglaChapter = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [banglaChapter, subjectId, 4, "উপন্যাস: লালসালু", Date.now()]);
  const res = await post(teacher.token, "/api/jobs", { subject_id: subjectId, chapter_id: banglaChapter });
  assert.equal(res.status, 200);
  const { job } = await res.json();
  assert.match(job.pattern.name, /উপন্যাস/);
  assert.deepEqual(job.pattern.parts[0].parts.map((p: any) => p.marks), [3, 7]);
});

test("refuses a null exam label instead of storing the string null", async () => {
  const teacher = await createUser("teacher");
  const created = await post(teacher.token, "/api/jobs", { subject_id: subjectId, chapter_id: chapterId });
  const { job } = await created.json();
  const res = await post(teacher.token, `/api/jobs/${job.id}`, { exam_label: null }, "PUT");
  assert.equal(res.status, 400);
  const listed = await (await fetch(`${server.baseUrl}/api/jobs?subject_id=${subjectId}`, { headers: auth(teacher.token) })).json();
  assert.equal(listed.jobs.find((j: any) => j.id === job.id).exam_label, "SSC 2027");
});
