import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, all, get, run } from "../src/db/database";
import { auth, createExam, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
let token = "";
before(async () => {
  server = await startServer();
  token = (await createUser("teacher")).token;
});
after(async () => { await server.close(); });

const json = () => ({ ...auth(token), "Content-Type": "application/json" });

async function newJobAndRun(kind = "mcq", count = 1) {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)", [subjectId, "BGS", `b-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  const { job } = await (await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST", headers: json(),
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId, targets: { [kind]: count + 4 } }),
  })).json();
  const order = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
    method: "POST", headers: json(), body: JSON.stringify({ kind, count }),
  })).json();
  return { db, subjectId, chapterId, job, run: order.run };
}

test("imports a reply, then undo removes exactly that run and prunes exams", async () => {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)", [subjectId, "BGS", `b-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);

  const { job } = await (await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST", headers: json(),
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId, targets: { mcq: 5 } }),
  })).json();
  const order = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
    method: "POST", headers: json(), body: JSON.stringify({ kind: "mcq", count: 5 }),
  })).json();

  const reply = JSON.stringify({ questions: [{
    prompt: "Undo me", options: ["A", "B", "C", "D"], answer: "A",
  }] });
  const imported = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/import`, {
    method: "POST", headers: json(), body: JSON.stringify({ payload: reply }),
  })).json();
  assert.equal(imported.imported, 1);

  const rows = await all(db, "SELECT id FROM questions WHERE generation_run_id=?", [order.run.id]);
  assert.equal(rows.length, 1);
  await createExam({ subjectId, questionIds: rows.map((r: any) => r.id), totalMarks: 1, published: true });

  const undone = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/undo`, {
    method: "POST", headers: json(),
  })).json();
  assert.equal(undone.deleted, 1);
  assert.equal((await all(db, "SELECT id FROM questions WHERE generation_run_id=?", [order.run.id])).length, 0);

  const exam = await get(db, "SELECT question_ids,total_marks,is_published FROM exams WHERE subject_id=?", [subjectId]);
  assert.deepEqual(JSON.parse(exam.question_ids), []);
  assert.equal(exam.total_marks, 0);
  assert.equal(exam.is_published, 0);

  const stored = await get(db, "SELECT undone_at FROM generation_runs WHERE id=?", [order.run.id]);
  assert.ok(stored.undone_at);

  const second = await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/undo`, { method: "POST", headers: json() });
  assert.equal(second.status, 400);
});

test("a wrong kind in the reply is rejected, not imported", async () => {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)", [subjectId, "BGS", `b-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  const { job } = await (await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST", headers: json(),
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId }),
  })).json();
  const order = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
    method: "POST", headers: json(), body: JSON.stringify({ kind: "mcq", count: 2 }),
  })).json();
  const reply = JSON.stringify({ passages: [{ stem: "S", parts: [
    { question: "Q1", answer: "A1", scheme: "S1" }, { question: "Q2", answer: "A2", scheme: "S2" },
    { question: "Q3", answer: "A3", scheme: "S3" }, { question: "Q4", answer: "A4", scheme: "S4" },
  ] }] });
  const result = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/import`, {
    method: "POST", headers: json(), body: JSON.stringify({ payload: reply }),
  })).json();
  assert.equal(result.imported, 0);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].error, /asked for mcq/);
  assert.equal((await all(db, "SELECT id FROM questions WHERE job_id=?", [job.id])).length, 0);
});

test("refuses a reply larger than 1 MB with 413", async () => {
  const { job, run: genRun } = await newJobAndRun();
  const res = await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${genRun.id}/import`, {
    method: "POST", headers: json(),
    body: JSON.stringify({ payload: "x".repeat(1024 * 1024 + 1) }),
  });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /1 MB/);
});

test("returns 404 for a missing job or a run from another job", async () => {
  const a = await newJobAndRun();
  const b = await newJobAndRun();
  const reply = JSON.stringify({ questions: [{ prompt: "Q", options: ["A", "B", "C", "D"], answer: "A" }] });

  const missing = await fetch(`${server.baseUrl}/api/jobs/nope/runs/${a.run.id}/import`, {
    method: "POST", headers: json(), body: JSON.stringify({ payload: reply }),
  });
  assert.equal(missing.status, 404);

  const foreignImport = await fetch(`${server.baseUrl}/api/jobs/${b.job.id}/runs/${a.run.id}/import`, {
    method: "POST", headers: json(), body: JSON.stringify({ payload: reply }),
  });
  assert.equal(foreignImport.status, 404);

  const missingUndo = await fetch(`${server.baseUrl}/api/jobs/nope/runs/${a.run.id}/undo`, {
    method: "POST", headers: json(),
  });
  assert.equal(missingUndo.status, 404);

  const foreignUndo = await fetch(`${server.baseUrl}/api/jobs/${b.job.id}/runs/${a.run.id}/undo`, {
    method: "POST", headers: json(),
  });
  assert.equal(foreignUndo.status, 404);
});

test("refuses to import into an undone run with 409", async () => {
  const { job, run: genRun } = await newJobAndRun();
  const reply = JSON.stringify({ questions: [{ prompt: "Q", options: ["A", "B", "C", "D"], answer: "A" }] });
  const first = await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${genRun.id}/import`, {
    method: "POST", headers: json(), body: JSON.stringify({ payload: reply }),
  });
  assert.equal(first.status, 200);
  const undo = await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${genRun.id}/undo`, {
    method: "POST", headers: json(),
  });
  assert.equal(undo.status, 200);
  const again = await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${genRun.id}/import`, {
    method: "POST", headers: json(), body: JSON.stringify({ payload: reply }),
  });
  assert.equal(again.status, 409);
});
