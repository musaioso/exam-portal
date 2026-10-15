import { getDb, run, all, execScript } from "./database";

// Bump this whenever SCHEMA (or the ALTERs below) change so that cold starts
// re-run the migration once. When it matches what is stored in `app_meta`,
// warmup can skip the whole schema script (see serverless.ts).
export const SCHEMA_VERSION = "1";

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
  await ensureColumn(db, "exams", "subject_ids", "TEXT");
  await ensureColumn(db, "exams", "subject_times", "TEXT");
  await ensureColumn(db, "exams", "shuffle_questions", "INTEGER DEFAULT 0");
  await ensureColumn(db, "exams", "shuffle_options", "INTEGER DEFAULT 0");
  await run(db, "INSERT OR REPLACE INTO app_meta (key,value) VALUES ('schema_version', ?)", [SCHEMA_VERSION]);
}

export default migrate;
