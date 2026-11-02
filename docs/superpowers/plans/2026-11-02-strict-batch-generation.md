# Strict Batch Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the strict batch generator and the Batch Studio UI, then add an in-place correction mode for the existing question bank.

**Architecture:** New `services/batch/*` modules handle page manifests, page-number audits, one-page Gemini generation, evidence gates, and retries. New `/api/batches` and `/api/corrections` routes drive everything from the existing Express app. A new React `/batch` page (Batch Studio) drives the step loop, shows progress/evidence, and applies correction proposals in place with revision snapshots.

**Tech Stack:** TypeScript, Express 5, sql.js/libSQL, multer, `@napi-rs/canvas`, tesseract.js, React 19 + Vite + Tailwind, Node's built-in test runner (`node:test`).

**Spec:** `docs/superpowers/specs/2026-11-02-strict-batch-generation-design.md`

## Global Constraints

- Do not rebuild, drop, or rewrite existing tables. Migrations are `ALTER TABLE ... ADD COLUMN` and `CREATE TABLE IF NOT EXISTS` only.
- The existing 2k+ questions must keep the same ids and row counts after migration, generation, and correction tests.
- Generation inserts new rows only. It never updates or deletes an existing question.
- Correction updates rows in place by id and writes a `question_revisions` snapshot first. It never deletes.
- `page_number` is always the resolved page number from the filename or the teacher's confirmation. The model never supplies it.
- One page image per Gemini generation call.
- v1 accepts PNG/JPEG page images only; no PDF input.
- All new API routes require `admin` or `teacher`.
- Batch Studio is a local tool. Do not add a Vercel background worker.
- Backend tests run with `DB_IN_MEMORY=1` and `JWT_SECRET=test-secret` via `test/env.ts`.
- Frontend has no test runner; verify frontend tasks with `npm run typecheck` plus the manual checklist in the task.

## Review Focus

- Existing questions: a migration or generation run must not change their ids, count, or content.
- Page identity: the model's output must never alter `page_number`; a wrong-page quote must be rejected.
- Outside facts: a question using a number or term not on the cited page must be rejected.
- Provider failure: a 503/429 must not lose accepted work, loop forever, or duplicate a page on resume.
- Correction safety: an applied correction keeps the question id, writes a revision first, and undo restores the exact before values.

---

### Task 1: Additive schema, backup, and integrity guard

**Files:**
- Modify: `backend/src/db/database.ts` (export the database file path)
- Modify: `backend/src/db/migrate.ts`
- Create: `backend/src/db/backup.ts`
- Create: `backend/test/migrate-integrity.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `dbFilePath: string` from `database.ts`.
- Produces: `backupDatabaseFile(sourcePath: string, destDir: string, label: string): string | null` from `backup.ts`.
- Produces: `SCHEMA_VERSION = "13"` and the new tables/columns from `migrate.ts`.

- [ ] **Step 1: Write the failing integrity test**

Create `backend/test/migrate-integrity.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { migrate } from "../src/db/migrate";

test("migrate keeps existing question ids and count", async () => {
  const db = await getDb();
  await migrate();
  const subjectId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)",
    [subjectId, "Integrity Subject", `s-${subjectId}`, Date.now()]);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    ids.push(id);
    await run(db, `INSERT INTO questions (id,subject_id,type,difficulty,prompt,options,answer,marks,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, subjectId, "mcq", "medium", `Question ${i}?`, JSON.stringify(["A", "B"]), "A", 1, Date.now()]);
  }
  const before = (await all(db, "SELECT id FROM questions WHERE subject_id=? ORDER BY id", [subjectId])).map((r: any) => r.id);
  assert.deepEqual(before, [...ids].sort());

  await migrate();

  const after = (await all(db, "SELECT id FROM questions WHERE subject_id=? ORDER BY id", [subjectId])).map((r: any) => r.id);
  assert.deepEqual(after, before);
  const cols = (await all(db, "PRAGMA table_info(questions)")).map((r: any) => r.name);
  for (const col of ["batch_id", "source_quote", "source_file", "verification", "verification_method"]) {
    assert.ok(cols.includes(col), `missing column ${col}`);
  }
});

test("backupDatabaseFile copies the file", async () => {
  const { backupDatabaseFile } = await import("../src/db/backup");
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcq-backup-"));
  const src = path.join(dir, "source.db");
  fs.writeFileSync(src, "db-bytes");
  const dest = backupDatabaseFile(src, path.join(dir, "backups"), "test");
  assert.ok(dest && fs.existsSync(dest));
  assert.equal(fs.readFileSync(dest!, "utf8"), "db-bytes");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/migrate-integrity.test.ts`
Expected: FAIL because `backup.ts` and the new columns do not exist.

- [ ] **Step 3: Implement the additive migration and backup**

In `database.ts`, after `const DB_PATH = ...`, add:

```ts
export const dbFilePath = DB_PATH;
```

In `migrate.ts`, bump `SCHEMA_VERSION` to `"13"`. Add these tables to `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS batch_runs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  chapter_id TEXT,
  target_count INTEGER NOT NULL DEFAULT 50,
  max_per_page INTEGER NOT NULL DEFAULT 5,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  fallback_models TEXT,
  allow_vision_fallback INTEGER NOT NULL DEFAULT 0,
  save_mode TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'draft',
  generated INTEGER NOT NULL DEFAULT 0,
  quote_ok INTEGER NOT NULL DEFAULT 0,
  answer_ok INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  saved INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS batch_pages (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  page_number INTEGER,
  resolved_page_number INTEGER,
  source_file TEXT NOT NULL,
  printed_number INTEGER,
  audit_status TEXT NOT NULL DEFAULT 'unnumbered',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  last_error TEXT,
  page_text TEXT,
  image_path TEXT NOT NULL,
  image_sha TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES batch_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_batch_pages_batch ON batch_pages(batch_id, status, page_number);

CREATE TABLE IF NOT EXISTS batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  page_number INTEGER,
  status TEXT NOT NULL,
  reason TEXT,
  question_json TEXT,
  source_quote TEXT,
  source_file TEXT,
  verifier_json TEXT,
  verification_method TEXT,
  prompt_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES batch_runs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_items_unique
  ON batch_items(batch_id, page_number, prompt_hash);
```

In `migrate()`, after the `ensureColumn` calls for `questions`, add:

```ts
await ensureColumn(db, "questions", "batch_id", "TEXT");
await ensureColumn(db, "questions", "source_quote", "TEXT");
await ensureColumn(db, "questions", "source_file", "TEXT");
await ensureColumn(db, "questions", "verification", "TEXT");
await ensureColumn(db, "questions", "verification_method", "TEXT");
```

Create `backend/src/db/backup.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export function backupDatabaseFile(sourcePath: string, destDir: string, label: string): string | null {
  if (!fs.existsSync(sourcePath)) return null;
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `mcq-${label}-${Date.now()}.db`);
  fs.copyFileSync(sourcePath, dest);
  return dest;
}
```

At the start of `migrate()`, before `execScript`, add a local-file backup when the stored schema version differs:

```ts
const versionRows = await all(db, "SELECT value FROM app_meta WHERE key='schema_version'").catch(() => []);
const current = versionRows[0]?.value ?? null;
if (current !== SCHEMA_VERSION && storage === "file") {
  const dir = path.resolve(process.cwd(), "data/backups");
  backupDatabaseFile(dbFilePath, dir, `v${current ?? "new"}`);
}
```

Add `import path from "node:path";`, `import { dbFilePath, storage } from "./database";`, and `import { backupDatabaseFile } from "./backup";` to `migrate.ts`.

For `storage !== "file"` (remote Turso), do not copy a local file. Log `[migrate] remote database: download /api/backup before the first migration` and rely on the existing JSON backup route. Document this in Task 12's guide.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/migrate-integrity.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the test file to the test script and commit**

In `backend/package.json`, append `test/migrate-integrity.test.ts` to the `test` script.

```bash
git add backend/src/db/database.ts backend/src/db/migrate.ts backend/src/db/backup.ts backend/test/migrate-integrity.test.ts backend/package.json
git commit -m "feat: add additive batch schema and backup guard"
```

---

### Task 2: Page manifest, filename parsing, and page audit

**Files:**
- Create: `backend/src/services/batch/types.ts`
- Create: `backend/src/services/batch/pages.ts`
- Create: `backend/test/batch-pages.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `parsePageNumberFromFilename(name: string): number | null`.
- Produces: `inferOpenerPage(filenameNumber: number | null, previous: number | null, next: number | null): { number: number | null; reason: "agreed" | "next" | "previous" | "filename" | "none" }`.
- Produces: `readPrintedNumbers(image: Buffer): Promise<number[]>`.
- Produces: `auditPages(pages: SourcePage[], deps?: { readNumbers?: (image: Buffer) => Promise<number[]> }): Promise<PageAudit[]>`.
- Produces: `SourcePage`, `PageAudit` types in `types.ts`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/batch-pages.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { parsePageNumberFromFilename, inferOpenerPage, auditPages } from "../src/services/batch/pages";

test("parses the page number from a conv filename", () => {
  assert.equal(parsePageNumberFromFilename("BGS conv 55.png"), 55);
  assert.equal(parsePageNumberFromFilename("BGS-conv-166.jpg"), 166);
  assert.equal(parsePageNumberFromFilename("random.png"), null);
});

test("infers an unnumbered opener from its neighbour", () => {
  assert.deepEqual(inferOpenerPage(55, null, 56), { number: 55, reason: "agreed" });
  assert.deepEqual(inferOpenerPage(null, null, 56), { number: 55, reason: "next" });
  assert.deepEqual(inferOpenerPage(null, 54, null), { number: 55, reason: "previous" });
  assert.deepEqual(inferOpenerPage(null, null, null), { number: null, reason: "none" });
});

test("audit marks match, mismatch, and unnumbered", async () => {
  const pages = [
    { sourceFile: "BGS conv 55.png", image: Buffer.alloc(0), mimeType: "image/png", filenameNumber: 55 },
    { sourceFile: "BGS conv 56.png", image: Buffer.alloc(0), mimeType: "image/png", filenameNumber: 56 },
    { sourceFile: "BGS conv 57.png", image: Buffer.alloc(0), mimeType: "image/png", filenameNumber: 57 },
  ];
  const result = await auditPages(pages, {
    readNumbers: async (image) => image === pages[0].image ? [55] : image === pages[1].image ? [57] : [],
  });
  assert.equal(result[0].auditStatus, "match");
  assert.equal(result[1].auditStatus, "mismatch");
  assert.equal(result[1].printedNumber, 57);
  assert.equal(result[2].auditStatus, "unnumbered");
  assert.equal(result[2].proposedNumber, 57);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batch-pages.test.ts`
Expected: FAIL because `services/batch/pages.ts` does not exist.

- [ ] **Step 3: Implement the types and page audit**

Create `backend/src/services/batch/types.ts` with:

```ts
export interface SourcePage {
  sourceFile: string;
  image: Buffer;
  mimeType: string;
  filenameNumber: number | null;
}

export type AuditStatus = "match" | "mismatch" | "unnumbered" | "confirmed";

export interface PageAudit {
  sourceFile: string;
  filenameNumber: number | null;
  printedNumber: number | null;
  auditStatus: AuditStatus;
  resolvedPageNumber: number | null;
  proposedNumber: number | null;
  reason: string;
}
```

Create `backend/src/services/batch/pages.ts`:

```ts
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ocrImage } from "../ai/ocr";
import type { PageAudit, SourcePage } from "./types";

export function parsePageNumberFromFilename(name: string): number | null {
  const conv = name.match(/conv[\s_-]*(\d{1,4})/i);
  if (conv) return Number(conv[1]);
  const last = name.match(/(\d{1,4})(?=\D*$)/);
  return last ? Number(last[1]) : null;
}

export function inferOpenerPage(
  filenameNumber: number | null,
  previous: number | null,
  next: number | null
): { number: number | null; reason: "agreed" | "next" | "previous" | "filename" | "none" } {
  const values = [
    filenameNumber,
    next != null ? next - 1 : null,
    previous != null ? previous + 1 : null,
  ].filter((n): n is number => n != null);
  if (values.length === 0) return { number: null, reason: "none" };
  const counts = new Map<number, number>();
  for (const n of values) counts.set(n, (counts.get(n) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best[1] >= 2) return { number: best[0], reason: "agreed" };
  if (next != null) return { number: next - 1, reason: "next" };
  if (previous != null) return { number: previous + 1, reason: "previous" };
  return { number: filenameNumber, reason: "filename" };
}

export async function readPrintedNumbers(image: Buffer): Promise<number[]> {
  try {
    const img = await loadImage(image);
    const w = img.width;
    const h = img.height;
    const regions = [
      { x: 0, y: 0, w, h: Math.max(1, Math.floor(h * 0.16)) },
      { x: 0, y: Math.floor(h * 0.84), w, h: Math.max(1, Math.floor(h * 0.16)) },
    ];
    const found: number[] = [];
    for (const r of regions) {
      const canvas = createCanvas(r.w, r.h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const text = await ocrImage(canvas.toBuffer("image/png"), ["eng"]);
      for (const m of text.matchAll(/\b(\d{1,4})\b/g)) found.push(Number(m[1]));
    }
    return [...new Set(found)];
  } catch {
    // A corrupt or unreadable image is "unnumbered", never a crash.
    return [];
  }
}

export async function auditPages(
  pages: SourcePage[],
  deps: { readNumbers?: (image: Buffer) => Promise<number[]> } = {}
): Promise<PageAudit[]> {
  const read = deps.readNumbers ?? readPrintedNumbers;
  const sorted = [...pages].sort(
    (a, b) => (a.filenameNumber ?? Number.MAX_SAFE_INTEGER) - (b.filenameNumber ?? Number.MAX_SAFE_INTEGER)
  );
  const audits: PageAudit[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i];
    const numbers = page.image.length ? await read(page.image).catch(() => []) : [];
    const printedNumber = numbers.length
      ? numbers.reduce((best, n) =>
          page.filenameNumber != null && Math.abs(n - page.filenameNumber) < Math.abs(best - page.filenameNumber) ? n : best
        )
      : null;
    if (page.filenameNumber == null) {
      const previous = sorted[i - 1]?.filenameNumber ?? null;
      const next = sorted[i + 1]?.filenameNumber ?? null;
      const inferred = inferOpenerPage(null, previous, next);
      audits.push({
        sourceFile: page.sourceFile,
        filenameNumber: null,
        printedNumber,
        auditStatus: "unnumbered",
        resolvedPageNumber: null,
        proposedNumber: inferred.number,
        reason: inferred.reason,
      });
      continue;
    }
    if (printedNumber == null) {
      audits.push({
        sourceFile: page.sourceFile,
        filenameNumber: page.filenameNumber,
        printedNumber: null,
        auditStatus: "unnumbered",
        resolvedPageNumber: null,
        proposedNumber: page.filenameNumber,
        reason: "no printed number",
      });
      continue;
    }
    const match = printedNumber === page.filenameNumber;
    audits.push({
      sourceFile: page.sourceFile,
      filenameNumber: page.filenameNumber,
      printedNumber,
      auditStatus: match ? "match" : "mismatch",
      resolvedPageNumber: match ? page.filenameNumber : null,
      proposedNumber: page.filenameNumber,
      reason: match ? "printed number matches filename" : `printed ${printedNumber}, filename ${page.filenameNumber}`,
    });
  }
  return audits;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batch-pages.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/types.ts backend/src/services/batch/pages.ts backend/test/batch-pages.test.ts backend/package.json
git commit -m "feat: add page manifest and page-number audit"
```

---

### Task 3: Strict one-page generation service

**Files:**
- Create: `backend/src/services/batch/generate.ts`
- Create: `backend/test/batch-generate.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `Candidate` and `GenerationMeta` types.
- Produces: `parseStrictReply(text: string): Candidate[]`.
- Produces: `buildStrictMessages(meta: GenerationMeta): ChatMessage[]`.
- Produces: `generatePage(cfg: ProviderConfig, model: string, image: Buffer, mimeType: string, meta: GenerationMeta, deps?: { chat?: typeof chatComplete }): Promise<Candidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/batch-generate.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { generatePage, parseStrictReply } from "../src/services/batch/generate";

const good = {
  difficulty: "easy",
  prompt: "What is the main river of Bangladesh?",
  options: ["Padma", "Jamuna", "Karnaphuli", "Meghna"],
  answer: "Padma",
  explanation: "The source names the Padma as the main river.",
  sourceQuote: "The Padma is the main river of Bangladesh.",
  marks: 1,
};

test("parseStrictReply accepts a valid item and drops a page field", () => {
  const items = parseStrictReply(JSON.stringify([{ ...good, page_number: 57 }]));
  assert.equal(items.length, 1);
  assert.equal("page_number" in items[0], false);
  assert.equal(items[0].answer, "Padma");
});

test("parseStrictReply rejects page attribution and bad options", () => {
  assert.equal(parseStrictReply(JSON.stringify([{ ...good, prompt: "According to page 57, what is the river?" }])).length, 0);
  assert.equal(parseStrictReply(JSON.stringify([{ ...good, options: ["Padma", "Padma", "A", "B"] }])).length, 0);
  assert.equal(parseStrictReply(JSON.stringify([{ ...good, answer: "Meghna" }])).length, 0);
});

test("generatePage sends exactly one page image and stamps nothing", async () => {
  let seen: any;
  const items = await generatePage(
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "fake-model",
    Buffer.from("png"),
    "image/png",
    { pageNumber: 57, chapterTitle: "CH. 04: Topography", maxQuestions: 5 },
    { chat: async (_cfg, _model, messages) => { seen = messages; return { text: JSON.stringify([good]) }; } }
  );
  assert.equal(items.length, 1);
  assert.equal(seen[0].images.length, 1);
  assert.equal(seen[0].images[0].mimeType, "image/png");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batch-generate.test.ts`
Expected: FAIL because `generate.ts` does not exist.

- [ ] **Step 3: Implement the strict generation service**

Create `backend/src/services/batch/generate.ts` with:

```ts
import { z } from "zod";
import { chatComplete } from "../ai/chat";
import type { ChatMessage, ProviderConfig } from "../ai/types";

export interface GenerationMeta {
  pageNumber: number;
  chapterTitle: string;
  maxQuestions: number;
}

export interface Candidate {
  type: "mcq";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string | null;
  sourceQuote: string;
  marks: number;
}
```

Use this system prompt (exact text):

```text
You write exam questions from a single scanned textbook page. Use ONLY the attached page. Never use outside knowledge, older-book terms, or anything not visible on the page. If the page does not state a fact, do not write a question about it.

Return a JSON array. Each item must be:
{"difficulty":"easy|medium|hard","prompt":"...","options":["...","...","...","..."],"answer":"exact option text","explanation":"one sentence","sourceQuote":"verbatim sentence from the page","marks":1}

Rules:
- Exactly 4 unique options. The answer must be copied character-for-character from one option.
- sourceQuote must be an exact sentence from the page that supports the answer.
- Do not return a page number; the system assigns it.
- Never write "according to page", "on page", "as stated in", "according to the textbook/Table/Figure", or an exercise reference.
- Write at most the requested number of questions. Fewer is fine; never invent to fill the count.
```

Implement `buildStrictMessages` with a user message containing the chapter title, page number for context, and max questions, plus `images: [{ mimeType, data: image.toString("base64") }]`.

Implement `parseStrictReply`:
- Extract the JSON array with a local helper (strip fences, find `[`/`]`, parse).
- Validate with a zod schema:
  - `difficulty` coerced to easy/medium/hard;
  - `prompt` non-empty and not matching `/according to page|on page \d|as stated in|পাঠ্যবই অনুযায়ী/i`;
  - `options` exactly 4 unique non-empty strings;
  - `answer` exactly matches one option;
  - `sourceQuote` non-empty;
  - `marks` integer > 0 else 1.
- Return `Candidate[]` with `page_number` discarded.

Implement `generatePage`:
- Build messages and call `deps.chat ?? chatComplete`.
- Return `parseStrictReply(result.text)`.
- If parsing returns zero items, throw `new Error("The model returned no valid questions for this page.")`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batch-generate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/generate.ts backend/test/batch-generate.test.ts backend/package.json
git commit -m "feat: add strict one-page question generation"
```

---

### Task 4: Evidence gates (quote, numbers, answer verifier)

**Files:**
- Create: `backend/src/services/batch/verify.ts`
- Create: `backend/test/batch-verify.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `normalizeEvidence(text: string): string`.
- Produces: `quoteCoverage(pageText: string, quote: string): number`.
- Produces: `isQuoteOnPage(pageText: string, quote: string, threshold?: number): boolean`.
- Produces: `numericTokens(text: string): string[]`.
- Produces: `missingNumbers(pageText: string, text: string): string[]`.
- Produces: `verifyCandidates(args: { pageText: string | null; image: Buffer; mimeType: string; candidates: Candidate[]; cfg: ProviderConfig; model: string; allowVisionFallback?: boolean; deps?: { chat?: typeof chatComplete } }): Promise<Array<{ index: number; valid: boolean; reason?: string; method?: "ocr" | "vision" }>>`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/batch-verify.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { isQuoteOnPage, missingNumbers, verifyCandidates } from "../src/services/batch/verify";

test("quote matching tolerates OCR noise", () => {
  const page = "The climate of Bangladesh is on the whole equable.";
  assert.equal(isQuoteOnPage(page, "The climate of Bangladesh is on the whole equable."), true);
  assert.equal(isQuoteOnPage(page, "climate of Bangladash is on the whole equable"), true);
  assert.equal(isQuoteOnPage(page, "The Padma is the main river."), false);
});

test("every numeric token must appear on the page", () => {
  assert.deepEqual(missingNumbers("In 2022 the rate was 7.1 percent.", "What was the rate in 2023?"), ["2023"]);
  assert.deepEqual(missingNumbers("In 2022 the rate was 7.1 percent.", "What was the rate in 2022?"), []);
});

test("verifyCandidates rejects when the verifier says invalid", async () => {
  const verdicts = await verifyCandidates({
    pageText: "The Padma is the main river of Bangladesh.",
    image: Buffer.from("png"),
    mimeType: "image/png",
    candidates: [{
      type: "mcq", difficulty: "easy", prompt: "What is the main river?",
      options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma",
      explanation: "The page says so.", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1,
    }],
    cfg: { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    model: "fake-model",
    deps: { chat: async () => ({ text: '[{"index":0,"valid":false,"reason":"answer not supported"}]' }) },
  });
  assert.equal(verdicts[0].valid, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batch-verify.test.ts`
Expected: FAIL because `verify.ts` does not exist.

- [ ] **Step 3: Implement the evidence gates**

Create `backend/src/services/batch/verify.ts`:
- `normalizeEvidence`: lowercase, replace Bengali digits with ASCII, replace non-alphanumeric with spaces, collapse whitespace, trim.
- `quoteCoverage`: fast path `page.includes(quote) => 1`; otherwise token coverage over tokens longer than 2 characters. A quote token counts as found when the page has the same token or a token within edit distance 2 (for tokens of length 5 or more). Return `found / total`; if fewer than 4 tokens, return 0 unless exact substring. Include a small `editDistance(a, b): number` helper for the token check.
- `isQuoteOnPage`: coverage >= threshold (default 0.9).
- `numericTokens`: match `/\d+(?:[.,]\d+)?/g` after Bengali digit normalization.
- `missingNumbers`: return numeric tokens in `text` not present in `normalizeEvidence(pageText)`.
- `verifyCandidates`:
  - Split candidates into quote-passed and rejected.
  - If `pageText` is null or empty: when `allowVisionFallback` is false, reject every candidate with `{ valid: false, reason: "no OCR text", method: "ocr" }`; when true, skip the deterministic quote gate and let the verifier check the quote against the image, marking those verdicts `method: "vision"`.
  - For quote failures, return `{ index, valid: false, reason: "quote not found on page", method: "ocr" }`.
  - For numeric failures, return `{ index, valid: false, reason: "number not found on page" }`.
  - If quote-passed is empty, return.
  - Call `chatComplete` once with the page image and a JSON prompt listing the quote-passed candidates (index, prompt, answer, options, sourceQuote).
  - Verifier system prompt: "Use only the attached page. For each item return {index, valid, reason}. Valid only if the quote is on the page, supports the answer, and no term or number in the question/options/answer is absent from the page."
  - Parse the array; default any missing index to valid: false with reason "no verifier verdict".
  - Merge with the rejected list in original order.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batch-verify.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/verify.ts backend/test/batch-verify.test.ts backend/package.json
git commit -m "feat: add quote, number, and answer evidence gates"
```

---

### Task 5: Provider retry, fallback chain, and failure classification

**Files:**
- Create: `backend/src/services/batch/retry.ts`
- Create: `backend/test/batch-retry.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `isRetryableAIError(err: unknown): boolean`.
- Produces: `withRetry<T>(fn: () => Promise<T>, opts?: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, err: unknown) => void }): Promise<T>`.
- Produces: `modelChain<T>(primary: T, fallbacks: T[]): T[]`.
- Circuit state lives in `batch_runs.consecutive_failures` and is handled in Task 7.

- [ ] **Step 1: Write the failing test**

Create `backend/test/batch-retry.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { AIError } from "../src/services/ai/types";
import { isRetryableAIError, withRetry } from "../src/services/batch/retry";

test("503 and rate-limit 429 are retryable; quota 429 is not", () => {
  assert.equal(isRetryableAIError(new AIError("busy", 503)), true);
  assert.equal(isRetryableAIError(new AIError("slow down", 429)), true);
  assert.equal(isRetryableAIError(new AIError("outside your plan quota", 429)), false);
  assert.equal(isRetryableAIError(new AIError("bad request", 400)), false);
});

test("withRetry succeeds on the third attempt and records delays", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await withRetry(
    async () => { calls++; if (calls < 3) throw new AIError("overloaded", 503); return "ok"; },
    { attempts: 3, delaysMs: [2, 8], sleep: async (ms) => { delays.push(ms); } }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2, 8]);
});

test("withRetry stops immediately on a quota error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new AIError("billing quota", 429); }, { sleep: async () => {} }),
    /billing quota/
  );
  assert.equal(calls, 1);
});

test("modelChain puts the primary first", async () => {
  const { modelChain } = await import("../src/services/batch/retry");
  assert.deepEqual(modelChain({ id: "a" }, [{ id: "b" }, { id: "c" }]).map((m) => m.id), ["a", "b", "c"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batch-retry.test.ts`
Expected: FAIL because `retry.ts` does not exist.

- [ ] **Step 3: Implement retry classification**

Create `backend/src/services/batch/retry.ts`:

```ts
import { AIError } from "../ai/types";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function isRetryableAIError(err: unknown): boolean {
  if (err instanceof AIError) {
    if (/quota|billing|plan/i.test(err.message)) return false;
    return RETRYABLE.has(err.status);
  }
  return true; // network errors and unknown transport failures
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, err: unknown) => void } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [2000, 8000, 30000];
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryableAIError(err) || i === attempts - 1) throw err;
      opts.onRetry?.(i + 1, err);
      await sleep(delays[Math.min(i, delays.length - 1)]);
    }
  }
  throw last;
}

export function modelChain<T>(primary: T, fallbacks: T[]): T[] {
  return [primary, ...fallbacks];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batch-retry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/retry.ts backend/test/batch-retry.test.ts backend/package.json
git commit -m "feat: add batch retry and provider failure classification"
```

---

### Task 6: Batch store, create/upload, and audit routes

**Files:**
- Create: `backend/src/services/batch/store.ts`
- Create: `backend/src/routes/batches.ts`
- Modify: `backend/src/app.ts` (mount `/api/batches`)
- Create: `backend/test/batches-api.test.ts`
- Modify: `backend/package.json` (test script)
- Modify: `backend/test/helpers.ts` (add `createChapter`)

**Interfaces:**
- Produces: `createBatch(input): Promise<string>`; `addBatchPages(batchId, pages): Promise<void>`; `getBatch(batchId): Promise<any>`; `listBatchPages(batchId): Promise<any[]>`; `auditBatch(batchId, deps?): Promise<any[]>`; `confirmBatchPage(batchId, sourceFile, resolvedPageNumber): Promise<void>`.
- Produces: `POST /api/batches`, `POST /api/batches/:id/pages`, `POST /api/batches/:id/audit`, `POST /api/batches/:id/confirm-page`, `GET /api/batches/:id`, `GET /api/batches`.

- [ ] **Step 1: Add a chapter helper and write the failing test**

In `backend/test/helpers.ts`, add:

```ts
export async function createChapter(subjectId: string, number = 4, title = "Test Chapter") {
  const db = await getDb();
  const id = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [id, subjectId, number, title, Date.now()]);
  return { id, subjectId, number, title };
}
```

Create `backend/test/batches-api.test.ts`:

```ts
import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { auth, createChapter, createQuestion, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("create batch, upload pages, audit unnumbered, confirm opener", async () => {
  const teacher = await createUser("teacher");
  const q = await createQuestion({});
  const chapter = await createChapter(q.subjectId, 4, "CH. 04: Topography");
  const create = await fetch(`${server.baseUrl}/api/batches`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_id: q.subjectId, chapter_id: chapter.id, target_count: 5,
      max_per_page: 2, provider: "google", model: "gemini-2.5-flash",
    }),
  });
  assert.equal(create.status, 200);
  const { id } = await create.json();

  const form = new FormData();
  form.append("pages", new Blob([Buffer.from("png")], { type: "image/png" }), "BGS conv 55.png");
  const upload = await fetch(`${server.baseUrl}/api/batches/${id}/pages`, {
    method: "POST", headers: auth(teacher.token), body: form,
  });
  assert.equal(upload.status, 200);
  assert.equal((await upload.json()).pages.length, 1);

  const audit = await fetch(`${server.baseUrl}/api/batches/${id}/audit`, {
    method: "POST", headers: auth(teacher.token),
  });
  assert.equal(audit.status, 200);
  const audited = await audit.json();
  assert.equal(audited.pages[0].page_number, 55);

  const confirm = await fetch(`${server.baseUrl}/api/batches/${id}/confirm-page`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ source_file: "BGS conv 55.png", resolved_page_number: 55 }),
  });
  assert.equal(confirm.status, 200);
  const detail = await (await fetch(`${server.baseUrl}/api/batches/${id}`, { headers: auth(teacher.token) })).json();
  assert.equal(detail.pages[0].audit_status, "confirmed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batches-api.test.ts`
Expected: FAIL because the route does not exist (404).

- [ ] **Step 3: Implement the store and routes**

Create `backend/src/services/batch/store.ts` with these functions, using `getDb`, `run`, `get`, `all`:

```ts
export async function createBatch(input: {
  subject_id: string; chapter_id: string; target_count: number; max_per_page: number;
  provider: string; model: string; fallback_models?: string[]; allow_vision_fallback?: boolean;
  created_by: string;
}): Promise<string>
```

Insert into `batch_runs` and return the new uuid.

```ts
export async function addBatchPages(batchId: string, pages: Array<{
  pageNumber: number | null; sourceFile: string; imagePath: string; imageSha: string;
}>): Promise<void>
```

Insert into `batch_pages` with `status='pending'`.

```ts
export async function auditBatch(batchId: string, deps?: { readNumbers?: (image: Buffer) => Promise<number[]> }): Promise<any[]>
```

Read pages, run `auditPages`, update `printed_number`, `audit_status`, `resolved_page_number` (`match` → filename; `unnumbered` with proposed → leave resolved null until confirmed), `proposedNumber` in the response.

```ts
export async function confirmBatchPage(batchId: string, sourceFile: string, resolvedPageNumber: number): Promise<void>
```

Set `audit_status='confirmed'`, `resolved_page_number=?` for that source file.

Create `backend/src/routes/batches.ts`:
- `router.use(requireAuth, requireRole("admin", "teacher"))`.
- `POST /` zod-validated body; reject with 400 when `supportsVision(model)` is false (“Pick a vision-capable model.”); `created_by = req.user!.id`.
- `POST /:id/pages` with multer memory storage (60 files, 20 MB each); save each to `path.resolve(process.cwd(), "data/batches", batchId)` with a sanitized basename; compute sha256; `parsePageNumberFromFilename` for `pageNumber`.
- `POST /:id/audit`.
- `POST /:id/confirm-page`.
- `GET /:id` returns `{ batch, pages }`.
- `GET /` returns recent 20 batches.

Mount in `app.ts`:

```ts
import batchesRouter from "./routes/batches";
app.use("/api/batches", batchesRouter);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batches-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/store.ts backend/src/routes/batches.ts backend/src/app.ts backend/test/helpers.ts backend/test/batches-api.test.ts backend/package.json
git commit -m "feat: add batch create, upload, and audit API"
```

---

### Task 7: Batch step — claim, generate, verify, save

**Files:**
- Create: `backend/src/services/batch/run.ts`
- Modify: `backend/src/routes/batches.ts` (`POST /:id/step`, `POST /:id/pause`, `POST /:id/resume`)
- Create: `backend/test/batches-step.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `runNextPage(batchId: string, deps?: { generatePage?: typeof generatePage; verifyCandidates?: typeof verifyCandidates; ocrPage?: (image: Buffer) => Promise<string>; getProviderConfig?: typeof getProviderConfig; retry?: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void> }; now?: () => number }): Promise<StepResult>`.
- Produces: `StepResult = { status: string; page: any | null; imported: number; rejected: number; reason?: string }`.
- Consumes: Tasks 2–5.

- [ ] **Step 1: Write the failing test**

Create `backend/test/batches-step.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { runNextPage } from "../src/services/batch/run";

test("step saves only verified, unique questions and stamps the resolved page", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const chapterId = randomUUID();
  const batchId = randomUUID();
  const pageId = randomUUID();
  const teacherId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 4, "Ch 4", Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,chapter_id,target_count,max_per_page,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [batchId, subjectId, chapterId, 5, 2, "google", "m", "running", teacherId, Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, batchId, 55, 55, "BGS conv 55.png", "match", "pending", "x.png", Date.now()]);

  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => ({ id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const }),
    generatePage: async () => [
      { type: "mcq", difficulty: "easy", prompt: "What is the main river?", options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "The page says so.", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 },
      { type: "mcq", difficulty: "easy", prompt: "What is the capital?", options: ["Dhaka", "Khulna", "Rajshahi", "Sylhet"], answer: "Dhaka", explanation: "Not on the page.", sourceQuote: "Dhaka is the capital of Bangladesh.", marks: 1 },
    ],
    verifyCandidates: async () => [{ index: 0, valid: true }, { index: 1, valid: false, reason: "quote not found" }],
  });

  assert.equal(result.imported, 1);
  assert.equal(result.rejected, 1);
  const rows = await all(db, "SELECT prompt,page_number,source_quote FROM questions WHERE batch_id=?", [batchId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page_number, 55);
  assert.equal(rows[0].source_quote, "The Padma is the main river of Bangladesh.");
  const page = await all(db, "SELECT status FROM batch_pages WHERE id=?", [pageId]);
  assert.equal(page[0].status, "done");
});

test("falls back to the next model after the primary fails", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,fallback_models,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [batchId, subjectId, "google", "primary", JSON.stringify([{ provider: "google", model: "fallback" }]), "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "match", "pending", "x.png", Date.now()]);

  const seen: string[] = [];
  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async (_cfg, model) => {
      seen.push(model);
      if (model === "primary") throw new Error("provider down");
      return [{ type: "mcq", difficulty: "easy", prompt: "What is the main river?", options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "x", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 }];
    },
    verifyCandidates: async () => [{ index: 0, valid: true }],
  });
  assert.equal(result.imported, 1);
  assert.deepEqual(seen, ["primary", "fallback"]);
});

test("three consecutive page failures pause the batch", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  for (const n of [1, 2, 3]) {
    await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), batchId, n, n, `BGS conv ${n}.png`, "match", "pending", "x.png", Date.now()]);
  }
  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  for (let i = 0; i < 3; i++) {
    await runNextPage(batchId, {
      ocrPage: async () => "text",
      getProviderConfig: async () => cfg,
      retry: { attempts: 1, sleep: async () => {} },
      generatePage: async () => { throw new Error("provider down"); },
      verifyCandidates: async () => [],
    });
  }
  const row = await all(db, "SELECT status,consecutive_failures FROM batch_runs WHERE id=?", [batchId]);
  assert.equal(row[0].status, "paused");
  assert.equal(row[0].consecutive_failures, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batches-step.test.ts`
Expected: FAIL because `run.ts` does not exist.

- [ ] **Step 3: Implement `runNextPage`**

Create `backend/src/services/batch/run.ts`. Import `getProviderConfig` from `../ai/providers`, `withRetry` and `modelChain` from `./retry`, and `ocrImage` from `../ai/ocr`. The exact claim query:

```sql
UPDATE batch_pages
SET status='running', attempts=attempts+1, lease_until=?
WHERE id = (
  SELECT id FROM batch_pages
  WHERE batch_id=? AND resolved_page_number IS NOT NULL
    AND (status='pending' OR (status='running' AND lease_until < ?))
  ORDER BY resolved_page_number LIMIT 1
)
AND (status='pending' OR (status='running' AND lease_until < ?))
```

Use `runChanges` to check the claim. Then read the claimed row with `status='running'` and `lease_until=?` (or the newest running page for the batch). Read the image from `image_path`; if missing, mark the page `failed` with `last_error`.

Flow:
1. `const runRow = await get(... batch_runs ...)`; require status `running` (the route sets it).
2. Claim the next page; if none, set batch `done` when no pending pages remain and return `{ status: "done", page: null, imported: 0, rejected: 0 }`.
3. `pageText = page.page_text || await deps.ocrPage(image)`; update `page_text`. The default `ocrPage` is `(image) => ocrImage(image, ["eng", "ben"])`.
4. Build `meta = { pageNumber: page.resolved_page_number, chapterTitle: chapter.title, maxQuestions: run.max_per_page }`.
5. Build the model chain: `modelChain({ provider: run.provider, model: run.model }, JSON.parse(run.fallback_models || "[]"))`. Resolve each entry with `const resolveCfg = deps.getProviderConfig ?? getProviderConfig` and call `withRetry(() => deps.generatePage(entryCfg, entry.model, image, mime, meta), deps.retry)`. Stop at the first success. If every entry fails after retries, mark the page `failed`, increment `consecutive_failures`, and set the batch `paused` when it reaches 3; return.
6. `verdicts = await deps.verifyCandidates({...})`.
7. For each candidate, if `valid`:
   - Normalize the prompt with `normalizeText` from `lib/text`; set `prompt_hash = sha256(normalizedPrompt)`. Skip if it exists in `questions` for the subject or in the batch's `batch_items`.
   - Insert into `questions` with `id`, `subject_id`, `chapter_id`, `type='mcq'`, `difficulty`, `prompt`, `options=JSON.stringify`, `answer`, `explanation`, `marks`, `page=String(resolved)`, `page_number=resolved`, `batch_id`, `source_quote`, `source_file`, `verification=JSON.stringify(verdict)`, `verification_method`, `created_by`, `created_at`.
   - Insert `batch_items` with status `accepted`.
   - Else insert `batch_items` with status `rejected`, reason.
8. Update `batch_runs` counters (`generated += candidates.length`, `quote_ok/answer_ok` counts from verdicts, `rejected += invalid`, `saved += imported`).
9. Mark page `done`; reset `consecutive_failures` to 0. If `saved >= target_count`, set batch `done`; if no pending pages remain, set `done`; otherwise leave `running`.

Wrap the per-page inserts and page status update in `batch(db, statements)` from `database.ts` so a mid-page failure does not half-apply.

- [ ] **Step 4: Add the routes**

In `batches.ts`:
- `POST /:id/step`: set batch status `running` (if `draft`/`paused`), call `runNextPage`, return the result.
- `POST /:id/pause`: set status `paused`.
- `POST /:id/resume`: set status `running`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batches-step.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/run.ts backend/src/routes/batches.ts backend/test/batches-step.test.ts backend/package.json
git commit -m "feat: add batch step generation and evidence save"
```

---

### Task 8: Batch undo, history, and resume guards

**Files:**
- Modify: `backend/src/services/batch/store.ts`
- Modify: `backend/src/routes/batches.ts`
- Create: `backend/test/batches-undo.test.ts`
- Modify: `backend/package.json` (test script)

**Interfaces:**
- Produces: `undoBatch(batchId: string): Promise<{ deleted: number }>`.
- Produces: `POST /api/batches/:id/retry-failed`, `DELETE /api/batches/:id`, `GET /api/batches`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/batches-undo.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { undoBatch } from "../src/services/batch/store";

test("undo deletes only the batch's questions", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  const existingId = randomUUID();
  const generatedId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,prompt,created_at) VALUES (?,?,?,?,?)`,
    [existingId, subjectId, "mcq", "Existing?", Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,created_at) VALUES (?,?,?,?,?)`,
    [batchId, subjectId, "google", "m", Date.now()]);
  await run(db, `INSERT INTO questions (id,subject_id,type,prompt,batch_id,created_at) VALUES (?,?,?,?,?,?)`,
    [generatedId, subjectId, "mcq", "Generated?", batchId, Date.now()]);

  assert.deepEqual(await undoBatch(batchId), { deleted: 1 });
  const left = await all(db, "SELECT id FROM questions WHERE subject_id=?", [subjectId]);
  assert.deepEqual(left.map((r: any) => r.id), [existingId]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/batches-undo.test.ts`
Expected: FAIL because `undoBatch` does not exist.

- [ ] **Step 3: Implement undo and routes**

In `store.ts`:

```ts
export async function undoBatch(batchId: string): Promise<{ deleted: number }> {
  const db = await getDb();
  const rows = await all(db, "SELECT id FROM questions WHERE batch_id=?", [batchId]);
  await batch(db, [
    { sql: "DELETE FROM questions WHERE batch_id=?", params: [batchId] },
    { sql: "DELETE FROM batch_runs WHERE id=?", params: [batchId] },
  ]);
  return { deleted: rows.length };
}
```

`DELETE FROM batch_runs` cascades to `batch_pages` and `batch_items`; it does **not** touch questions because `questions.batch_id` is a plain column. After the transaction, remove `data/batches/<batchId>` if it exists.

In `batches.ts`, add `DELETE /:id` calling `undoBatch` and `GET /` returning recent batches. Add `POST /:id/retry-failed`:

```ts
router.post("/:id/retry-failed", async (req, res) => {
  const db = await getDb();
  await run(db, "UPDATE batch_pages SET status='pending', last_error=NULL, lease_until=NULL WHERE batch_id=? AND status='failed'", [req.params.id]);
  await run(db, "UPDATE batch_runs SET status='running', consecutive_failures=0 WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/batches-undo.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/store.ts backend/src/routes/batches.ts backend/test/batches-undo.test.ts backend/package.json
git commit -m "feat: add batch undo and history"
```

---

### Task 9: Frontend Batch Studio shell, route, and nav

**Files:**
- Create: `frontend/src/pages/Batch.tsx`
- Create: `frontend/src/lib/batch.ts`
- Create: `frontend/src/components/batch/SetupPanel.tsx`, `AuditSheet.tsx`, `RunPanel.tsx`, `CorrectionPanel.tsx` (placeholders)
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Shell.tsx`

**Interfaces:**
- Produces: `BatchPage` React component at `/batch`.
- Produces: typed API helpers in `lib/batch.ts`: `createBatch`, `uploadPages`, `auditBatch`, `confirmPage`, `getBatch`, `stepBatch`, `pauseBatch`, `resumeBatch`, `undoBatch`, `listBatches`.

- [ ] **Step 1: Add the API helpers**

Create `frontend/src/lib/batch.ts` with TypeScript interfaces matching the backend JSON:
`Batch`, `BatchPage`, `BatchItem`, `StepResult`. Each helper calls `api` from `./api`.

- [ ] **Step 2: Add the page shell**

Create `frontend/src/pages/Batch.tsx`:

```tsx
import { useState } from "react";
import SetupPanel from "../components/batch/SetupPanel";
import AuditSheet from "../components/batch/AuditSheet";
import RunPanel from "../components/batch/RunPanel";
import CorrectionPanel from "../components/batch/CorrectionPanel";

export default function Batch() {
  const [tab, setTab] = useState<"generate" | "correct">("generate");
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Batch Studio</h1>
        <p className="text-slate-400 text-sm">Generate a large pool of evidence-checked questions, or audit the existing bank.</p>
      </header>
      <div className="flex gap-2">
        <button onClick={() => setTab("generate")} className={tab === "generate" ? "..." : "..."}>Generate</button>
        <button onClick={() => setTab("correct")} className={tab === "correct" ? "..." : "..."}>Correct existing</button>
      </div>
      {tab === "generate" ? <GenerateTab /> : <CorrectionPanel />}
    </div>
  );
}
```

`GenerateTab` composes `SetupPanel`, `AuditSheet`, and `RunPanel`; create the real versions in Tasks 10–11. For now, create placeholder files `SetupPanel.tsx`, `AuditSheet.tsx`, `RunPanel.tsx`, and `CorrectionPanel.tsx`, each exporting a component that returns `null`, so the app compiles.

- [ ] **Step 3: Add the route and nav item**

In `App.tsx`, import `Batch` and add:

```tsx
<Route path="/batch" element={<Private roles={["admin","teacher"]}><Batch /></Private>} />
```

In `Shell.tsx`, import `Layers` (or `Wand2`) from `lucide-react` and add to `NAV`:

```ts
{ to: "/batch", label: "Batch Studio", icon: Layers, roles: ["admin","teacher"] },
```

- [ ] **Step 4: Verify typecheck**

Run: `cd frontend; npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Batch.tsx frontend/src/lib/batch.ts frontend/src/App.tsx frontend/src/components/Shell.tsx
git commit -m "feat: add Batch Studio shell and navigation"
```

---

### Task 10: Batch Studio setup and page-audit UI

**Files:**
- Create: `frontend/src/components/batch/SetupPanel.tsx`
- Create: `frontend/src/components/batch/AuditSheet.tsx`

**Interfaces:**
- Consumes: `createBatch`, `uploadPages`, `auditBatch`, `confirmPage` from `lib/batch.ts`.
- Produces: `SetupPanel({ onCreated })` and `AuditSheet({ batch, onChanged })`.

- [ ] **Step 1: Build the setup panel**

Fields: subject select (`/subjects`), chapter select (`/subjects/:id/chapters`), page-image file input (`multiple`, accept `.png,.jpg,.jpeg`), target count (default 50), max per page (default 5), provider/model (reuse `/ai/models` shape), allow-vision-fallback checkbox (default off), Start audit button.

On submit: `createBatch`, then `uploadPages` with a `FormData` containing each file, then `auditBatch`; call `onCreated(batchId)`.

- [ ] **Step 2: Build the audit sheet**

Render a table: thumbnail (optional), filename, printed number, proposed number, status badge (`match` green, `unnumbered` amber, `mismatch` red). For each `unnumbered` row, show a **Confirm page N** button; for `mismatch`, show both numbers and a **Use filename** / **Use printed** choice. Call `confirmPage` and refresh.

- [ ] **Step 3: Verify typecheck and manual check**

Run: `cd frontend; npm run typecheck`
Manual: open `/batch`, select a subject/chapter, upload 2–3 named PNGs, confirm the opener, and check the status colors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/batch/SetupPanel.tsx frontend/src/components/batch/AuditSheet.tsx
git commit -m "feat: add Batch Studio setup and page audit UI"
```

---

### Task 11: Batch Studio run, evidence, retry, and undo UI

**Files:**
- Create: `frontend/src/components/batch/RunPanel.tsx`
- Create: `frontend/src/components/batch/EvidenceTable.tsx`

**Interfaces:**
- Consumes: `stepBatch`, `getBatch`, `pauseBatch`, `resumeBatch`, `undoBatch` from `lib/batch.ts`.
- Produces: `RunPanel({ batchId })` and `EvidenceTable({ batch })`.

- [ ] **Step 1: Build the run loop**

`RunPanel` polls `stepBatch(batchId)` while the batch status is `running` and the component is mounted. Use a `cancelled` ref; stop on `done`, `paused`, or an error. Show counters (generated, quote-ok, answer-ok, rejected, saved), current page, provider status (attempt/error from the step response), a Pause/Resume button, and a **Retry failed pages** button that calls the `POST /api/batches/:id/retry-failed` route from Task 8.

- [ ] **Step 2: Build the evidence table**

Columns: question, answer, page, source file, quote, verdict/method, status. Filter accepted/rejected. Add an **Undo batch** danger button calling `undoBatch`, then navigate to `/questions`.

- [ ] **Step 3: Verify typecheck and manual run**

Run: `cd frontend; npm run typecheck`
Manual: with a real provider key, run a 3-page batch for 5 questions. Confirm:
- saved questions appear in `/questions`;
- each has the correct page number from the filename;
- rejected rows show a reason;
- undo removes only that batch.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/batch/RunPanel.tsx frontend/src/components/batch/EvidenceTable.tsx
git commit -m "feat: add Batch Studio run and evidence UI"
```

---

### Task 12: Batch Studio docs and end-to-end verification

**Files:**
- Create: `docs/batch-studio.md`
- Modify: `README.md` (link to the guide)

- [ ] **Step 1: Write the guide**

Cover: prerequisites (Gemini key, page images named with the printed page), the page audit, the evidence gates, retries/fallback, how to read rejected rows, undo, the remote-database backup step (download `/api/backup` before migration), and the fact that existing questions are never touched by generation.

- [ ] **Step 2: Run the backend test suite**

Run: `cd backend; npm test`
Expected: all existing tests plus the new batch tests pass.

- [ ] **Step 3: Run the frontend typecheck and build**

Run: `cd frontend; npm run typecheck; npm run build`
Expected: both pass.

- [ ] **Step 4: Manual end-to-end checklist**

Use a copy of the real DB (`backend/data/mcq.db`) and a 3-page chapter:
1. Count questions before: `SELECT COUNT(*) FROM questions;`.
2. Run a 5-question batch.
3. Confirm the count increased by exactly the saved count, and no existing id changed.
4. Confirm each saved row's `page_number` equals its filename number and `source_quote` is non-empty.
5. Undo the batch; confirm the count returns to the original.
6. Try a page with a deliberately wrong quote; confirm it is rejected.

- [ ] **Step 5: Commit**

```bash
git add docs/batch-studio.md README.md
git commit -m "docs: add Batch Studio guide"
```

---

## Phase B — Existing question correction

### Task 13: Correction schema and revision log

**Files:**
- Modify: `backend/src/db/migrate.ts`
- Modify: `backend/test/migrate-integrity.test.ts`

**Interfaces:**
- Produces: `correction_runs`, `correction_items`, `question_revisions` tables.

- [ ] **Step 1: Add the failing assertion**

In `migrate-integrity.test.ts`, assert the three tables exist:

```ts
for (const table of ["correction_runs", "correction_items", "question_revisions"]) {
  const rows = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
  assert.equal(rows.length, 1, `missing table ${table}`);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/migrate-integrity.test.ts`
Expected: FAIL on the missing table.

- [ ] **Step 3: Add the tables**

Add to `SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS correction_runs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  chapter_id TEXT,
  source_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  checked INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  wrong_page INTEGER NOT NULL DEFAULT 0,
  wrong_answer INTEGER NOT NULL DEFAULT 0,
  not_found INTEGER NOT NULL DEFAULT 0,
  bad_options INTEGER NOT NULL DEFAULT 0,
  outside_book INTEGER NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS correction_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  current_json TEXT NOT NULL,
  proposed_json TEXT,
  evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES correction_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS question_revisions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  run_id TEXT,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  undone_at INTEGER,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_revisions_run ON question_revisions(run_id);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/migrate-integrity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrate.ts backend/test/migrate-integrity.test.ts
git commit -m "feat: add correction tables and revision log"
```

---

### Task 14: Correction audit service and API

**Files:**
- Create: `backend/src/services/batch/correct.ts`
- Create: `backend/src/routes/corrections.ts`
- Modify: `backend/src/app.ts`
- Create: `backend/test/corrections-audit.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `auditQuestion(question: any, page: { pageNumber: number; text: string; image: Buffer }, cfg: ProviderConfig, model: string, deps?): Promise<{ verdict: string; proposed: any | null; evidence: any }>`.
- Produces: `POST /api/corrections` (requires `source_batch_id` for the page images), `POST /api/corrections/:id/step`, `GET /api/corrections/:id`.
- Produces: `GET /api/corrections/:id` returns `usage` per item: `{ exams: number; attempts: number }`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/corrections-audit.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { auditQuestion } from "../src/services/batch/correct";

test("a wrong page is proposed without touching the question", async () => {
  const question = {
    id: "q1", prompt: "What is the main river?", options: JSON.stringify(["Padma", "Jamuna", "Meghna", "Karnaphuli"]),
    answer: "Padma", page_number: 55, explanation: "x",
  };
  const result = await auditQuestion(
    question,
    { pageNumber: 55, text: "The Padma is the main river of Bangladesh.", image: Buffer.from("png") },
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "m",
    { chat: async () => ({ text: '{"supported":true,"quote":"The Padma is the main river of Bangladesh."}' }) }
  );
  assert.equal(result.verdict, "ok");
  assert.equal(result.proposed, null);
  assert.ok(result.evidence.quote.includes("Padma"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/corrections-audit.test.ts`
Expected: FAIL because `correct.ts` does not exist.

- [ ] **Step 3: Implement the audit**

`auditQuestion`:
- Parse options; validate 4/answer/answer_key.
- Ask the verifier (one image + question + answer + options) to return `{supported, quote, reason}`.
- If supported and the quote is on the declared page → `ok`.
- If supported but the quote is not on the declared page → `wrong_page`; propose the page whose text contains the quote (search nearest pages first).
- If not supported → `wrong_answer` or `not_found`.
- Never write to `questions`.

`POST /api/corrections` creates a run with `subject_id`, `chapter_id`, a required `source_batch_id` (the page-image batch), and a list of question ids (or all in scope). The page images and their `page_text` come from `batch_pages`; OCR any page that has no `page_text` yet and store it there.

`POST /:id/step` audits the next 10 questions. Resolve the claimed page from `question.page_number`; if it is null, start from the first chapter page. For each question it uses the page text of its claimed page; if the quote is not there, it searches the other chapter pages in nearest-first order and proposes the page that contains it. For `wrong_answer`, the verifier returns the correct option text; propose it only when it exactly matches an existing option, otherwise mark `needs manual edit`. It inserts `correction_items` proposals and never updates `questions`.

`GET /:id` returns the run and items, with `usage` counts. Build the usage index once per request: load all `exams` and parse `question_ids`, load all `exam_attempts` and parse `answers`, and return `{ exams, attempts }` per question id.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/corrections-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the route to the app, test script, and commit**

```bash
git add backend/src/services/batch/correct.ts backend/src/routes/corrections.ts backend/src/app.ts backend/test/corrections-audit.test.ts backend/package.json
git commit -m "feat: add correction audit API"
```

---

### Task 15: Apply corrections in place with revisions and undo

**Files:**
- Modify: `backend/src/services/batch/correct.ts`
- Modify: `backend/src/routes/corrections.ts`
- Create: `backend/test/corrections-apply.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `applyCorrections(runId: string, itemIds: string[], userId: string): Promise<{ applied: number }>`.
- Produces: `undoCorrections(runId: string, userId: string): Promise<{ restored: number }>`.
- Produces: `POST /api/corrections/:id/apply`, `POST /api/corrections/:id/reject`, `POST /api/corrections/:id/undo`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/corrections-apply.test.ts`:

```ts
import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { createQuestion } from "./helpers";
import { applyCorrections, undoCorrections } from "../src/services/batch/correct";

test("apply keeps the id, writes a revision, and undo restores the before values", async () => {
  const q = await createQuestion({ pageNumber: 55, answer: "A" });
  const db = await getDb();
  const runId = randomUUID();
  const itemId = randomUUID();
  await run(db, "INSERT INTO correction_runs (id,subject_id,status,created_at) VALUES (?,?,?,?)",
    [runId, q.subjectId, "review", Date.now()]);
  await run(db, `INSERT INTO correction_items (id,run_id,question_id,verdict,current_json,proposed_json,status,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [itemId, runId, q.id, "wrong_page", JSON.stringify({ page_number: 55 }),
      JSON.stringify({ page_number: 57 }), "proposed", Date.now()]);

  assert.deepEqual(await applyCorrections(runId, [itemId], "teacher"), { applied: 1 });
  const after = await all(db, "SELECT id,page_number FROM questions WHERE id=?", [q.id]);
  assert.deepEqual(after.map((r: any) => [r.id, r.page_number]), [[q.id, 57]]);
  const revisions = await all(db, "SELECT before_json FROM question_revisions WHERE run_id=?", [runId]);
  assert.equal(revisions.length, 1);

  assert.deepEqual(await undoCorrections(runId, "teacher"), { restored: 1 });
  const restored = await all(db, "SELECT id,page_number FROM questions WHERE id=?", [q.id]);
  assert.deepEqual(restored.map((r: any) => [r.id, r.page_number]), [[q.id, 55]]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend; node --import tsx --test test/corrections-apply.test.ts`
Expected: FAIL because the functions do not exist.

- [ ] **Step 3: Implement apply and undo**

`applyCorrections`:
- Load proposed items with `status='proposed'` and ids in `itemIds`.
- For each, in one `batch(db, statements)`:
  - Read the current question row.
  - Insert `question_revisions` with `before_json` (full row) and `after_json` (merged row).
  - Update `questions` by id with only the proposed fields (`page_number`, `page`, `answer`, `explanation`, `source_quote`, `source_file`), never `id`.
  - Mark the item `applied`.
- Increment `correction_runs.applied`.

`undoCorrections`:
- Load revisions for the run where `undone_at IS NULL`, newest first.
- For each, update `questions` by id from `before_json` (only mutable fields), set `undone_at`.
- Mark applied items `rejected` (or leave a status that means undone; use `rejected`).
- Return `{ restored }`.

Reject endpoint marks items `rejected`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend; node --import tsx --test test/corrections-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the test file to the test script and commit**

```bash
git add backend/src/services/batch/correct.ts backend/src/routes/corrections.ts backend/test/corrections-apply.test.ts backend/package.json
git commit -m "feat: apply corrections in place with revisions and undo"
```

---

### Task 16: Correction UI tab

**Files:**
- Create: `frontend/src/components/batch/CorrectionPanel.tsx`
- Modify: `frontend/src/lib/batch.ts` (correction helpers)
- Modify: `frontend/src/pages/Batch.tsx`

**Interfaces:**
- Consumes: correction API helpers.
- Produces: `CorrectionPanel()` with run selection, audit progress, proposal table, apply/reject/undo.

- [ ] **Step 1: Add correction API helpers**

In `frontend/src/lib/batch.ts`, add `createCorrection`, `stepCorrection`, `getCorrection`, `applyCorrections`, `rejectCorrections`, `undoCorrections`.

- [ ] **Step 2: Build the panel**

Select subject/chapter; show the existing question count; Start audit. Progress calls `stepCorrection` until `done`. Table columns: question, current page/answer, verdict badge, proposed change, evidence quote, actions. Buttons: Apply selected, Reject selected, Undo run. Warn when a question is used by exams/attempts (the API returns `usage.exams`/`usage.attempts`).

- [ ] **Step 3: Verify typecheck and manual check**

Run: `cd frontend; npm run typecheck`
Manual: audit 3 known questions; confirm a wrong page proposal; apply it; verify the question id is unchanged; undo and confirm the original page returns.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/batch/CorrectionPanel.tsx frontend/src/lib/batch.ts frontend/src/pages/Batch.tsx
git commit -m "feat: add correction tab to Batch Studio"
```

---

### Task 17: Correction end-to-end verification and docs

**Files:**
- Modify: `docs/batch-studio.md`

- [ ] **Step 1: Add the correction checklist to the guide**

Document: audit existing questions, proposal statuses, apply in place, usage warnings, revision log, undo.

- [ ] **Step 2: Run the full backend test suite**

Run: `cd backend; npm test`
Expected: all tests pass, including migrate integrity, pages, generate, verify, retry, batches, undo, corrections.

- [ ] **Step 3: Integrity check against the real DB copy**

Copy `backend/data/mcq.db` to a temp file, point `DB_PATH` at the copy, run `npm test` or a small script, and assert:
- question count per subject unchanged after migration;
- no existing id changed after a generation run;
- a correction apply/undo round-trip restores the exact values.

- [ ] **Step 4: Commit**

```bash
git add docs/batch-studio.md
git commit -m "docs: add correction workflow"
```

---

## Self-Review Notes

- **Spec coverage:** page audit (Task 2), one-page generation (Task 3), quote/number/answer gates (Task 4), provider failures (Task 5), batch API/step/undo (Tasks 6–8), UI (Tasks 9–11, 16), correction (Tasks 13–17), integrity/backup (Tasks 1, 12, 17).
- **Type consistency:** `Candidate`, `PageAudit`, `SourcePage`, `StepResult`, and the store function names are defined once and reused.
- **Review Focus tests:** existing ids/count (Task 1), page stamping (Tasks 2, 7), wrong-page quote (Task 4), provider failure (Task 5), correction id/undo (Task 15).
- **Open execution decision:** subagent-driven vs native. The plan does not assume either.
