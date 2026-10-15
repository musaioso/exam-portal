import { getDb, run, get } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";

const SUBJECTS = [
  { name: "বাংলা ১ম পত্র", name_bn: "বাংলা ১ম পত্র", slug: "bangla-1st", code: "B1" },
  { name: "বাংলা ২য় পত্র", name_bn: "বাংলা ২য় পত্র", slug: "bangla-2nd", code: "B2" },
  { name: "English 1st Paper", name_bn: "English 1st Paper", slug: "english-1st", code: "E1" },
  { name: "English 2nd Paper", name_bn: "English 2nd Paper", slug: "english-2nd", code: "E2" },
  { name: "Religion", name_bn: "ধর্ম", slug: "religion", code: "RLG" },
  { name: "Bangladesh and Global Studies", name_bn: "বাংলাদেশ ও বিশ্বপরিচয়", slug: "bangladesh-global-studies", code: "BGS" },
  { name: "ICT", name_bn: "তথ্য ও যোগাযোগ প্রযুক্তি", slug: "ict", code: "ICT" },
];

async function main() {
  await getDb();
  await migrate();
  const db = await getDb();
  const now = Date.now();
  for (const s of SUBJECTS) {
    const existing = get(db, "SELECT id FROM subjects WHERE slug=?", [s.slug]);
    if (existing) {
      run(db, "UPDATE subjects SET name=?, name_bn=?, code=? WHERE slug=?", [s.name, s.name_bn, s.code, s.slug]);
    } else {
      run(db, "INSERT INTO subjects (id,name,name_bn,slug,code,description,created_at) VALUES (?,?,?,?,?,?,?)",
        [uuid(), s.name, s.name_bn, s.slug, s.code, "NCTB 2025 (English Version)", now]);
    }
  }
  // admin user
  if (!get(db, "SELECT id FROM users WHERE email=?", ["admin@mcq.local"])) {
    run(db, "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [uuid(), "Administrator", "admin@mcq.local", bcrypt.hashSync("admin123", 10), "admin", now]);
  }
  // sample teacher
  if (!get(db, "SELECT id FROM users WHERE email=?", ["teacher@mcq.local"])) {
    run(db, "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [uuid(), "Demo Teacher", "teacher@mcq.local", bcrypt.hashSync("teacher123", 10), "teacher", now]);
  }
  // sample student
  if (!get(db, "SELECT id FROM users WHERE email=?", ["student@mcq.local"])) {
    run(db, "INSERT INTO users (id,name,email,password_hash,role,grade,section,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [uuid(), "Demo Student", "student@mcq.local", bcrypt.hashSync("student123", 10), "student", "Class 8", "A", now]);
  }
  console.log("Seed complete.");
  console.log("Admin: admin@mcq.local / admin123");
  console.log("Teacher: teacher@mcq.local / teacher123");
  console.log("Student: student@mcq.local / student123");
}

main().catch((e) => { console.error(e); process.exit(1); });