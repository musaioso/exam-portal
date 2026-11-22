import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, get, run } from "../src/db/database";
import { auth, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
let subjectId = "", chapterId = "", token = "";
before(async () => {
  server = await startServer();
  const db = await getDb();
  subjectId = randomUUID(); chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)",
    [subjectId, "BGS", `bgs-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [chapterId, subjectId, 3, "The Political Movement", Date.now()]);
  token = (await createUser("teacher")).token;
});
after(async () => { await server.close(); });

test("creates a run, stores the prompt and returns it", async () => {
  const jobRes = await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId, targets: { mcq: 40, passage: 12 } }),
  });
  const { job } = await jobRes.json();
  const res = await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "mcq", count: 20 }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.run.requested, 20);
  assert.equal(body.run.kind, "mcq");
  assert.match(body.prompt, /Chapter 3: The Political Movement/);

  const db = await getDb();
  const stored = await get(db, "SELECT prompt_text FROM generation_runs WHERE id=?", [body.run.id]);
  assert.equal(stored.prompt_text, body.prompt);

  const runs = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs`, { headers: auth(token) })).json();
  assert.equal(runs.runs.length, 1);
});

test("refuses an unknown kind or a count below 1", async () => {
  const jobRes = await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId }),
  });
  const { job } = await jobRes.json();
  for (const body of [{ kind: "essay", count: 5 }, { kind: "mcq", count: 0 }]) {
    const res = await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
  }
});
