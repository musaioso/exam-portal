import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { get, getDb, batch, run } from "../src/db/database";
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

test("a failed batch rolls the whole deletion back", async () => {
  const student = await createUser("student");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [q.id]: "A" } });
  const db = await getDb();
  const challengeId = "rollback-challenge";
  await run(db, `INSERT INTO question_challenges
    (id,question_id,student_id,attempt_id,exam_id,source,message,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [challengeId, q.id, student.id, attempt.id, exam.id, "exam", "Rollback.", "open", Date.now()]);

  await assert.rejects(batch(db, [
    { sql: "UPDATE question_challenges SET attempt_id=NULL WHERE id=?", params: [challengeId] },
    { sql: "DELETE FROM table_that_does_not_exist WHERE id=?", params: [attempt.id] },
  ]));

  const kept = await get(db, "SELECT attempt_id FROM question_challenges WHERE id=?", [challengeId]);
  assert.equal(kept.attempt_id, attempt.id);
});

test("a test student's results stay out of the class leaderboard", async () => {
  const db = await getDb();
  const real = await createUser("student", "Real Student");
  const tester = await createUser("student", "TEST");
  await run(db, "UPDATE users SET is_test=1 WHERE id=?", [tester.id]);
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  await createAttempt({ examId: exam.id, studentId: real.id, answers: { [q.id]: "A" }, score: 1, total: 1 });
  await createAttempt({ examId: exam.id, studentId: tester.id, answers: { [q.id]: "A" }, score: 0, total: 1 });

  const res = await fetch(`${server.baseUrl}/api/exams/leaderboard`, { headers: auth(real.token) });
  assert.equal(res.status, 200);
  const body = await res.json();
  const names = body.top.map((r: any) => r.name);
  assert.ok(names.includes("Real Student"), "a real student is ranked");
  assert.ok(!names.includes("TEST"), "the test student is not ranked");

  const asTester = await (await fetch(`${server.baseUrl}/api/exams/leaderboard`, { headers: auth(tester.token) })).json();
  assert.equal(asTester.me, null, "the test student has no leaderboard entry");
});

test("a teacher can flag and unflag a test student", async () => {
  const teacher = await createUser("teacher");
  const student = await createUser("student", "Feature Tester");

  const created = await fetch(`${server.baseUrl}/api/users/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth(teacher.token) },
    body: JSON.stringify({ name: "Brand New Tester", is_test: true }),
  });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).user.is_test, true);

  const patch = (token: string, value: boolean) =>
    fetch(`${server.baseUrl}/api/users/${student.id}/test`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth(token) },
      body: JSON.stringify({ is_test: value }),
    });

  const on = await patch(teacher.token, true);
  assert.equal(on.status, 200);
  assert.equal((await on.json()).is_test, true);

  const list = await (await fetch(`${server.baseUrl}/api/users`, { headers: auth(teacher.token) })).json();
  assert.equal(list.users.find((u: any) => u.id === student.id).is_test, true);

  const off = await patch(teacher.token, false);
  assert.equal((await off.json()).is_test, false);

  const denied = await patch(student.token, true);
  assert.equal(denied.status, 403);
});
