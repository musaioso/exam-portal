# Challenges, Source Pages, and Attempt Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each question's book page in post-exam review and practice, let students challenge answers through a staff inbox, and let teachers/admins delete submitted attempts.

**Architecture:** Add one `question_challenges` table and a `/api/challenges` router. Extend the existing review and practice endpoints with page fields and the caller's challenge. Add a reusable inline `ChallengeBox`, a `/challenges` page for students and staff, and a guarded delete endpoint plus a Results-row button.

**Tech Stack:** Express 5, TypeScript, `sql.js` through the project database wrapper, React 19, React Router, Tailwind, Node's built-in test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-28-challenges-page-numbers-design.md`

## Global Constraints

- Bump `SCHEMA_VERSION` in `backend/src/db/migrate.ts` from `"9"` to `"10"`.
- Challenge statuses are exactly `open`, `accepted`, `rejected`; sources are exactly `exam`, `practice`.
- Challenge messages and staff replies are trimmed and limited to 2,000 characters.
- `page` wins over `page_number`; show the value verbatim (ranges like `42-43` survive).
- Never expose the answer key to a student while an attempt is `in_progress`.
- A challenge never changes a score, an answer key, or the leaderboard by itself.
- Delete an attempt only when its status is `submitted` or `graded`; teachers and admins may delete.
- Keep the existing API prefix `/api` and existing auth roles.
- Do not add runtime dependencies. Use the existing UI components, `confirmDialog`, and `useToast`.
- Commits: one per task, conventional message shown in the task.

## Review Focus

- Student A opening or challenging student B's attempt must return 403, not leak data. Tested in Tasks 3 and 6.
- Two open challenges for the same student/question/attempt must not exist; the second submission returns 409. Tested in Task 3.
- Deleting an `in_progress` attempt or a student calling delete must return 409/403. Tested in Task 6.
- Page ranges (`42-43`) and numeric-only pages must survive review and practice unchanged. Tested in Task 2; displayed in Task 7.
- A challenge must remain readable after its attempt is deleted (`attempt_id` null, `exam_id` kept). Tested in Task 6.

**Working branch:** before Task 1, run `git switch -c feature/challenges-page-numbers`.

---

### Task 1: Backend test harness and challenge table

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/db/migrate.ts`
- Create: `backend/test/env.ts`
- Create: `backend/test/helpers.ts`
- Create: `backend/test/migrate.test.ts`

**Interfaces:**
- Consumes: existing `getDb`, `run`, `get`, `all`, `signToken`.
- Produces:
  - `startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }>`
  - `createUser(role): Promise<{ id, email, role, name, token }>`
  - `createQuestion(opts?): Promise<{ id, subjectId }>`
  - `createExam(opts): Promise<{ id }>`
  - `createAttempt(opts): Promise<{ id }>`
  - `auth(token): { Authorization: string }`

- [ ] **Step 1: Write the failing migration test**

Create `backend/test/env.ts`:

```ts
process.env.DB_IN_MEMORY = "1";
process.env.JWT_SECRET = "test-secret";
```

Create `backend/test/migrate.test.ts`:

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { get, getDb } from "../src/db/database";
import { startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("migrate creates question_challenges and records schema version 10", async () => {
  const db = await getDb();
  const table = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='question_challenges'");
  assert.ok(table);
  const meta = await get(db, "SELECT value FROM app_meta WHERE key='schema_version'");
  assert.equal(meta.value, "10");
});
```

Create `backend/test/helpers.ts`:

```ts
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
        close: () => new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

export async function createUser(role: Role) {
  const db = await getDb();
  const id = randomUUID();
  const email = `${role}-${id}@test.local`;
  const name = `Test ${role}`;
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
```

- [ ] **Step 2: Run the test and verify it fails**

Update the `test` script in `backend/package.json` to:

```json
"test": "node --import tsx --test test/migrate.test.ts"
```

Run: `cd backend && npm test`
Expected: FAIL — `question_challenges` is missing and/or the schema version is `9`.

- [ ] **Step 3: Add the table and bump the version**

In `backend/src/db/migrate.ts`, change `SCHEMA_VERSION` to `"10"` and add this to `SCHEMA` after the `results` table:

```sql
CREATE TABLE IF NOT EXISTS question_challenges (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  attempt_id TEXT,
  exam_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('exam','practice')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','accepted','rejected')),
  reply TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE SET NULL,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_status
  ON question_challenges(status, created_at);
CREATE INDEX IF NOT EXISTS idx_challenges_student
  ON question_challenges(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_challenges_question
  ON question_challenges(question_id);
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/src/db/migrate.ts backend/test/env.ts backend/test/helpers.ts backend/test/migrate.test.ts
git commit -m "test: add backend test harness and challenge table"
```

---

### Task 2: Source page in review and practice APIs

**Files:**
- Modify: `backend/src/routes/exams.ts`
- Modify: `backend/src/routes/questions.ts`
- Create: `backend/test/review-page.test.ts`
- Modify: `backend/package.json` test script

**Interfaces:**
- Consumes: `startServer`, `createUser`, `createQuestion`, `createExam`, `createAttempt`, `auth` from Task 1.
- Produces: review and practice question objects with `page: string | null` and `page_number: number | null`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/review-page.test.ts`:

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { auth, createAttempt, createExam, createQuestion, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("review returns the book page verbatim and the numeric fallback", async () => {
  const student = await createUser("student");
  const a = await createQuestion({ page: "42-43", pageNumber: 42 });
  const b = await createQuestion({});
  const exam = await createExam({ subjectId: a.subjectId, questionIds: [a.id, b.id] });
  const attempt = await createAttempt({ examId: exam.id, studentId: student.id, answers: { [a.id]: "A" } });
  const res = await fetch(`${server.baseUrl}/api/exams/attempts/${attempt.id}/review`, { headers: auth(student.token) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.questions.map((q: any) => [q.page, q.page_number]),
    [["42-43", 42], [null, null]]);
});

test("practice returns page fields", async () => {
  const student = await createUser("student");
  const q = await createQuestion({ page: "42-43", pageNumber: 42 });
  const res = await fetch(`${server.baseUrl}/api/questions/practice?subject_id=${q.subjectId}&limit=1`,
    { headers: auth(student.token) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.questions[0].page, "42-43");
  assert.equal(body.questions[0].page_number, 42);
});
```

Add `test/review-page.test.ts` to the test script:

```json
"test": "node --import tsx --test test/migrate.test.ts test/review-page.test.ts"
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — `page`/`page_number` are `undefined`.

- [ ] **Step 3: Return the page fields**

In `backend/src/routes/exams.ts`, in the `/attempts/:attemptId/review` question mapping, add:

```ts
page: q.page ?? null,
page_number: q.page_number ?? null,
```

In `backend/src/routes/questions.ts`, add `q.page, q.page_number,` to the `SELECT` in `router.get("/practice")`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/exams.ts backend/src/routes/questions.ts backend/test/review-page.test.ts backend/package.json
git commit -m "feat: return book page in review and practice"
```

---

### Task 3: Create challenges

**Files:**
- Create: `backend/src/routes/challenges.ts`
- Modify: `backend/src/app.ts`
- Create: `backend/test/challenges.test.ts`
- Modify: `backend/package.json` test script

**Interfaces:**
- Consumes: `getDb`, `get`, `all`, `run`, `requireAuth`, `uuid`.
- Produces: `POST /api/challenges` returning `{ challenge }`, with fields `id`, `question_id`, `student_id`, `attempt_id`, `exam_id`, `source`, `message`, `status`, `reply`, `reviewed_by`, `reviewed_at`, `created_at`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/challenges.test.ts` with these tests (use the Task 1 helpers):

```ts
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
```

Add `test/challenges.test.ts` to the test script.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — `POST /api/challenges` returns 404.

- [ ] **Step 3: Implement the route and mount it**

Create `backend/src/routes/challenges.ts` with a router that implements `POST /`:

- Read `{ question_id, message, attempt_id }`.
- Return 400 when `question_id` is missing, the trimmed `message` is empty, or `message.length > 2000`.
- Return 404 when the question does not exist.
- When `attempt_id` is supplied: load the attempt; 404 if missing; 403 if `attempt.student_id !== req.user!.id`; 400 if `attempt.status === "in_progress"`; load the exam and 400 unless `JSON.parse(exam.question_ids).includes(question_id)`. Set `source = "exam"` and `exam_id = exam.id`.
- Without `attempt_id`: set `source = "practice"`, `attempt_id = null`, `exam_id = null`.
- Return 409 with the existing row when an `open` challenge already exists for this student, question and attempt (or `attempt_id IS NULL` for practice).
- Insert with `uuid()`, `status = "open"`, `created_at = Date.now()` and return `{ challenge }` (re-read the inserted row).

In `backend/src/app.ts`, import the router and mount it after `/api/questions`:

```ts
app.use("/api/challenges", challengesRouter);
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/challenges.ts backend/src/app.ts backend/test/challenges.test.ts backend/package.json
git commit -m "feat: add challenge creation API"
```

---

### Task 4: Attach the caller's challenge to review and practice

**Files:**
- Modify: `backend/src/routes/exams.ts`
- Modify: `backend/src/routes/questions.ts`
- Modify: `backend/test/challenges.test.ts`

**Interfaces:**
- Consumes: the Task 3 challenge rows and the Task 2 endpoints.
- Produces: each review/practice question has `challenge: { id, status, message, reply } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/challenges.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `challenge` is undefined.

- [ ] **Step 3: Add the challenge lookup**

In `backend/src/routes/exams.ts`, before the review response is built, query:

```sql
SELECT * FROM question_challenges
WHERE student_id=? AND attempt_id=? AND question_id IN (...)
ORDER BY created_at DESC
```

Use `a.student_id` and `a.id`. Keep the newest row per question in a `Map`, and add `challenge: map.get(q.id) ?? null` to each question, containing only `{ id, status, message, reply }`.

In `backend/src/routes/questions.ts`, after the practice rows are fetched, query the caller's challenges for those question ids (any attempt), newest first, keep the newest per question, and add the same `challenge` field to each returned question.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/exams.ts backend/src/routes/questions.ts backend/test/challenges.test.ts
git commit -m "feat: attach challenges to review and practice"
```

---

### Task 5: Challenge inbox and resolution

**Files:**
- Modify: `backend/src/routes/challenges.ts`
- Modify: `backend/test/challenges.test.ts`

**Interfaces:**
- Consumes: Task 3's creation route.
- Produces:
  - `GET /api/challenges?status=open|accepted|rejected|all&q=` for staff: `{ challenges: [...] }` with student, question, exam, page and reply fields.
  - `GET /api/challenges/mine` for any signed-in user: `{ challenges: [...] }` for that user.
  - `PUT /api/challenges/:id` for staff: body `{ status, reply? }`, returns `{ challenge }`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/challenges.test.ts`:

```ts
test("students see only their own challenges and staff see all", async () => {
  const a = await createUser("student");
  const b = await createUser("student");
  const teacher = await createUser("teacher");
  const q1 = await createQuestion();
  const q2 = await createQuestion();
  await post({ question_id: q1.id, message: "From A." }, a.token);
  await post({ question_id: q2.id, message: "From B." }, b.token);
  await post({ question_id: q2.id, message: "Also from A." }, a.token);

  const mine = await (await fetch(`${server.baseUrl}/api/challenges/mine`, { headers: auth(a.token) })).json();
  assert.equal(mine.challenges.length, 2);
  assert.ok(mine.challenges.every((c: any) => c.student_id === a.id));

  const all = await (await fetch(`${server.baseUrl}/api/challenges?status=open`, { headers: auth(teacher.token) })).json();
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — the list and update routes return 404.

- [ ] **Step 3: Implement the list and resolve routes**

In `backend/src/routes/challenges.ts`:

- `GET /mine` with `requireAuth`: join `questions` for `prompt`, `page`, `page_number`, left-join `exams` for `title`, filter `student_id = req.user!.id`, newest first.
- `GET /` with `requireRole("admin","teacher")`: join `users`, `questions`, left-join `exams`; default `status=open`; accept `accepted`, `rejected`, `all`; `q` matches student name, prompt or exam title. Parse `options` JSON before returning. Return `question_prompt`, `question_options`, `question_answer`, `question_explanation`, `page`, `page_number`, `exam_title`.
- `PUT /:id` with `requireRole("admin","teacher")`: 404 when missing; 400 for a status outside `accepted|rejected` or a reply over 2,000 characters; 409 when the row is not `open`; otherwise set `status`, trimmed `reply` or null, `reviewed_by`, `reviewed_at`, and return the updated row.

Mount `/mine` before `/` ordering is not required (different paths), but keep it above `/:id`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/challenges.ts backend/test/challenges.test.ts
git commit -m "feat: add challenge inbox and resolution API"
```

---

### Task 6: Delete an attempt

**Files:**
- Modify: `backend/src/routes/exams.ts`
- Create: `backend/test/attempts.test.ts`
- Modify: `backend/package.json` test script

**Interfaces:**
- Consumes: `createAttempt`, `createUser`, `startServer`, `auth` from Task 1; the challenge table from Task 1.
- Produces: `DELETE /api/exams/attempts/:attemptId` returning `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/attempts.test.ts`:

```ts
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
```

Add `test/attempts.test.ts` to the test script.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — the delete route is 404, or a 200 is returned for a student.

- [ ] **Step 3: Implement the delete route**

In `backend/src/routes/exams.ts` add, before the grade route:

```ts
router.delete("/attempts/:attemptId", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  const attempt = await get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  if (attempt.status === "in_progress") return res.status(409).json({ error: "Attempt is still in progress" });
  await run(db, "UPDATE question_challenges SET attempt_id=NULL WHERE attempt_id=?", [req.params.attemptId]);
  await run(db, "DELETE FROM results WHERE attempt_id=?", [req.params.attemptId]);
  await run(db, "DELETE FROM exam_attempts WHERE id=?", [req.params.attemptId]);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/exams.ts backend/test/attempts.test.ts backend/package.json
git commit -m "feat: allow staff to delete submitted attempts"
```

---

### Task 7: Show the source page in the app

**Files:**
- Modify: `frontend/src/lib/labels.ts`
- Modify: `frontend/src/pages/Results.tsx`
- Modify: `frontend/src/pages/Practice.tsx`
- Modify: `frontend/src/pages/StandalonePractice.tsx`

**Interfaces:**
- Consumes: review/practice `page` and `page_number` from Task 2.
- Produces: `sourcePage(q: { page?: unknown; page_number?: unknown } | null | undefined): string`.

- [ ] **Step 1: Add the helper**

In `frontend/src/lib/labels.ts` add:

```ts
export function sourcePage(q: { page?: unknown; page_number?: unknown } | null | undefined): string {
  if (!q) return "";
  const text = q.page != null && String(q.page).trim() !== ""
    ? String(q.page)
    : q.page_number != null
      ? String(q.page_number)
      : "";
  return text.trim();
}
```

- [ ] **Step 2: Display it in exam review**

In `frontend/src/pages/Results.tsx`, import `sourcePage` and render under the prompt/marks line:

```tsx
{sourcePage(q) && (
  <div className="text-[11px] text-cyan-300/80">বইয়ের পৃষ্ঠা {sourcePage(q)}</div>
)}
```

Keep the marks span unchanged. Show it for students and staff.

- [ ] **Step 3: Display it in missed-question practice**

In `frontend/src/pages/Practice.tsx`, import `sourcePage` and add the same line under the prompt:

```tsx
{sourcePage(q) && (
  <div className="text-[11px] text-cyan-300/80">বইয়ের পৃষ্ঠা {sourcePage(q)}</div>
)}
```

- [ ] **Step 4: Display it in standalone practice**

In `frontend/src/pages/StandalonePractice.tsx`, import `sourcePage`.

- In the question metadata line, add `sourcePage(q) ? \`বইয়ের পৃষ্ঠা ${sourcePage(q)}\` : ""` to the array before `.filter(Boolean).join(" · ")`.
- In the end-of-round review, add the same line under `qq.prompt`.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: PASS.

```bash
git add frontend/src/lib/labels.ts frontend/src/pages/Results.tsx frontend/src/pages/Practice.tsx frontend/src/pages/StandalonePractice.tsx
git commit -m "feat: show book page in review and practice"
```

---

### Task 8: Challenge form and its three placements

**Files:**
- Create: `frontend/src/components/ChallengeBox.tsx`
- Modify: `frontend/src/pages/Results.tsx`
- Modify: `frontend/src/pages/Practice.tsx`
- Modify: `frontend/src/pages/StandalonePractice.tsx`

**Interfaces:**
- Consumes: `POST /api/challenges` from Task 3; `challenge` on review/practice questions from Task 4.
- Produces:

```ts
export type ChallengeInfo = {
  id: string;
  status: "open" | "accepted" | "rejected";
  message?: string | null;
  reply?: string | null;
};

export function ChallengeBox(props: {
  questionId: string;
  attemptId?: string;
  existing?: ChallengeInfo | null;
  onSubmitted?: (challenge: ChallengeInfo) => void;
}): React.ReactElement;
```

- [ ] **Step 1: Create the component**

Create `frontend/src/components/ChallengeBox.tsx`:

- Use `useState` for `open`, `message`, `submitting`, `current` (initialised from `existing`).
- If `current` exists, render a small bordered block with the status label (`পর্যালোচনার অপেক্ষায়`, `গৃহীত`, `প্রত্যাখ্যাত`) and, when present, `শিক্ষকের উত্তর: {reply}`. Do not render a second form.
- Otherwise render a ghost button `চ্যালেঞ্জ করুন` with a `Flag` icon. When open, render a `Textarea` (rows 3) and Submit/Cancel buttons.
- On submit: trim; if empty, `toast.error("কারণ লিখুন।")` and return. POST `/challenges` with `{ question_id, attempt_id, message }`. On 200, set `current`, close the form, `toast.success("আপনার চ্যালেঞ্জ জমা হয়েছে।")`, call `onSubmitted`.
- On 409 with `data.challenge`, set `current` from it and show `toast.info("এই প্রশ্নটি আগেই চ্যালেঞ্জ করা হয়েছে।")`.
- On other errors, `toast.error(data?.error || "চ্যালেঞ্জ জমা করা যায়নি।")`.
- Disable Submit while `submitting`.

- [ ] **Step 2: Place it in exam review**

In `frontend/src/pages/Results.tsx`, after the explanation block and before the closing question card, render for students only:

```tsx
{!isTeacher && (
  <ChallengeBox questionId={q.id} attemptId={detail.id} existing={q.challenge} />
)}
```

Import `ChallengeBox`.

- [ ] **Step 3: Place it in missed-question practice**

In `frontend/src/pages/Practice.tsx`, add `useAuth` and `const isStudent = user?.role === "student"`. After the explanation block, before the Next button:

```tsx
{isStudent && (
  <ChallengeBox questionId={q.id} attemptId={attemptId} existing={q.challenge} />
)}
```

- [ ] **Step 4: Place it in standalone practice**

In `frontend/src/pages/StandalonePractice.tsx`, add `useAuth` and `const isStudent = user?.role === "student"`. Import `type { ChallengeInfo }` from `../components/ChallengeBox` and extend `PracticeQuestion` with `challenge?: ChallengeInfo | null`.

- After the answer feedback/explanation in the round view, before the Next button, render `ChallengeBox` with `questionId={q.id}` and `existing={q.challenge}` (no `attemptId`).
- In the end-of-round review, render it under each question when `isStudent`.

- [ ] **Step 5: Verify and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: PASS.

```bash
git add frontend/src/components/ChallengeBox.tsx frontend/src/pages/Results.tsx frontend/src/pages/Practice.tsx frontend/src/pages/StandalonePractice.tsx
git commit -m "feat: add challenge form to review and practice"
```

---

### Task 9: Challenges page, route, and navigation

**Files:**
- Create: `frontend/src/pages/Challenges.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Shell.tsx`

**Interfaces:**
- Consumes: `GET /api/challenges`, `GET /api/challenges/mine`, `PUT /api/challenges/:id` from Task 5.
- Produces: `/challenges` page.

- [ ] **Step 1: Create the page**

Create `frontend/src/pages/Challenges.tsx`:

- Read `user` from `useAuth()`; `isStaff = user?.role === "admin" || user?.role === "teacher"`.
- State: `challenges`, `loading`, `error`, `status` (`open` default for staff), `search`.
- `load()`:
  - staff: `GET /challenges?status=${status}&q=${encodeURIComponent(search)}`
  - students: `GET /challenges/mine`
- Debounce `search` by 300 ms for staff and reload.
- Staff view:
  - Heading `Challenges`, count, status filter buttons (`Open`, `Accepted`, `Rejected`, `All`), search `Input`.
  - Each card shows student name/email, question prompt, page (import `sourcePage` from `../lib/labels`), options with the key highlighted, explanation, source (`exam_title` or `Practice`), message, date, status badge.
  - When `status === "open"`, show a `Textarea` for the reply and `Accept` / `Reject` buttons. Call `PUT /challenges/:id` with the chosen status and trimmed reply, toast on success/error, reload.
  - Empty and error states.
- Student view:
  - Heading `Challenges`, list of own challenges: question prompt, page, source, their message, status badge, staff reply, date.
  - Empty state: `আপনি এখনো কোনো প্রশ্ন চ্যালেঞ্জ করেননি।`
- Use existing `Card`, `Button`, `Input`, `Textarea`, `Badge`, `useToast`; use `Flag`/`MessageSquare` icons already available in `lucide-react`.

- [ ] **Step 2: Add the route**

In `frontend/src/App.tsx`, import `Challenges` and add inside `Private`:

```tsx
<Route path="/challenges" element={<Private><Challenges /></Private>} />
```

- [ ] **Step 3: Add the nav item**

In `frontend/src/components/Shell.tsx`, import `Flag` and add after Results:

```ts
{ to: "/challenges", label: "Challenges", icon: Flag, roles: ["admin","teacher","student"] },
```

- [ ] **Step 4: Verify and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: PASS.

```bash
git add frontend/src/pages/Challenges.tsx frontend/src/App.tsx frontend/src/components/Shell.tsx
git commit -m "feat: add challenges inbox page"
```

---

### Task 10: Delete-attempt button in Results

**Files:**
- Modify: `frontend/src/pages/Results.tsx`

**Interfaces:**
- Consumes: `DELETE /api/exams/attempts/:attemptId` from Task 6.
- Produces: admin/teacher-only delete action on submitted/graded rows.

- [ ] **Step 1: Add the action**

In `frontend/src/pages/Results.tsx`:

- Import `Trash2` from `lucide-react`, `confirmDialog` from `../components/Dialog`, and `useToast`.
- Add `const toast = useToast();`.
- Add:

```tsx
const removeAttempt = async (a: any) => {
  if (!(await confirmDialog({
    title: "Delete this attempt?",
    message: "The student's score and leaderboard entry for it will be removed. This cannot be undone.",
    confirmLabel: "Delete",
    tone: "danger",
  }))) return;
  try {
    await api.delete(`/exams/attempts/${a.id}`);
    if (detail?.id === a.id) closeDetail();
    toast.success("Attempt deleted.");
    await load();
  } catch (err: any) {
    toast.error(err?.response?.data?.error || "Could not delete the attempt.");
  }
};
```

- In the row action cluster, after Review, render when `isTeacher && a.status !== "in_progress"`:

```tsx
<Button variant="ghost" className="px-2 py-1 text-rose-300" title="Delete attempt" onClick={() => removeAttempt(a)}>
  <Trash2 size={14} />
</Button>
```

- [ ] **Step 2: Verify and commit**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: PASS.

```bash
git add frontend/src/pages/Results.tsx
git commit -m "feat: add delete attempt action for staff"
```

---

### Task 11: Full verification

**Files:** none.

- [ ] **Step 1: Run the backend tests**

Run: `cd backend && npm test`
Expected: all test files pass.

- [ ] **Step 2: Run both typechecks**

Run: `cd backend && npm run typecheck`
Expected: PASS.

Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build the frontend**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual seeded check**

Start backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`), then with the demo accounts:

1. Submit an exam with a question that has a page; review it and confirm `বইয়ের পৃষ্ঠা …` appears, and a page-less question shows no line.
2. Check standalone practice and missed-question practice for the same line.
3. Challenge from exam review, missed practice and standalone practice; confirm duplicate submission shows the existing status.
4. Sign in as teacher: `/challenges` shows all three; accept one with a reply; confirm the student sees `accepted` and the reply.
5. Delete a submitted attempt from Results; confirm it disappears, the leaderboard count drops, and the student's review link no longer opens.
6. Confirm an in-progress attempt has no delete button.
7. Confirm a student cannot open `/challenges` staff actions and cannot see the key before submitting.

- [ ] **Step 5: Fix anything found, then commit**

```bash
git add -A
git commit -m "chore: verify challenges, source pages, and attempt deletion"
```
