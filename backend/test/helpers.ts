import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { signToken } from "../src/middleware/auth";

type Role = "admin" | "teacher" | "student";

export async function startServer() {
  const { default: app } = await import("../src/app");
  const { migrate } = await import("../src/db/migrate");
  await migrate();
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

export async function createUser(role: Role, name = `Test ${role}`) {
  const db = await getDb();
  const id = randomUUID();
  const email = `${role}-${id}@test.local`;
  await run(db, "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
    [id, name, email, "x", role, Date.now()]);
  return { id, email, role, name, token: signToken({ id, email, role, name }) };
}

export async function createQuestion(opts: {
  page?: string | null;
  pageNumber?: number | null;
  type?: "mcq" | "short" | "long";
  answer?: string;
  options?: string[];
  marks?: number;
} = {}) {
  const db = await getDb();
  const subjectId = randomUUID();
  const id = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)",
    [subjectId, "Test Subject", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO questions
    (id,subject_id,type,difficulty,prompt,options,answer,explanation,marks,page,page_number,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, subjectId, opts.type ?? "mcq", "medium", "Test question?", JSON.stringify(opts.options ?? ["A", "B"]),
      opts.answer ?? "A", null, opts.marks ?? 1, opts.page ?? null, opts.pageNumber ?? null, Date.now()]);
  return { id, subjectId };
}

export async function createExam(opts: {
  subjectId: string;
  questionIds: string[];
  published?: boolean;
  totalMarks?: number;
}) {
  const db = await getDb();
  const id = randomUUID();
  await run(db, `INSERT INTO exams
    (id,title,subject_id,subject_ids,chapter_ids,question_ids,duration_minutes,total_marks,created_by,is_published,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, "Test Exam", opts.subjectId, JSON.stringify([opts.subjectId]), "[]", JSON.stringify(opts.questionIds),
      30, opts.totalMarks ?? opts.questionIds.length, "test", opts.published === false ? 0 : 1, Date.now()]);
  return { id };
}

export async function createAttempt(opts: {
  examId: string;
  studentId: string;
  status?: "in_progress" | "submitted" | "graded";
  answers?: Record<string, string>;
  score?: number;
  total?: number;
}) {
  const db = await getDb();
  const id = randomUUID();
  const status = opts.status ?? "submitted";
  const total = opts.total ?? 1;
  const score = opts.score ?? 0;
  await run(db, `INSERT INTO exam_attempts
    (id,exam_id,student_id,answers,score,total,status,started_at,submitted_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, opts.examId, opts.studentId, JSON.stringify(opts.answers ?? {}), score, total, status, Date.now(), Date.now()]);
  if (status !== "in_progress") {
    await run(db, `INSERT INTO results (id,attempt_id,student_id,exam_id,score,total,percentage,graded_at)
      VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(), id, opts.studentId, opts.examId, score, total, total ? (score / total) * 100 : 0, Date.now()]);
  }
  return { id };
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
