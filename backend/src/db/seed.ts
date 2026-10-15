import { getDb, run, get } from "./database";
import { randomUUID as uuid } from "node:crypto";
import bcrypt from "bcryptjs";
import DEMO_QUESTIONS from "./seed-questions.json";

const SUBJECTS = [
  { name: "বাংলা ১ম পত্র", name_bn: "বাংলা ১ম পত্র", slug: "bangla-1st", code: "B1" },
  { name: "বাংলা ২য় পত্র", name_bn: "বাংলা ২য় পত্র", slug: "bangla-2nd", code: "B2" },
  { name: "English 1st Paper", name_bn: "English 1st Paper", slug: "english-1st", code: "E1" },
  { name: "English 2nd Paper", name_bn: "English 2nd Paper", slug: "english-2nd", code: "E2" },
  { name: "Religion", name_bn: "ধর্ম", slug: "religion", code: "RLG" },
  { name: "Bangladesh and Global Studies", name_bn: "বাংলাদেশ ও বিশ্বপরিচয়", slug: "bangladesh-global-studies", code: "BGS" },
  { name: "ICT", name_bn: "তথ্য ও যোগাযোগ প্রযুক্তি", slug: "ict", code: "ICT" },
];

interface DemoQuestion {
  subject: string;
  type: string;
  difficulty: string | null;
  prompt: string;
  options: string[] | null;
  answer: string | null;
  explanation: string | null;
  marks: number | null;
}

/**
 * Ensures the demo subjects, accounts and questions exist. Idempotent: safe to
 * run on every (cold) start. Once the demo data has been created it is marked
 * in `app_meta` so later cold starts skip the work entirely.
 */
export async function seedDatabase() {
  const db = await getDb();

  const seeded = await get(db, "SELECT value FROM app_meta WHERE key='seeded'");
  if (seeded) return;

  const now = Date.now();
  // Upsert so concurrent cold starts can't trip the UNIQUE(slug) constraint.
  for (const s of SUBJECTS) {
    await run(db,
      `INSERT INTO subjects (id,name,name_bn,slug,code,description,created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(slug) DO UPDATE SET name=excluded.name, name_bn=excluded.name_bn, code=excluded.code`,
      [uuid(), s.name, s.name_bn, s.slug, s.code, "NCTB 2025 (English Version)", now]);
  }
  // Demo accounts (INSERT OR IGNORE keeps any password the user has changed).
  await run(db, "INSERT OR IGNORE INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
    [uuid(), "Administrator", "admin@mcq.local", bcrypt.hashSync("admin123", 10), "admin", now]);
  await run(db, "INSERT OR IGNORE INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
    [uuid(), "Demo Teacher", "teacher@mcq.local", bcrypt.hashSync("teacher123", 10), "teacher", now]);
  await run(db, "INSERT OR IGNORE INTO users (id,name,email,password_hash,role,grade,section,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [uuid(), "Demo Student", "student@mcq.local", bcrypt.hashSync("student123", 10), "student", "Class 8", "A", now]);

  // Demo questions: only on an empty questions table so real data is never
  // touched. Bodies live in seed-questions.json next to this file.
  const qCount = await get(db, "SELECT COUNT(*) AS c FROM questions") as any;
  if (!qCount || Number(qCount.c) === 0) {
    const admin = await get(db, "SELECT id FROM users WHERE email=?", ["admin@mcq.local"]) as any;
    const createdBy = admin ? admin.id : null;
    for (const q of DEMO_QUESTIONS as DemoQuestion[]) {
      const subject = await get(db, "SELECT id FROM subjects WHERE slug=?", [q.subject]) as any;
      if (!subject) continue;
      await run(
        db,
        `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuid(),
          subject.id,
          null,
          q.type,
          q.difficulty || "medium",
          q.prompt,
          q.options ? JSON.stringify(q.options) : null,
          q.answer ?? null,
          q.explanation ?? null,
          q.marks || 1,
          createdBy,
          now,
        ]
      );
    }
  }

  await run(db, "INSERT OR REPLACE INTO app_meta (key,value) VALUES ('seeded', ?)", [String(now)]);
}
