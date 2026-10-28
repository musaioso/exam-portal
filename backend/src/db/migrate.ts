import { getDb, run, all, execScript } from "./database";

// Bump this whenever SCHEMA (or the ALTERs below) change so that cold starts
// re-run the migration once. When it matches what is stored in `app_meta`,
// warmup can skip the whole schema script (see serverless.ts).
export const SCHEMA_VERSION = "10";

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
  await run(db, "INSERT OR REPLACE INTO app_meta (key,value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
}

export default migrate;
