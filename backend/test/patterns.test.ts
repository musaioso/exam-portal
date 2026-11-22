import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { auth, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
let subjectId = "";
before(async () => {
  server = await startServer();
  const db = await getDb();
  subjectId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)",
    [subjectId, "Bangla 1st", `b1-${subjectId}`, "B1", Date.now()]);
});
after(async () => { await server.close(); });

test("seeds the three known patterns", async () => {
  const teacher = await createUser("teacher");
  const res = await fetch(`${server.baseUrl}/api/patterns`, { headers: auth(teacher.token) });
  const { patterns } = await res.json();
  const names = patterns.map((p: any) => p.name);
  assert.ok(names.includes("SSC CQ (default)"));
  assert.ok(names.includes("SSC short"));
  assert.ok(names.some((n: string) => n.includes("উপন্যাস")));
  const cq = patterns.find((p: any) => p.name === "SSC CQ (default)");
  assert.deepEqual(cq.parts.map((p: any) => p.kind), ["mcq", "passage", "short"]);
  assert.equal(cq.parts[1].parts.length, 4);
});

test("creates, edits and deletes a pattern; student is refused", async () => {
  const teacher = await createUser("teacher");
  const created = await fetch(`${server.baseUrl}/api/patterns`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Short 3 only", subject_id: subjectId, parts: [{ kind: "short", marks: 3 }] }),
  });
  assert.equal(created.status, 200);
  const { pattern } = await created.json();
  assert.equal(pattern.parts[0].marks, 3);

  const edited = await fetch(`${server.baseUrl}/api/patterns/${pattern.id}`, {
    method: "PUT",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Short 3 only", parts: [{ kind: "short", marks: 4 }] }),
  });
  assert.equal((await edited.json()).pattern.parts[0].marks, 4);

  const student = await createUser("student");
  const denied = await fetch(`${server.baseUrl}/api/patterns/${pattern.id}`, { method: "DELETE", headers: auth(student.token) });
  assert.equal(denied.status, 403);

  const deleted = await fetch(`${server.baseUrl}/api/patterns/${pattern.id}`, { method: "DELETE", headers: auth(teacher.token) });
  assert.equal((await deleted.json()).ok, true);
});

test("rejects a pattern with an invalid part", async () => {
  const teacher = await createUser("teacher");
  const res = await fetch(`${server.baseUrl}/api/patterns`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bad", parts: [{ kind: "essay", marks: 5 }] }),
  });
  assert.equal(res.status, 400);
});
