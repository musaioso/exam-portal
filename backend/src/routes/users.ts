import { Router, Request, Response } from "express";
import { randomUUID as uuid, randomBytes } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import bcrypt from "bcryptjs";

const router = Router();

router.get("/", requireAuth, requireRole("admin", "teacher"), async (_req, res) => {
  const db = await getDb();
  const users = await all(db, "SELECT id,name,email,role,grade,section,pin,created_at FROM users ORDER BY created_at DESC");
  res.json({ users });
});

/** "Ifaz Ahmed" -> "ifaz.ahmed". Bangla names fall back to plain "student". */
function slugify(name: string) {
  const base = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return base || "student";
}

/**
 * Students never see or type an email, but the column is UNIQUE NOT NULL, so
 * every student still gets a private throwaway one behind the scenes.
 */
async function uniqueEmail(db: any, name: string) {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = `${base}.${randomBytes(3).toString("hex")}@students.local`;
    if (!(await get(db, "SELECT id FROM users WHERE email = ?", [candidate]))) return candidate;
  }
  return `${base}.${Date.now()}@students.local`;
}

/** A 4-digit PIN that no other student is already using. */
async function uniquePin(db: any) {
  for (let i = 0; i < 60; i++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    if (!(await get(db, "SELECT id FROM users WHERE pin = ? AND role = 'student'", [pin]))) return pin;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

// teacher adds a student — only a name is really needed
router.post("/students", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { name, email, password, grade, section } = req.body || {};
  const cleanName = String(name || "").trim();
  if (!cleanName) return res.status(400).json({ error: "Student name is required" });

  const db = await getDb();

  let finalEmail = String(email || "").trim();
  if (finalEmail) {
    if (await get(db, "SELECT id FROM users WHERE email=?", [finalEmail])) return res.status(409).json({ error: "Email exists" });
  } else {
    finalEmail = await uniqueEmail(db, cleanName);
  }

  const pin = await uniquePin(db);
  const id = uuid();
  // The student signs in with a name + PIN, so the password row just needs to
  // exist (and be unguessable) — it is never handed out.
  const secret = password && String(password).length >= 4 ? String(password) : randomBytes(18).toString("base64url");

  await run(db, "INSERT INTO users (id,name,email,password_hash,role,grade,section,pin,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
    id,
    cleanName,
    finalEmail,
    bcrypt.hashSync(secret, 10),
    "student",
    String(grade || "").trim() || null,
    String(section || "").trim() || null,
    pin,
    Date.now(),
  ]);

  const user = {
    id,
    name: cleanName,
    email: finalEmail,
    role: "student",
    grade: String(grade || "").trim() || null,
    section: String(section || "").trim() || null,
    pin,
  };
  res.json({ user });
});

// teacher hands out a fresh PIN when a student forgets theirs
router.post("/:id/reset-pin", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  const target = (await get(db, "SELECT id,role FROM users WHERE id=?", [req.params.id])) as any;
  if (!target) return res.status(404).json({ error: "Not found" });
  if (target.role !== "student") return res.status(400).json({ error: "PINs are only for students" });
  const pin = await uniquePin(db);
  await run(db, "UPDATE users SET pin=? WHERE id=?", [pin, req.params.id]);
  res.json({ ok: true, pin });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const db = await getDb();
  await run(db, "DELETE FROM users WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

export default router;
