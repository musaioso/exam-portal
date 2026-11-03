import path from "node:path";
import { getDb, run, all, execScript, dbFilePath, storage } from "./database";
import { parseChapterHeading } from "../lib/chapter";
import { backupDatabaseFile } from "./backup";

// Bump this whenever SCHEMA (or the ALTERs below) change so that cold starts
// re-run the migration once. When it matches what is stored in `app_meta`,
// warmup can skip the whole schema script (see serverless.ts).
export const SCHEMA_VERSION = "16";

// NOTE: `pin` is a 4-digit code a student types after tapping their own name on
// the sign-in page. It sits in the clear on purpose so the teacher can read it
// back and hand it out again — only the admin/teacher endpoints ever return it.
const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  grade TEXT,
  section TEXT,
  pin TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_bn TEXT,
  slug TEXT UNIQUE NOT NULL,
  code TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_bn TEXT,
  summary TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  chapter_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('mcq','short','long')),
  difficulty TEXT DEFAULT 'medium',
  prompt TEXT NOT NULL,
  options TEXT,
  answer TEXT,
  explanation TEXT,
  marks INTEGER DEFAULT 1,
  -- free-text book ref (whole pages or ranges like "42-43")
  page TEXT,
  -- numeric form used by the importer and print answer key
  page_number INTEGER,
  -- visible section heading on the cited page
  section TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_ids TEXT,
  chapter_ids TEXT,
  question_ids TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  total_marks INTEGER DEFAULT 0,
  subject_times TEXT,
  shuffle_questions INTEGER DEFAULT 0,
  shuffle_options INTEGER DEFAULT 0,
  shuffle_seed INTEGER,
  created_by TEXT NOT NULL,
  is_published INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  answers TEXT NOT NULL,
  score REAL,
  total REAL,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  started_at INTEGER NOT NULL,
  submitted_at INTEGER,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  attempt_id TEXT UNIQUE NOT NULL,
  student_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  score REAL NOT NULL,
  total REAL NOT NULL,
  percentage REAL NOT NULL,
  graded_at INTEGER NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Uploaded source books for the AI generator. "content" holds a JSON array of
-- per-page extracted text (one string per page) so page-range generation can
-- slice exactly; "char_count" is the total length of all pages joined.
CREATE TABLE IF NOT EXISTS ai_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pages INTEGER,
  char_count INTEGER NOT NULL,
  content TEXT NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL,
  kind TEXT
);

-- One row per AI generate call, so teachers can see what has been produced
-- (and how much was rejected as duplicate/invalid) without re-running anything.
CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source TEXT NOT NULL,
  subject_id TEXT,
  requested INTEGER NOT NULL,
  produced INTEGER NOT NULL,
  duplicates INTEGER NOT NULL DEFAULT 0,
  invalid INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- Strict batch generation: one run per chapter, one row per source page, and
-- one row per generated candidate (accepted or rejected). Existing questions
-- are never modified by a batch; questions.batch_id is a plain column so a
-- batch delete cannot cascade into the bank.
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

-- Existing-question correction: proposals, the before/after revision log, and
-- one run per audit. Applying a correction updates the question in place by id.
CREATE TABLE IF NOT EXISTS correction_runs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  chapter_id TEXT,
  source_batch_id TEXT,
  -- "nearby" checks the claimed page and its neighbours; "chapter" searches
  -- the whole chapter, which is required for imports without page numbers.
  search_scope TEXT NOT NULL DEFAULT 'nearby',
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

-- Undo log for chapter merges. Stores the deleted chapters and the question ids
-- that were moved, so a merge can be reverted (up to the last few per subject).
CREATE TABLE IF NOT EXISTS chapter_merge_history (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- A student's dispute of a question's answer. Exam challenges carry the attempt
-- and exam so the inbox can still name the paper after the attempt is removed;
-- standalone-practice challenges carry neither.
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
-- Only one open dispute per student, question and attempt (or standalone
-- practice, where attempt_id is NULL). Enforced in the database so two
-- simultaneous submissions cannot both slip past the route's check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_challenges_open_once
  ON question_challenges(student_id, question_id, IFNULL(attempt_id, ''))
  WHERE status='open';

CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON exam_attempts(student_id);
`;

async function ensureColumn(db: any, table: string, name: string, definition: string) {
  const rows = await all(db, `PRAGMA table_info(${table})`);
  const exists = rows.some((r: any) => String(r.name) === name);
  if (!exists) await run(db, `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export async function migrate() {
  const db = await getDb();
  const versionRows = await all(db, "SELECT value FROM app_meta WHERE key='schema_version'").catch(() => []);
  const current = versionRows[0]?.value ?? null;
  if (current !== SCHEMA_VERSION) {
    if (storage === "file") {
      const dir = path.resolve(process.cwd(), "data/backups");
      backupDatabaseFile(dbFilePath, dir, `v${current ?? "new"}`);
    } else if (storage === "remote") {
      console.warn("[migrate] remote database: download /api/backup before the first migration");
    }
  }
  await execScript(db, SCHEMA);
  // Lightweight migrations for existing databases
  await ensureColumn(db, "users", "pin", "TEXT");
  await ensureColumn(db, "exams", "subject_ids", "TEXT");
  await ensureColumn(db, "exams", "subject_times", "TEXT");
  await ensureColumn(db, "exams", "shuffle_questions", "INTEGER DEFAULT 0");
  await ensureColumn(db, "exams", "shuffle_options", "INTEGER DEFAULT 0");
  // v7: deterministic shuffle seed so a printed paper, the exam record and the
  // answer key all agree on question/option order (no re-shuffle on print).
  await ensureColumn(db, "exams", "shuffle_seed", "INTEGER");
  // v8: backfill a deterministic seed for exams that already have shuffling on
  // but no seed yet, so take-exam/print/review all agree on one order.
  await run(db, "UPDATE exams SET shuffle_seed = (abs(random()) % 2147483647) WHERE (shuffle_questions=1 OR shuffle_options=1) AND shuffle_seed IS NULL");
  // v5: source uploads now include images ("pdf" | "image"); rows created
  // before this keep NULL and are treated as PDFs.
  await ensureColumn(db, "ai_documents", "kind", "TEXT");
  // Before v5 only PDFs were accepted, so NULL always means "pdf".
  await run(db, "UPDATE ai_documents SET kind='pdf' WHERE kind IS NULL");
  // v6: store source/book page number for questions (used in print answer key)
  await ensureColumn(db, "questions", "page", "TEXT");
  // v9: numeric page number for easier import/export
  await ensureColumn(db, "questions", "page_number", "INTEGER");
  // v13: evidence fields for strict batch generation and in-place corrections
  await ensureColumn(db, "questions", "batch_id", "TEXT");
  await ensureColumn(db, "questions", "source_quote", "TEXT");
  await ensureColumn(db, "questions", "source_file", "TEXT");
  await ensureColumn(db, "questions", "verification", "TEXT");
  await ensureColumn(db, "questions", "verification_method", "TEXT");
  await ensureColumn(db, "questions", "section", "TEXT");
  // v16: correction audits can search the whole chapter, not just the cited page.
  await ensureColumn(db, "correction_runs", "search_scope", "TEXT NOT NULL DEFAULT 'nearby'");
  // v13: test accounts used to check the app; their attempts stay out of the
  // class leaderboard (and other cross-student views).
  await ensureColumn(db, "users", "is_test", "INTEGER NOT NULL DEFAULT 0");
  // v14: chapter numbers must match the number written in the title, and that
  // prefix no longer belongs in the stored title (the UI prints "Ch. N — title",
  // which produced "Ch. 1 — CH. 11: …"). Range/multi-chapter headings keep both
  // their number and their title. Idempotent: clean titles parse to no prefix.
  const chapterRows = (await all(db, "SELECT id, number, title, title_bn FROM chapters")) as any[];
  for (const ch of chapterRows) {
    const fromTitle = parseChapterHeading(ch.title);
    const fromBn = ch.title_bn != null ? parseChapterHeading(ch.title_bn) : null;
    // A range heading has no single number, so keep the number already stored
    // instead of borrowing one from title_bn.
    const number = fromTitle.kind === "single"
      ? fromTitle.number
      : fromTitle.kind === "none"
        ? (fromBn?.number ?? null)
        : null;
    const sets: string[] = [];
    const params: any[] = [];
    if (number != null && number !== Number(ch.number)) {
      sets.push("number=?");
      params.push(number);
    }
    if (fromTitle.title !== ch.title) {
      sets.push("title=?");
      params.push(fromTitle.title);
    }
    if (fromBn && fromBn.title !== ch.title_bn) {
      sets.push("title_bn=?");
      params.push(fromBn.title);
    }
    if (sets.length > 0) {
      params.push(ch.id);
      await run(db, `UPDATE chapters SET ${sets.join(", ")} WHERE id=?`, params);
    }
  }
  await run(db, "INSERT OR REPLACE INTO app_meta (key,value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
}

export default migrate;
