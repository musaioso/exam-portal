# NotebookLM Work Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the teacher's NotebookLM round-trip into saved per-chapter work orders: the site remembers the format, targets and history, builds the prompt with an avoid list from the bank, and accepts the reply by paste.

**Architecture:** Three additive tables (`question_patterns`, `generation_jobs`, `generation_runs`), six nullable columns on `questions`, and a new `/api/jobs` + `/api/patterns` surface. A job owns a pattern (kinds and marks), targets, and a run log. A work order is rendered from the pattern and the chapter's existing rows; the reply is sanitised, validated per kind, and expanded so a passage becomes its part rows sharing a `passage_group`. Nothing is written to disk and no existing question is rewritten.

**Tech Stack:** Express 5 + SQLite/libSQL (`sql.js`/Turso), React 19 + Vite + Tailwind, `node:test` + `tsx` for backend tests.

**Spec:** `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`

## Global Constraints

- Exam label is `SSC 2027` (class 9–10). The stale `docs/prompts/*.txt` "Class 8" wording is not copied.
- Marks: MCQ 1; short 2; CQ passage 1+2+3+4 = 10; Bangla 1st উপন্যাস/নাটক passage 3 + 7, with no MCQ or four-part CQ.
- `questions.type` CHECK is unchanged. A four-part CQ is four `long` rows; a Bangla passage is one `short` (3) plus one `long` (7), in one `passage_group`.
- Migrations are additive only. `SCHEMA_VERSION` goes from `"17"` to `"18"`. Never update or delete an existing question.
- Run counters are in units (`imported`), rows are separate (`imported_rows`). A passage counts once.
- Avoid list is chapter-scoped. Duplicate checking stays subject-wide, with two skip buckets.
- A passage is accepted or skipped as a whole. One reply carries one kind.
- A page number returned by the model is a claim, never evidence.
- Backend tests are `node:test` files run through `tsx`; every new test file must be added to the `test` script in `backend/package.json`.
- Frontend controls come from `frontend/src/components/ui.tsx`; run `npm run theme:check`, `typecheck`, `lint`, `build` before finishing.
- All new routes require `admin` or `teacher`.
- `express.json` limit is `2mb`; reject a pasted reply over 1 MB with a clear 413 message.

## Review Focus

- A raw NotebookLM reply pasted with ` ```json ` fences and `[1]` citation markers must import on the first try.
- A reply containing a kind other than the one requested must be rejected row by row with a message, and nothing from it imported.
- A chapter holding pre-existing CQ rows (no `passage_group`, `উদ্দীপক:` prompts) must still contribute to the avoid list and to passage progress.
- A passage whose stem or one part already exists must be skipped whole, counted once, never leaving a partial ক–ঘ group.
- Undoing a run whose questions are already in an exam must remove exactly those ids, recompute marks, and unpublish an exam left empty.
- A 3-mark short that is part of a Bangla passage must not advance the standalone short target.

---

## Phases

Each phase is one work session. Do only the phase named in the session's start line, then update the progress ledger and stop.

| Phase | Tasks | Deliverable |
|---|---|---|
| 1 | 1–4 | Schema, patterns, jobs API, progress |
| 2 | 5–7 | Work order builder and endpoint |
| 3 | 8–11 | Reply sanitising, validation, import, undo |
| 4 | 12–14 | NotebookLM tab UI |
| 5 | 15–16 | Pattern editor, docs, end-to-end run |

---

## Phase 1 — Foundation

### Task 1: Schema and migration

**Files:**
- Modify: `backend/src/db/migrate.ts`
- Test: `backend/test/jobs-schema.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: tables `question_patterns`, `generation_jobs`, `generation_runs`; `questions.job_id`, `generation_run_id`, `passage_group`, `passage_stem`, `passage_part`, `passage_index`; indexes `idx_jobs_subject_chapter`, `idx_runs_job`, `idx_questions_job`, `idx_questions_run`, `idx_questions_passage_group`; `SCHEMA_VERSION = "18"`.

- [ ] **Step 1: Write the failing test**

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { getDb, all } from "../src/db/database";
import { startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("creates the work-order tables, columns and indexes", async () => {
  const db = await getDb();
  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map((r: any) => r.name);
  for (const t of ["question_patterns", "generation_jobs", "generation_runs"]) assert.ok(tables.includes(t), t);
  const cols = (await all(db, "PRAGMA table_info(questions)")).map((r: any) => r.name);
  for (const c of ["job_id", "generation_run_id", "passage_group", "passage_stem", "passage_part", "passage_index"]) {
    assert.ok(cols.includes(c), c);
  }
  const runCols = (await all(db, "PRAGMA table_info(generation_runs)")).map((r: any) => r.name);
  for (const c of ["requested", "prompt_text", "imported", "imported_rows", "skipped", "failed", "undone_at"]) {
    assert.ok(runCols.includes(c), c);
  }
  const indexes = (await all(db, "SELECT name FROM sqlite_master WHERE type='index'")).map((r: any) => r.name);
  for (const i of ["idx_jobs_subject_chapter", "idx_runs_job", "idx_questions_job", "idx_questions_run", "idx_questions_passage_group"]) {
    assert.ok(indexes.includes(i), i);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-schema.test.ts`
Expected: FAIL — `question_patterns` missing.

- [ ] **Step 3: Add the schema**

In `backend/src/db/migrate.ts`, bump `SCHEMA_VERSION` to `"18"` and append these statements to `SCHEMA` before the final existing `CREATE INDEX` block:

```sql
CREATE TABLE IF NOT EXISTS question_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject_id TEXT,
  chapter_match TEXT,
  parts TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  pattern_id TEXT,
  exam_label TEXT NOT NULL DEFAULT 'SSC 2027',
  targets TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (pattern_id) REFERENCES question_patterns(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  requested INTEGER NOT NULL DEFAULT 0,
  prompt_text TEXT NOT NULL DEFAULT '',
  imported INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  undone_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_patterns_subject ON question_patterns(subject_id);
CREATE INDEX IF NOT EXISTS idx_jobs_subject_chapter ON generation_jobs(subject_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_runs_job ON generation_runs(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_questions_job ON questions(job_id);
CREATE INDEX IF NOT EXISTS idx_questions_run ON questions(generation_run_id);
CREATE INDEX IF NOT EXISTS idx_questions_passage_group ON questions(passage_group);
```

Then in the ALTER section, after the `chapters.part` line, add:

```ts
// v18: NotebookLM work orders — run attribution and passage grouping.
await ensureColumn(db, "questions", "job_id", "TEXT");
await ensureColumn(db, "questions", "generation_run_id", "TEXT");
await ensureColumn(db, "questions", "passage_group", "TEXT");
await ensureColumn(db, "questions", "passage_stem", "TEXT");
await ensureColumn(db, "questions", "passage_part", "TEXT");
await ensureColumn(db, "questions", "passage_index", "INTEGER");
```

- [ ] **Step 4: Run the test and the existing migration tests**

Run: `cd backend && node --import tsx --test test/jobs-schema.test.ts test/migrate.test.ts test/migrate-integrity.test.ts`
Expected: PASS, including both existing migration tests.

- [ ] **Step 5: Register the test file and commit**

Add `test/jobs-schema.test.ts` to the `test` script in `backend/package.json`, then:

```bash
git add backend/src/db/migrate.ts backend/test/jobs-schema.test.ts backend/package.json
git commit -m "feat(db): add work-order tables, passage columns and indexes"
```

### Task 2: Patterns service, seed and API

**Files:**
- Create: `backend/src/services/jobs/patterns.ts`
- Create: `backend/src/routes/patterns.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/db/migrate.ts` (seed after schema)
- Test: `backend/test/patterns.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  - `type PatternKind = "mcq" | "short" | "long" | "passage"`
  - `interface PatternPart { kind: PatternKind; marks: number }`
  - `interface PatternRecord { id: string; name: string; subject_id: string | null; chapter_match: string | null; parts: PatternPart[]; is_default: number }`
  - `parseParts(raw: unknown): PatternPart[]` — throws `Error("parts must be a non-empty array")`, `Error("invalid kind")`, `Error("marks must be a positive integer")`
  - `seedPatterns(db): Promise<void>` — idempotent by `name`
  - `resolvePattern(db, subjectId: string, chapterTitle: string): Promise<PatternRecord | null>`
  - `GET /api/patterns` → `{ patterns }`; `POST /api/patterns` → `{ pattern }`; `PUT /api/patterns/:id` → `{ pattern }`; `DELETE /api/patterns/:id` → `{ ok: true }`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/patterns.test.ts`
Expected: FAIL — 404 on `/api/patterns`.

- [ ] **Step 3: Implement the service**

`backend/src/services/jobs/patterns.ts`:

- `parseParts` validates each entry: `kind` in the four values, `marks` a positive integer, and for `kind === "passage"` an extra `parts` array of 2–6 `{kind: "short" | "long", marks}`; return a normalised array.
- `seedPatterns` inserts each of the three below only when no row has that `name`:

```ts
const SEEDS = [
  { name: "SSC CQ (default)", subject_id: null, chapter_match: null, is_default: 1,
    parts: [
      { kind: "mcq", marks: 1 },
      { kind: "passage", parts: [
        { kind: "long", marks: 1 }, { kind: "long", marks: 2 },
        { kind: "long", marks: 3 }, { kind: "long", marks: 4 },
      ] },
      { kind: "short", marks: 2 },
    ] },
  { name: "Bangla 1st — উপন্যাস/নাটক", subject_id: null, chapter_match: "উপন্যাস|নাটক", is_default: 0,
    parts: [{ kind: "passage", parts: [
      { kind: "short", marks: 3 }, { kind: "long", marks: 7 },
    ] }] },
  { name: "SSC short", subject_id: null, chapter_match: null, is_default: 0,
    parts: [{ kind: "short", marks: 2 }] },
];
```

- `resolvePattern(db, subjectId, chapterTitle)`: first a row whose `subject_id = subjectId` and whose `chapter_match` regex tests the title; then a row with `subject_id = subjectId`; then `is_default = 1`; else `null`.
- Call `await seedPatterns(db)` at the end of `migrate()`, after the ALTERs.

- [ ] **Step 4: Implement the router and mount it**

`backend/src/routes/patterns.ts` with `requireAuth, requireRole("admin","teacher")` on every route, using `getDb`, `all`, `get`, `run`. `PUT` merges only supplied fields. `DELETE` relies on `generation_jobs.pattern_id ... ON DELETE SET NULL`. Mount in `backend/src/app.ts`: `app.use("/api/patterns", patternsRouter);`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && node --import tsx --test test/patterns.test.ts test/jobs-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the test and commit**

```bash
git add backend/src/services/jobs/patterns.ts backend/src/routes/patterns.ts backend/src/app.ts backend/src/db/migrate.ts backend/test/patterns.test.ts backend/package.json
git commit -m "feat(jobs): add question patterns with seed and CRUD API"
```

### Task 3: Jobs API

**Files:**
- Create: `backend/src/routes/jobs.ts`
- Create: `backend/src/services/jobs/store.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/jobs-api.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `resolvePattern` (Task 2).
- Produces:
  - `interface JobTargets { mcq?: number; short?: number; passage?: number }`
  - `interface JobRecord { id; subject_id; chapter_id; pattern_id: string | null; exam_label: string; targets: JobTargets; status: string; notes: string | null; created_at: number; updated_at: number }`
  - `interface GenerationRun { id; job_id; kind: "mcq" | "short" | "passage"; requested: number; prompt_text: string; imported: number; imported_rows: number; skipped: number; failed: number; undone_at: number | null; created_at: number }`
  - `getJob(db, id): Promise<JobRecord | null>`, `jobWithPattern(db, id)`, `listJobs(db, subjectId?)`
  - `GET /api/jobs?subject_id=` → `{ jobs }` (each with `pattern`; `progress` is added in Task 4)
  - `POST /api/jobs` → 200 `{ job }`; `PUT /api/jobs/:id` → `{ job }`; `DELETE /api/jobs/:id` → `{ ok: true }`
  - `GET /api/jobs/:id/runs` → `{ runs }`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-api.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implement `store.ts`**

- `createJob(db, { subject_id, chapter_id, pattern_id?, exam_label?, targets, notes? }, userId)`: requires `subject_id` and `chapter_id` (throw `Error("subject_id and chapter_id are required")`); defaults `exam_label` to `"SSC 2027"`; when `pattern_id` is absent, resolve via `resolvePattern` with the chapter title and store it; `targets` is the JSON string of `{mcq,short,passage}` numbers, dropping unknown keys and non-positive values.
- `updateJob`, `deleteJob`, `listJobs(db, subjectId?)` joining `question_patterns` for the `pattern` field. Do not attach progress in this task; Task 4 adds it.

- [ ] **Step 4: Implement the router and mount it**

`backend/src/routes/jobs.ts` with the role guard, `GET/POST/PUT/DELETE`, and `GET /:id/runs` ordering newest first. Mount `app.use("/api/jobs", jobsRouter);` in `backend/src/app.ts`.

- [ ] **Step 5: Run the tests**

Run: `cd backend && node --import tsx --test test/jobs-api.test.ts test/patterns.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the test and commit**

```bash
git add backend/src/routes/jobs.ts backend/src/services/jobs/store.ts backend/src/app.ts backend/test/jobs-api.test.ts backend/package.json
git commit -m "feat(jobs): add per-chapter jobs with targets and run list"
```

### Task 4: Job progress, including legacy CQ rows

**Files:**
- Create: `backend/src/services/jobs/legacy.ts`
- Create: `backend/src/services/jobs/progress.ts`
- Modify: `backend/src/services/jobs/store.ts`
- Test: `backend/test/jobs-progress.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  - `deriveLegacyStem(prompt: string): string | null`
  - `interface KindProgress { done: number; target: number }`
  - `interface JobProgress { mcq: KindProgress; short: KindProgress; passage: KindProgress }`
  - `jobProgress(db, job: JobRecord): Promise<JobProgress>`

- [ ] **Step 1: Write the failing test**

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { startServer } from "./helpers";
import { deriveLegacyStem } from "../src/services/jobs/legacy";
import { jobProgress } from "../src/services/jobs/progress";
import { listJobs } from "../src/services/jobs/store";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("derives a stem from a legacy CQ prompt", () => {
  assert.equal(
    deriveLegacyStem("উদ্দীপক: রহিম গ্রামে থাকে। (ক) রহিম কোথায় থাকে?"),
    "রহিম গ্রামে থাকে।"
  );
  assert.equal(deriveLegacyStem("উদ্দীপক: ১৯৪৭ সালে দেশ ভাগ হয় (খ) ব্যাখ্যা কর।"), "১৯৪৭ সালে দেশ ভাগ হয়");
  assert.equal(deriveLegacyStem("What is a river?"), null);
});

test("counts standalone shorts only, and legacy CQs as passages", async () => {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  const insert = (type: string, prompt: string, extra: Record<string, any> = {}) =>
    run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,prompt,marks,passage_group,passage_stem,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), subjectId, chapterId, type, prompt, extra.marks ?? 1,
        extra.passage_group ?? null, extra.passage_stem ?? null, Date.now()]);

  await insert("mcq", "Q1"); await insert("mcq", "Q2");
  await insert("short", "Standalone short", { marks: 2 });
  await insert("long", "উদ্দীপক: গল্প এক (ক) প্রশ্ন");
  await insert("long", "উদ্দীপক: গল্প এক (খ) প্রশ্ন");
  await insert("long", "উদ্দীপক: গল্প এক (গ) প্রশ্ন");
  await insert("long", "উদ্দীপক: গল্প এক (ঘ) প্রশ্ন");
  await insert("short", "উদ্দীপক: নাটক দুই (ক) প্রশ্ন", { marks: 3, passage_group: "g2", passage_stem: "নাটক দুই" });
  await insert("long", "উদ্দীপক: নাটক দুই (খ) প্রশ্ন", { marks: 7, passage_group: "g2", passage_stem: "নাটক দুই" });

  const progress = await jobProgress(db, {
    id: "j", subject_id: subjectId, chapter_id: chapterId, pattern_id: null, exam_label: "SSC 2027",
    targets: { mcq: 40, short: 10, passage: 12 }, status: "active", notes: null, created_at: 0, updated_at: 0,
  } as any);

  assert.equal(progress.mcq.done, 2);
  assert.equal(progress.short.done, 1);       // the 3-mark passage part is not standalone
  assert.equal(progress.passage.done, 2);     // legacy CQ + grouped passage
  assert.equal(progress.mcq.target, 40);

  // Task 4 also attaches progress to the job list.
  const jobId = randomUUID();
  await run(db, `INSERT INTO generation_jobs (id,subject_id,chapter_id,exam_label,targets,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`, [jobId, subjectId, chapterId, "SSC 2027", JSON.stringify({ mcq: 40 }), "t", Date.now(), Date.now()]);
  const jobs = await listJobs(db);
  assert.equal(jobs.find((j: any) => j.id === jobId).progress.mcq.done, 2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deriveLegacyStem`**

`backend/src/services/jobs/legacy.ts`:

```ts
const LEGACY = /^উদ্দীপক\s*:\s*([\s\S]*?)\s*[\(（]\s*(?:ক|খ|গ|ঘ|[1-4])\s*[\)）]\s*/;

export function deriveLegacyStem(prompt: string): string | null {
  const m = LEGACY.exec(String(prompt || "").trim());
  return m ? m[1].trim() || null : null;
}
```

- [ ] **Step 4: Implement `jobProgress`**

`backend/src/services/jobs/progress.ts`:

- Fetch `type, prompt, passage_group, passage_stem` for the job's chapter (`chapter_id = ?`; if null, `subject_id = ? AND chapter_id IS NULL`).
- `mcq` counts `type = 'mcq'`.
- `short` counts `type = 'short' AND passage_group IS NULL`.
- `passage` counts distinct group keys: `passage_group` when set, else `legacy:` + `normalizeText(deriveLegacyStem(prompt))` for `long`/`short` rows that yield a stem.
- Targets from `job.targets`, defaulting each missing value to 0.

- [ ] **Step 5: Attach progress to `listJobs` and run the tests**

Run: `cd backend && node --import tsx --test test/jobs-progress.test.ts test/jobs-api.test.ts`
Expected: PASS.

- [ ] **Step 6: Register the test and commit**

```bash
git add backend/src/services/jobs/legacy.ts backend/src/services/jobs/progress.ts backend/src/services/jobs/store.ts backend/test/jobs-progress.test.ts backend/package.json
git commit -m "feat(jobs): count progress in stems, including legacy CQ rows"
```

---

## Phase 2 — Work order

### Task 5: Avoid list

**Files:**
- Create: `backend/src/services/jobs/avoid.ts`
- Test: `backend/test/jobs-avoid.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `deriveLegacyStem` (Task 4), `normalizeText` (`backend/src/lib/text.ts`).
- Produces: `chapterAvoidList(db, job: JobRecord, kind: "mcq" | "short" | "passage"): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run } from "../src/db/database";
import { startServer } from "./helpers";
import { chapterAvoidList } from "../src/services/jobs/avoid";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

async function chapterWith(summary: string | null) {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,summary,created_at) VALUES (?,?,?,?,?,?)",
    [chapterId, subjectId, 1, "C", summary, Date.now()]);
  return { db, subjectId, chapterId };
}
const jobFor = (subjectId: string, chapterId: string) => ({
  id: "j", subject_id: subjectId, chapter_id: chapterId, pattern_id: null, exam_label: "SSC 2027",
  targets: {}, status: "active", notes: null, created_at: 0, updated_at: 0,
} as any);
const insert = (db: any, subjectId: string, chapterId: string, type: string, prompt: string, created_at: number) =>
  run(db, "INSERT INTO questions (id,subject_id,chapter_id,type,prompt,marks,created_at) VALUES (?,?,?,?,?,?,?)",
    [randomUUID(), subjectId, chapterId, type, prompt, 1, created_at]);

test("lists MCQ prompts for the chapter only, newest first, deduplicated", async () => {
  const { db, subjectId, chapterId } = await chapterWith(null);
  const other = await (async () => {
    const id = randomUUID();
    await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [id, subjectId, 2, "Other", Date.now()]);
    return id;
  })();
  await insert(db, subjectId, chapterId, "mcq", "Old question", 1);
  await insert(db, subjectId, chapterId, "mcq", "New question", 2);
  await insert(db, subjectId, other, "mcq", "Elsewhere", 3);
  await insert(db, subjectId, chapterId, "short", "A short", 4);
  const list = await chapterAvoidList(db, jobFor(subjectId, chapterId), "mcq");
  assert.deepEqual(list, ["New question", "Old question"]);
});

test("lists distinct legacy CQ stems for passages", async () => {
  const { db, subjectId, chapterId } = await chapterWith(null);
  await insert(db, subjectId, chapterId, "long", "উদ্দীপক: গল্প এক (ক) প্রশ্ন", 1);
  await insert(db, subjectId, chapterId, "long", "উদ্দীপক: গল্প এক (খ) প্রশ্ন", 2);
  await insert(db, subjectId, chapterId, "long", "উদ্দীপক: গল্প দুই (ক) প্রশ্ন", 3);
  const list = await chapterAvoidList(db, jobFor(subjectId, chapterId), "passage");
  assert.deepEqual(list, ["গল্প দুই", "গল্প এক"]);
});

test("caps at 200 and keeps the newest", async () => {
  const { db, subjectId, chapterId } = await chapterWith("Summary topic list");
  for (let i = 0; i < 205; i++) await insert(db, subjectId, chapterId, "mcq", `Question ${i}`, i);
  const list = await chapterAvoidList(db, jobFor(subjectId, chapterId), "mcq");
  assert.equal(list.length, 201); // 200 questions + one summary line
  assert.equal(list[0], "Question 204");
  assert.match(list[200], /Summary topic list/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-avoid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chapterAvoidList`**

Rules exactly as the test: chapter scope; `ORDER BY created_at DESC`; `mcq` → `type='mcq'` prompts; `short` → `type='short' AND passage_group IS NULL`; `passage` → distinct stems (stored `passage_stem`, else `deriveLegacyStem`), falling back to the full prompt when neither applies. Normalise for dedupe, return the original text trimmed to 120 chars. Keep the newest 200; when anything was dropped and the chapter has a `summary`, append `Also already covered: ${summary}`. The summary line is not counted against the 200.

- [ ] **Step 4: Run the tests and commit**

Run: `cd backend && node --import tsx --test test/jobs-avoid.test.ts`
Expected: PASS.

```bash
git add backend/src/services/jobs/avoid.ts backend/test/jobs-avoid.test.ts backend/package.json
git commit -m "feat(jobs): build a chapter-scoped avoid list, including legacy stems"
```

### Task 6: Work-order renderer

**Files:**
- Create: `backend/src/services/jobs/work-order.ts`
- Test: `backend/test/jobs-work-order.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `PatternRecord`, `chapterAvoidList`, `jobProgress`.
- Produces: `renderWorkOrder(input: WorkOrderInput): string` where

```ts
interface WorkOrderInput {
  job: JobRecord;
  subject: { code: string | null; name: string };
  chapter: { number: number; title: string };
  pattern: PatternRecord;
  kind: "mcq" | "short" | "passage";
  count: number;
  avoid: string[];
  remaining: number;
}
```

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { renderWorkOrder } from "../src/services/jobs/work-order";

const base = {
  job: { exam_label: "SSC 2027" } as any,
  subject: { code: "BGS", name: "Bangladesh and Global Studies" },
  chapter: { number: 3, title: "The Political Movement" },
  pattern: { id: "p", name: "SSC CQ (default)", subject_id: null, chapter_match: null, is_default: 1,
    parts: [
      { kind: "mcq", marks: 1 },
      { kind: "passage", parts: [{ kind: "long", marks: 1 }, { kind: "long", marks: 2 }, { kind: "long", marks: 3 }, { kind: "long", marks: 4 }] },
      { kind: "short", marks: 2 },
    ] } as any,
};

test("renders an MCQ work order with the avoid list and no fences", () => {
  const text = renderWorkOrder({ ...base, kind: "mcq", count: 20, remaining: 40, avoid: ["Old question one", "Old question two"] });
  assert.match(text, /SSC 2027/);
  assert.match(text, /class 9–10/);
  assert.match(text, /BGS/);
  assert.match(text, /Chapter 3: The Political Movement/);
  assert.match(text, /"options"/);
  assert.match(text, /exactly 4/);
  assert.match(text, /Old question one/);
  assert.match(text, /Write 20/);
  assert.match(text, /fewer rather than invent/);
  assert.doesNotMatch(text, /```/);
});

test("renders a passage work order with part marks but never part text", () => {
  const text = renderWorkOrder({ ...base, kind: "passage", count: 6, remaining: 12,
    avoid: ["রহিম গ্রামে থাকে।"] });
  assert.match(text, /"passages"/);
  assert.match(text, /"stem"/);
  assert.match(text, /"parts"/);
  assert.match(text, /1 mark/);
  assert.match(text, /4 marks/);
  assert.match(text, /রহিম গ্রামে থাকে।/);
});

test("omits options for a short work order", () => {
  const text = renderWorkOrder({ ...base, kind: "short", count: 10, remaining: 10, avoid: [] });
  assert.doesNotMatch(text, /"options"/);
  assert.match(text, /2 marks/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-work-order.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

Build the seven sections from spec §8.2. Fixed values that the tests pin: the exam label and `class 9–10`, `Chapter {number}: {title}`, the four-option rule for MCQ, the passage JSON shape (`{"passages":[{"stem":…,"parts":[{"question":…,"answer":…,"scheme":…}]}]}`), one `N mark`/`N marks` line per pattern part, and a closing `Write {count} MCQs/questions/passages now.` followed by the "return fewer rather than invent" line. The avoid list prints as a numbered "Do not repeat these" block; when it is empty, print `None yet — this is the first run.` The page instruction says a guess is worse than `null`.

- [ ] **Step 4: Run the tests and commit**

Run: `cd backend && node --import tsx --test test/jobs-work-order.test.ts`
Expected: PASS.

```bash
git add backend/src/services/jobs/work-order.ts backend/test/jobs-work-order.test.ts backend/package.json
git commit -m "feat(jobs): render per-kind work orders from the stored pattern"
```

### Task 7: Work-order endpoint

**Files:**
- Modify: `backend/src/routes/jobs.ts`
- Modify: `backend/src/services/jobs/store.ts`
- Test: `backend/test/jobs-work-order-api.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `renderWorkOrder`, `chapterAvoidList`, `jobProgress`.
- Produces: `POST /api/jobs/:id/work-order` body `{ kind, count }` → 200 `{ run, prompt }`; `createRun(db, jobId, kind, requested, promptText, userId)`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-work-order-api.test.ts`
Expected: FAIL — 404.

- [ ] **Step 3: Implement the endpoint**

Validate `kind` against the start kinds (`mcq`, `short`, `passage`) and `count` as a positive integer; reject a kind the pattern does not have with 400 `"this job's pattern has no <kind>"`. Load the job, subject (`SELECT code,name FROM subjects`), chapter, and pattern; call `chapterAvoidList` and `jobProgress`; `remaining = max(target - done, 0)`; render; insert the run with `prompt_text`; return both.

- [ ] **Step 4: Run the tests and commit**

Run: `cd backend && node --import tsx --test test/jobs-work-order-api.test.ts test/jobs-work-order.test.ts`
Expected: PASS.

```bash
git add backend/src/routes/jobs.ts backend/src/services/jobs/store.ts backend/test/jobs-work-order-api.test.ts backend/package.json
git commit -m "feat(jobs): add the work-order endpoint with stored runs"
```

---

## Phase 3 — Reply import

### Task 8: Reply sanitiser

**Files:**
- Create: `backend/src/services/jobs/sanitize.ts`
- Test: `backend/test/jobs-sanitize.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `sanitizeReply(raw: string): string` and `parseReply(raw: string): unknown` (throws `Error("The reply does not contain valid JSON")`)

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseReply, sanitizeReply } from "../src/services/jobs/sanitize";

test("strips fences, prose and citation markers", () => {
  const raw = 'Here are your questions:\n```json\n{"questions":[{"prompt":"What is the Padma [1]?","options":["A","B","C","D"],"answer":"A"}]}\n```\nHope this helps.';
  const value = parseReply(raw) as any;
  assert.equal(value.questions.length, 1);
  assert.equal(value.questions[0].prompt, "What is the Padma?");
});

test("repairs trailing commas and curly quotes", () => {
  const raw = '{“questions”:[{“prompt”:“Q”,“options”:[“A”,“B”,“C”,“D”,],“answer”:“A”,},]}';
  const value = parseReply(raw) as any;
  assert.deepEqual(value.questions[0].options.slice(0, 2), ["A", "B"]);
});

test("throws a readable error for garbage", () => {
  assert.throws(() => parseReply("no json here"), /does not contain valid JSON/);
});

test("leaves valid JSON untouched", () => {
  const valid = '{"questions":[]}';
  assert.equal(sanitizeReply(valid), valid);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-sanitize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`sanitizeReply`: drop everything before the first `{` or `[` and after the matching outer close; strip fence lines; replace `[digits]` with nothing; map `“”‘’` to `"`/`'`; remove `,` immediately before `}` or `]`. `parseReply`: `JSON.parse(sanitizeReply(raw))`, rethrowing as `Error("The reply does not contain valid JSON")`.

- [ ] **Step 4: Run the tests and commit**

Run: `cd backend && node --import tsx --test test/jobs-sanitize.test.ts`
Expected: PASS.

```bash
git add backend/src/services/jobs/sanitize.ts backend/test/jobs-sanitize.test.ts backend/package.json
git commit -m "feat(jobs): sanitise pasted NotebookLM replies"
```

### Task 9: Row validation

**Files:**
- Create: `backend/src/services/jobs/validate.ts`
- Test: `backend/test/jobs-validate.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  - `interface McqRow { prompt; options: string[]; answer; explanation; page_number; section; source_quote; difficulty }`
  - `interface WrittenRow { prompt; answer; explanation; page_number; section; source_quote; difficulty }`
  - `interface PassageRow { stem; parts: Array<{ question: string; answer: string; scheme: string; marks?: number }> }`
  - `validateMcq(item: unknown): McqRow`, `validateWritten(item: unknown): WrittenRow`, `validatePassage(item: unknown, partMarks: number[]): PassageRow`
  - Each throws an `Error` whose message is the per-row reason.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateMcq, validatePassage, validateWritten } from "../src/services/jobs/validate";

test("maps an A/B/C/D answer to the option text", () => {
  const row = validateMcq({ prompt: "Q", options: ["Alpha", "Beta", "Gamma", "Delta"], answer: "B" });
  assert.equal(row.answer, "Beta");
});

test("rejects wrong option counts and duplicate options", () => {
  assert.throws(() => validateMcq({ prompt: "Q", options: ["A", "B", "C"], answer: "A" }), /exactly 4 unique options/);
  assert.throws(() => validateMcq({ prompt: "Q", options: ["A", "A", "B", "C"], answer: "A" }), /exactly 4 unique options/);
});

test("rejects an answer that is not one of the options", () => {
  assert.throws(() => validateMcq({ prompt: "Q", options: ["A", "B", "C", "D"], answer: "Z" }), /must be one of the 4 options/);
});

test("rejects options on a written question", () => {
  assert.throws(() => validateWritten({ prompt: "Q", options: ["A", "B"] }), /must not have options/);
});

test("accepts a passage with the pattern's part count and rejects a mismatch", () => {
  const parts = [{ question: "Q1", answer: "A1", scheme: "S1" }, { question: "Q2", answer: "A2", scheme: "S2" }];
  const row = validatePassage({ stem: "Stem", parts }, [3, 7]);
  assert.equal(row.parts.length, 2);
  assert.throws(() => validatePassage({ stem: "Stem", parts: [parts[0]] }, [3, 7]), /expected 2 parts/);
  assert.throws(
    () => validatePassage({ stem: "Stem", parts: [{ ...parts[0], marks: 5 }, parts[1]] }, [3, 7]),
    /marks do not match the pattern/
  );
  assert.throws(() => validatePassage({ stem: "", parts }, [3, 7]), /stem is required/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-validate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Three functions sharing a `clean` helper for strings. MCQ: 4 unique non-empty options after trim; `answer` mapped from `^[A-D]$` then required to be one of the options; `explanation` optional. Written: `options` absent or empty; requires `prompt`. Passage: `stem` non-empty; `parts.length === partMarks.length`; when a part carries `marks` it must equal `partMarks[i]`; each part needs a non-empty `question`, `answer`, `scheme`.

- [ ] **Step 4: Run the tests and commit**

Run: `cd backend && node --import tsx --test test/jobs-validate.test.ts`
Expected: PASS.

```bash
git add backend/src/services/jobs/validate.ts backend/test/jobs-validate.test.ts backend/package.json
git commit -m "feat(jobs): validate MCQ, written and passage reply rows"
```

### Task 10: Import service

**Files:**
- Create: `backend/src/services/jobs/import.ts`
- Test: `backend/test/jobs-import.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `parseReply`, `validateMcq`, `validateWritten`, `validatePassage`, `deriveLegacyStem`, `normalizeText`, `parseSourcePage`, and `JobRecord` / `GenerationRun` (Task 3).
- Produces:

```ts
interface ImportResult {
  imported: number;        // units
  importedRows: number;    // rows
  skipped: number;         // units
  skippedInChapter: number;
  skippedInSubject: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}
importReply(opts: {
  db: any; job: JobRecord; run: GenerationRun; pattern: PatternRecord;
  payload: unknown; userId: string; dryRun?: boolean;
}): Promise<ImportResult>
```

- [ ] **Step 1: Write the failing test**

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, all, run } from "../src/db/database";
import { startServer } from "./helpers";
import { importReply } from "../src/services/jobs/import";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

const PATTERN = { id: "p", name: "P", subject_id: null, chapter_match: null, is_default: 1,
  parts: [{ kind: "passage", parts: [{ kind: "long", marks: 1 }, { kind: "long", marks: 2 },
    { kind: "long", marks: 3 }, { kind: "long", marks: 4 }] }] } as any;

async function setup() {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID(), jobId = randomUUID(), runId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  await run(db, "INSERT INTO generation_jobs (id,subject_id,chapter_id,exam_label,targets,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [jobId, subjectId, chapterId, "SSC 2027", "{}", "t", Date.now(), Date.now()]);
  await run(db, "INSERT INTO generation_runs (id,job_id,kind,requested,created_by,created_at) VALUES (?,?,?,?,?,?)",
    [runId, jobId, "passage", 2, "t", Date.now()]);
  const job = { id: jobId, subject_id: subjectId, chapter_id: chapterId } as any;
  const genRun = { id: runId, job_id: jobId } as any;
  return { db, subjectId, chapterId, jobId, runId, job, genRun };
}

const fourParts = (stem: string) => ({
  stem,
  parts: [
    { question: "Q1", answer: "A1", scheme: "S1" },
    { question: "Q2", answer: "A2", scheme: "S2" },
    { question: "Q3", answer: "A3", scheme: "S3" },
    { question: "Q4", answer: "A4", scheme: "S4" },
  ],
});

test("expands a passage into four grouped rows and counts one unit", async () => {
  const { db, job, genRun, chapterId } = await setup();
  const result = await importReply({
    db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("একটি উদ্দীপক")] },
  });
  assert.equal(result.imported, 1);
  assert.equal(result.importedRows, 4);
  const rows = await all(db, "SELECT * FROM questions WHERE job_id=? ORDER BY passage_index", [job.id]);
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((r: any) => r.passage_group)).size, 1);
  assert.deepEqual(rows.map((r: any) => r.passage_part), ["ক", "খ", "গ", "ঘ"]);
  assert.deepEqual(rows.map((r: any) => r.marks), [1, 2, 3, 4]);
  assert.equal(rows[0].passage_stem, "একটি উদ্দীপক");
  assert.match(rows[2].prompt, /^উদ্দীপক: একটি উদ্দীপক \(গ\) Q3$/);
  assert.equal(rows[0].chapter_id, chapterId);
});

test("skips a whole passage when one part collides", async () => {
  const { db, job, genRun } = await setup();
  await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("দুই নম্বর উদ্দীপক")] } });
  const again = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("দুই নম্বর উদ্দীপক"), fourParts("তিন নম্বর উদ্দীপক")] } });
  assert.equal(again.skipped, 1);
  assert.equal(again.skippedInChapter, 1);
  assert.equal(again.imported, 1);
  const groups = await all(db, "SELECT DISTINCT passage_group FROM questions WHERE chapter_id=?", [job.chapter_id]);
  assert.equal(groups.length, 2);
});

test("reports a subject-wide collision in its own bucket", async () => {
  const { db, job, genRun, subjectId, chapterId } = await setup();
  const otherChapter = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [otherChapter, subjectId, 2, "Other", Date.now()]);
  await run(db, "INSERT INTO questions (id,subject_id,chapter_id,type,prompt,marks,created_at) VALUES (?,?,?,?,?,?,?)",
    [randomUUID(), subjectId, otherChapter, "long", "উদ্দীপক: অন্য অধ্যায় (ক) Q", 1, Date.now()]);
  const result = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t",
    payload: { passages: [fourParts("অন্য অধ্যায়")] } });
  assert.equal(result.skipped, 1);
  assert.equal(result.skippedInSubject, 1);
  assert.ok(chapterId);
});

test("dry run validates without writing", async () => {
  const { db, job, genRun } = await setup();
  const before = (await all(db, "SELECT id FROM questions")).length;
  const result = await importReply({ db, job, run: genRun, pattern: PATTERN, userId: "t", dryRun: true,
    payload: { passages: [fourParts("শুকনো উদ্দীপক")] } });
  assert.equal(result.imported, 1);
  assert.equal(result.importedRows, 4);
  assert.equal((await all(db, "SELECT id FROM questions")).length, before);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- Parse the payload (`parseReply` when a string, otherwise use as-is) and pick the item array by kind: `questions` for `mcq`/`short`, `passages` for `passage`. An item of another kind is a failed row with `this run asked for <kind>`.
- Build the duplicate sets once per call: chapter prompt set and chapter stem set (stored or derived); subject prompt and stem sets (`SELECT prompt, passage_stem FROM questions WHERE subject_id=?`).
- For `passage`, validation uses the pattern's passage part marks. Compute the four part letters from `["ক","খ","গ","ঘ"]` by index (two parts get ক, খ). Check the stem, then every part prompt, against the chapter set first, then the subject set; track which bucket caused a skip. Insert all part rows in one `batch`.
- Prompt shape: `উদ্দীপক: ${stem} (${part}) ${question}`.
- Rows get `job_id`, `generation_run_id`, `passage_group` (a uuid per passage), `passage_stem`, `passage_part`, `passage_index`, `page`/`page_number` via `parseSourcePage`, `section`, `source_quote`, `marks` from the pattern, `difficulty` default `medium`, `created_by`.
- `dryRun` runs the same validation and duplicate checks and returns counts without inserting or updating the run.
- Update `generation_runs` counters in the same transaction as the inserts.

- [ ] **Step 4: Run the tests and commit**

Run: `cd backend && node --import tsx --test test/jobs-import.test.ts test/jobs-validate.test.ts`
Expected: PASS.

```bash
git add backend/src/services/jobs/import.ts backend/test/jobs-import.test.ts backend/package.json
git commit -m "feat(jobs): import pasted replies, expand passages, dedupe atomically"
```

### Task 11: Import and undo endpoints

**Files:**
- Modify: `backend/src/routes/jobs.ts`
- Create: `backend/src/services/jobs/undo.ts`
- Test: `backend/test/jobs-undo.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `importReply`, `pruneQuestionsFromExams`.
- Produces: `POST /api/jobs/:id/runs/:runId/import` body `{ payload, dryRun? }` → `{ ...ImportResult, run? }`; `POST /api/jobs/:id/runs/:runId/undo` → `{ deleted, run }`; `undoRun(db, jobId, runId): Promise<{ deleted: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
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

const json = (body: any) => ({ ...auth(token), "Content-Type": "application/json" });

test("imports a reply, then undo removes exactly that run and prunes exams", async () => {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)", [subjectId, "BGS", `b-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);

  const { job } = await (await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST", headers: json({}),
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId, targets: { mcq: 5 } }),
  })).json();
  const order = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
    method: "POST", headers: json({}), body: JSON.stringify({ kind: "mcq", count: 5 }),
  })).json();

  const reply = JSON.stringify({ questions: [{
    prompt: "Undo me", options: ["A", "B", "C", "D"], answer: "A",
  }] });
  const imported = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/import`, {
    method: "POST", headers: json({}), body: JSON.stringify({ payload: reply }),
  })).json();
  assert.equal(imported.imported, 1);

  const rows = await all(db, "SELECT id FROM questions WHERE generation_run_id=?", [order.run.id]);
  assert.equal(rows.length, 1);
  await createExam({ subjectId, questionIds: rows.map((r: any) => r.id), totalMarks: 1, published: true });

  const undone = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/undo`, {
    method: "POST", headers: json({}),
  })).json();
  assert.equal(undone.deleted, 1);
  assert.equal((await all(db, "SELECT id FROM questions WHERE generation_run_id=?", [order.run.id])).length, 0);

  const exam = await get(db, "SELECT question_ids,total_marks,is_published FROM exams WHERE subject_id=?", [subjectId]);
  assert.deepEqual(JSON.parse(exam.question_ids), []);
  assert.equal(exam.total_marks, 0);
  assert.equal(exam.is_published, 0);

  const stored = await get(db, "SELECT undone_at FROM generation_runs WHERE id=?", [order.run.id]);
  assert.ok(stored.undone_at);

  const second = await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/undo`, { method: "POST", headers: json({}) });
  assert.equal(second.status, 400);
});

test("a wrong kind in the reply is rejected, not imported", async () => {
  const db = await getDb();
  const subjectId = randomUUID(), chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)", [subjectId, "BGS", `b-${subjectId}`, "BGS", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 1, "C", Date.now()]);
  const { job } = await (await fetch(`${server.baseUrl}/api/jobs`, {
    method: "POST", headers: json({}),
    body: JSON.stringify({ subject_id: subjectId, chapter_id: chapterId }),
  })).json();
  const order = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/work-order`, {
    method: "POST", headers: json({}), body: JSON.stringify({ kind: "mcq", count: 2 }),
  })).json();
  const reply = JSON.stringify({ passages: [{ stem: "S", parts: [
    { question: "Q1", answer: "A1", scheme: "S1" }, { question: "Q2", answer: "A2", scheme: "S2" },
    { question: "Q3", answer: "A3", scheme: "S3" }, { question: "Q4", answer: "A4", scheme: "S4" },
  ] }] });
  const result = await (await fetch(`${server.baseUrl}/api/jobs/${job.id}/runs/${order.run.id}/import`, {
    method: "POST", headers: json({}), body: JSON.stringify({ payload: reply }),
  })).json();
  assert.equal(result.imported, 0);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0].error, /asked for mcq/);
  assert.equal((await all(db, "SELECT id FROM questions WHERE job_id=?", [job.id])).length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && node --import tsx --test test/jobs-undo.test.ts`
Expected: FAIL — 404 on the import route.

- [ ] **Step 3: Implement the routes and `undoRun`**

- `import`: 404 when the job or run does not exist or the run belongs to another job; 409 when the run is already undone; 413 when `payload` is a string longer than 1 MB; call `importReply`; return the result and the refreshed run.
- `undo`: load the run, 400 when `undone_at` is set; select the ids, delete them and stamp `undone_at` in one `batch`; `pruneQuestionsFromExams(db, ids)`; return `{ deleted, run }`.

- [ ] **Step 4: Run the tests**

Run: `cd backend && node --import tsx --test test/jobs-undo.test.ts test/jobs-import.test.ts test/notebooklm-import.test.ts`
Expected: PASS, including the untouched legacy importer.

- [ ] **Step 5: Register the test, run the whole backend suite, commit**

```bash
cd backend && npm test
git add backend/src/routes/jobs.ts backend/src/services/jobs/undo.ts backend/test/jobs-undo.test.ts backend/package.json
git commit -m "feat(jobs): import and undo runs, pruning exams like bulk delete"
```

---

## Phase 4 — UI

### Task 12: Client library

**Files:**
- Create: `frontend/src/lib/jobs.ts`

**Interfaces:**
- Consumes: `api` from `./api`.
- Produces: types `Job`, `JobProgress`, `Pattern`, `GenerationRun`, `ImportResult`; functions `listJobs`, `createJob`, `updateJob`, `deleteJob`, `listRuns`, `createWorkOrder`, `importReply`, `undoRun`, `listPatterns`, `savePattern`, `deletePattern`.

- [ ] **Step 1: Add the client**

Mirror `frontend/src/lib/batch.ts`: one exported async function per endpoint, each unwrapping the axios response (`{ data }`) into the typed value. `importReply(jobId, runId, payload, dryRun)` sends `{ payload, dryRun }`; `createWorkOrder(jobId, kind, count)` sends `{ kind, count }`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/jobs.ts
git commit -m "feat(ui): add typed client for jobs and patterns"
```

### Task 13: NotebookLM tab — job list, new job, copy prompt

**Files:**
- Create: `frontend/src/components/batch/NotebookPanel.tsx`
- Modify: `frontend/src/pages/Batch.tsx`
- Modify: `frontend/src/components/batch/SetupPanel.tsx` (expose the subject/chapter selector pattern if it is not already reusable)

**Interfaces:**
- Consumes: `listJobs`, `createJob`, `createWorkOrder`, `listRuns`; `Button`, `Card`, `Field`, `Select`, `Input` from `ui.tsx`.
- Produces: `<NotebookPanel />` rendered when `tab === "notebook"`.

- [ ] **Step 1: Add the tab**

In `Batch.tsx`, widen the tab state to `"generate" | "correct" | "notebook"`, add a third `Button` labelled **NotebookLM**, and render `<NotebookPanel />` for it.

- [ ] **Step 2: Build the panel**

- Job list: one card per job showing `subject · Ch n · title`, `MCQ done/target · CQ done/target · short done/target`, and the last run's age (`4 days ago`) using the existing relative-time helper if one exists in `lib/`.
- Buttons per job: **Copy prompt** (a small dialog: kind and count, defaulting to the remaining target), **Paste reply**, **Runs**, **Open audit** (link to `/batch?tab=correct&chapter=…`).
- New job dialog: subject, chapter (both from the existing endpoints), pattern select from `listPatterns`, exam label defaulted to `SSC 2027`, targets as three number inputs.
- Copy prompt calls `createWorkOrder` then `navigator.clipboard.writeText(prompt)` and toasts the result.

- [ ] **Step 3: Check theme and types**

Run: `cd frontend && npm run theme:check && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/batch/NotebookPanel.tsx frontend/src/pages/Batch.tsx frontend/src/components/batch/SetupPanel.tsx
git commit -m "feat(ui): add the NotebookLM tab with jobs and prompt copy"
```

### Task 14: Paste reply, runs and unverified pages

**Files:**
- Create: `frontend/src/components/batch/PasteReplyDialog.tsx`
- Create: `frontend/src/components/batch/RunsDrawer.tsx`
- Modify: `frontend/src/components/batch/NotebookPanel.tsx`

**Interfaces:**
- Consumes: `importReply`, `undoRun`, `listRuns`.

- [ ] **Step 1: Paste dialog**

A `Textarea` for the raw reply, a debounced dry-run call (`dryRun: true`) that shows `6 passages → 24 rows` or the first failure reason, and an **Import** button that re-sends with `dryRun: false`. Show the result summary with both skip buckets and the first eight row errors.

- [ ] **Step 2: Runs drawer**

Newest-first list: date, kind, requested/imported/imported_rows/skipped/failed, an **undone** badge when `undone_at` is set, **Copy this prompt again**, **Undo this run** (disabled once undone, with a confirm dialog).

- [ ] **Step 3: Unverified pages line**

On each job card, when the count is above zero, show `N imported rows with no verified page` as a link to the chapter audit. Compute it from the runs/job payload the API already returns; if the count is not present, add `unverified_pages` to the job list response in the backend and to `Job` in `lib/jobs.ts`.

- [ ] **Step 4: Run the frontend checks**

Run: `cd frontend && npm run theme:check && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/batch/PasteReplyDialog.tsx frontend/src/components/batch/RunsDrawer.tsx frontend/src/components/batch/NotebookPanel.tsx frontend/src/lib/jobs.ts
git commit -m "feat(ui): paste replies, review runs, and see unverified pages"
```

---

## Phase 5 — Patterns UI, docs, end to end

### Task 15: Pattern editor

**Files:**
- Create: `frontend/src/components/batch/PatternEditor.tsx`
- Modify: `frontend/src/components/batch/NotebookPanel.tsx`

- [ ] **Step 1: Build the editor**

A modal listing patterns with name, subject, chapter match and parts. Editing a part changes its kind (`mcq`, `short`, `long`, or a passage with child parts) and marks. Save calls `savePattern`; delete calls `deletePattern` behind a confirm dialog.

- [ ] **Step 2: Wire it**

A **Patterns** button on the NotebookLM tab opens it. After a save, refresh the job list so the new pattern is selectable.

- [ ] **Step 3: Checks and commit**

Run: `cd frontend && npm run theme:check && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

```bash
git add frontend/src/components/batch/PatternEditor.tsx frontend/src/components/batch/NotebookPanel.tsx
git commit -m "feat(ui): edit question patterns without touching the database"
```

### Task 16: Docs and end-to-end verification

**Files:**
- Modify: `docs/batch-studio.md`
- Modify: `README.md`

- [ ] **Step 1: Document the tab**

In `docs/batch-studio.md`, under the NotebookLM import section, replace the "create a file and upload it" instructions with: open **Batch Studio → NotebookLM**, create a job, copy the prompt, paste the reply, review the runs, then audit. Keep the JSON template link for the legacy file import. State that counters are in stems and that a passage imports as one group.

- [ ] **Step 2: Manual end-to-end runs**

1. Backend and frontend running; log in as teacher.
2. BGS Ch 3: create a job with `MCQ 20 · CQ 6 · short 5`; copy the MCQ prompt; paste a 3-question reply with fences and `[1]` markers; confirm 3 imported and the progress moved; paste the same reply again and confirm it is skipped, not failed.
3. Copy the CQ prompt; paste two passages; confirm 8 rows, four parts each, one group per passage; check one row isn't split.
4. Undo the CQ run; confirm 8 rows gone and the run shows **undone**.
5. Bangla 1st উপন্যাস chapter: confirm the pattern picked is the 3+7 one and the prompt contains no MCQ or four-part CQ.
6. Reopen the app after a restart; confirm the job still shows its counts and its stored prompt.

- [ ] **Step 3: Full verification**

```bash
cd backend && npm test && npm run typecheck
cd ../frontend && npm run theme:check && npm run typecheck && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add docs/batch-studio.md README.md
git commit -m "docs: describe NotebookLM work orders and grouped imports"
```

---

## Self-Review Notes

- Spec §8.1 counters and progress → Tasks 3, 4, 10.
- Spec §8.2 avoid list and legacy stems → Tasks 5, 6.
- Spec §8.3 sanitise, validate, atomic passage, buckets, undo → Tasks 8–11.
- Spec §8.4 UI → Tasks 13, 14, 15.
- Spec §8.5 patterns seed and editor → Tasks 2, 15.
- Spec §8.6 migration → Task 1.
- Deferred chunk 3 (paper rendering) has no task by design.
