import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { auth, createAttempt, createExam, createQuestion, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("review returns the book page verbatim and the numeric fallback", async () => {
  const student = await createUser("student");
  const a = await createQuestion({ page: "42-43", pageNumber: 42, section: "Climate", sourceQuote: "The climate is equable." });
  const b = await createQuestion({});
  const exam = await createExam({ subjectId: a.subjectId, questionIds: [a.id, b.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [a.id]: "A" } });
  const res = await fetch(`${server.baseUrl}/api/exams/attempts/${attempt.id}/review`, { headers: auth(student.token) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.questions.map((q: any) => [q.page, q.page_number]),
    [["42-43", 42], [null, null]]);
  assert.equal(body.questions[0].section, "Climate");
  assert.equal(body.questions[0].source_quote, "The climate is equable.");
});

test("practice returns page fields", async () => {
  const student = await createUser("student");
  const q = await createQuestion({ page: "42-43", pageNumber: 42, section: "Climate", sourceQuote: "The climate is equable." });
  const res = await fetch(`${server.baseUrl}/api/questions/practice?subject_id=${q.subjectId}&limit=1`,
    { headers: auth(student.token) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.questions[0].page, "42-43");
  assert.equal(body.questions[0].page_number, 42);
  assert.equal(body.questions[0].section, "Climate");
  assert.equal(body.questions[0].source_quote, "The climate is equable.");
});
