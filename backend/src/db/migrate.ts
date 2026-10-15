import { getDb } from "./database";

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

CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON exam_attempts(student_id);
`;

function ensureColumn(db: any, table: string, name: string, definition: string) {
  const info = db.exec(`PRAGMA table_info(${table})`);
  const rows: any[][] = (info[0]?.values as any[][]) || [];
  const exists = rows.some((r) => String(r[1]) === name);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export async function migrate() {
  const db = await getDb();
  db.exec(SCHEMA);
  // Lightweight migrations for existing databases
  ensureColumn(db, "exams", "subject_ids", "TEXT");
  ensureColumn(db, "exams", "subject_times", "TEXT");
  ensureColumn(db, "exams", "shuffle_questions", "INTEGER DEFAULT 0");
  ensureColumn(db, "exams", "shuffle_options", "INTEGER DEFAULT 0");
  const { schedulePersist } = await import("./database");
  schedulePersist(db);
}

export default migrate;