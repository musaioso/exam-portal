import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { get, getDb } from "../src/db/database";
import { auth, createAttempt, createExam, createQuestion, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

async function del(id: string, token: string) {
  return fetch(`${server.baseUrl}/api/exams/attempts/${id}`, { method: "DELETE", headers: auth(token) });
}

test("a teacher deletes a submitted attempt, its result, and keeps its challenge", async () => {
  const student = await createUser("student");
  const teacher = await createUser("teacher");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [q.id]: "A" } });
  const created = await fetch(`${server.baseUrl}/api/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(student.token) },
    body: JSON.stringify({ question_id: q.id, attempt_id: attempt.id, message: "Check this." }),
  });
  const { challenge } = await created.json();

  const res = await del(attempt.id, teacher.token);
  assert.equal(res.status, 200);
  const db = await getDb();
  assert.equal(await get(db, "SELECT id FROM exam_attempts WHERE id=?", [attempt.id]), null);
  assert.equal(await get(db, "SELECT id FROM results WHERE attempt_id=?", [attempt.id]), null);
  const kept = await get(db, "SELECT * FROM question_challenges WHERE id=?", [challenge.id]);
  assert.ok(kept);
  assert.equal(kept.attempt_id, null);
  assert.equal(kept.exam_id, exam.id);
});

test("in-progress attempts cannot be deleted", async () => {
  const student = await createUser("student");
  const admin = await createUser("admin");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, status: "in_progress" });
  assert.equal((await del(attempt.id, admin.token)).status, 409);
});

test("students cannot delete attempts and unknown ids return 404", async () => {
  const student = await createUser("student");
  const teacher = await createUser("teacher");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [q.id]: "A" } });
  assert.equal((await del(attempt.id, student.token)).status, 403);
  assert.equal((await del("missing", teacher.token)).status, 404);
});
