import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { get, getDb } from "../src/db/database";
import { auth, createAttempt, createExam, createQuestion, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

async function post(body: any, token?: string) {
  return fetch(`${server.baseUrl}/api/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? auth(token) : {}) },
    body: JSON.stringify(body),
  });
}

test("an exam challenge records source exam and exam_id", async () => {
  const student = await createUser("student");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [q.id]: "A" } });
  const res = await post({ question_id: q.id, attempt_id: attempt.id, message: "The key looks wrong." }, student.token);
  assert.equal(res.status, 200);
  const { challenge } = await res.json();
  assert.equal(challenge.source, "exam");
  assert.equal(challenge.exam_id, exam.id);
  assert.equal(challenge.attempt_id, attempt.id);
  assert.equal(challenge.status, "open");
});

test("a challenge without an attempt is a practice challenge", async () => {
  const student = await createUser("student");
  const q = await createQuestion();
  const res = await post({ question_id: q.id, message: "Please check page 42." }, student.token);
  assert.equal(res.status, 200);
  const { challenge } = await res.json();
  assert.equal(challenge.source, "practice");
  assert.equal(challenge.attempt_id, null);
  assert.equal(challenge.exam_id, null);
});

test("blank and overlong messages are rejected", async () => {
  const student = await createUser("student");
  const q = await createQuestion();
  assert.equal((await post({ question_id: q.id, message: "   " }, student.token)).status, 400);
  assert.equal((await post({ question_id: q.id, message: "x".repeat(2001) }, student.token)).status, 400);
});

test("another student's attempt is forbidden and an in-progress attempt is rejected", async () => {
  const owner = await createUser("student");
  const other = await createUser("student");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: owner.id, answers: { [q.id]: "A" } });
  assert.equal((await post({ question_id: q.id, attempt_id: attempt.id, message: "Mine." }, other.token)).status, 403);
  const live = await createAttempt({ examId: exam.id, studentId: owner.id, status: "in_progress" });
  assert.equal((await post({ question_id: q.id, attempt_id: live.id, message: "Now." }, owner.token)).status, 400);
});

test("a second open challenge returns 409 and stores only one row", async () => {
  const student = await createUser("student");
  const q = await createQuestion();
  const first = await post({ question_id: q.id, message: "First." }, student.token);
  assert.equal(first.status, 200);
  const second = await post({ question_id: q.id, message: "Second." }, student.token);
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.ok(body.challenge?.id);
  const db = await getDb();
  const row = await get(db, "SELECT COUNT(*) AS n FROM question_challenges WHERE student_id=? AND question_id=?",
    [student.id, q.id]);
  assert.equal(row.n, 1);
});

test("anonymous challenge submission is rejected", async () => {
  const q = await createQuestion();
  assert.equal((await post({ question_id: q.id, message: "Hello." })).status, 401);
});

test("review and practice include the student's existing challenge", async () => {
  const student = await createUser("student");
  const q = await createQuestion();
  const exam = await createExam({ subjectId: q.subjectId, questionIds: [q.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [q.id]: "A" } });
  const created = await post({ question_id: q.id, attempt_id: attempt.id, message: "Check this." }, student.token);
  const { challenge } = await created.json();

  const review = await fetch(`${server.baseUrl}/api/exams/attempts/${attempt.id}/review`, { headers: auth(student.token) });
  const reviewBody = await review.json();
  assert.equal(reviewBody.questions[0].challenge.id, challenge.id);
  assert.equal(reviewBody.questions[0].challenge.status, "open");

  const practice = await fetch(`${server.baseUrl}/api/questions/practice?subject_id=${q.subjectId}&limit=1`,
    { headers: auth(student.token) });
  const practiceBody = await practice.json();
  assert.equal(practiceBody.questions[0].challenge.id, challenge.id);
});

test("students see only their own challenges and staff see all", async () => {
  const a = await createUser("student", "Inbox Student A");
  const b = await createUser("student", "Inbox Student B");
  const teacher = await createUser("teacher");
  const q1 = await createQuestion();
  const q2 = await createQuestion();
  await post({ question_id: q1.id, message: "From A." }, a.token);
  await post({ question_id: q2.id, message: "From B." }, b.token);
  await post({ question_id: q2.id, message: "Also from A." }, a.token);

  const mine = await (await fetch(`${server.baseUrl}/api/challenges/mine`, { headers: auth(a.token) })).json();
  assert.equal(mine.challenges.length, 2);
  assert.ok(mine.challenges.every((c: any) => c.student_id === a.id));

  const all = await (await fetch(`${server.baseUrl}/api/challenges?status=open&q=Inbox`, { headers: auth(teacher.token) })).json();
  assert.equal(all.challenges.length, 3);
  assert.ok(all.challenges.every((c: any) => c.question_prompt === "Test question?"));
  assert.ok("page" in all.challenges[0]);

  assert.equal((await fetch(`${server.baseUrl}/api/challenges`, { headers: auth(a.token) })).status, 403);
});

test("staff resolve a challenge once, with a reply", async () => {
  const student = await createUser("student");
  const teacher = await createUser("teacher");
  const q = await createQuestion();
  const created = await (await post({ question_id: q.id, message: "Please check." }, student.token)).json();
  const id = created.challenge.id;

  const res = await fetch(`${server.baseUrl}/api/challenges/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth(teacher.token) },
    body: JSON.stringify({ status: "accepted", reply: "You are right; the key is being fixed." }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.challenge.status, "accepted");
  assert.equal(body.challenge.reply, "You are right; the key is being fixed.");
  assert.equal(body.challenge.reviewed_by, teacher.id);

  const again = await fetch(`${server.baseUrl}/api/challenges/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth(teacher.token) },
    body: JSON.stringify({ status: "rejected" }),
  });
  assert.equal(again.status, 409);

  const bad = await fetch(`${server.baseUrl}/api/challenges/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth(teacher.token) },
    body: JSON.stringify({ status: "maybe" }),
  });
  assert.equal(bad.status, 400);

  const mine = await (await fetch(`${server.baseUrl}/api/challenges/mine`, { headers: auth(student.token) })).json();
  assert.equal(mine.challenges[0].status, "accepted");
  assert.equal(mine.challenges[0].reply, "You are right; the key is being fixed.");
});
