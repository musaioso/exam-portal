import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import bcrypt from "bcryptjs";

const router = Router();

router.get("/", requireAuth, requireRole("admin", "teacher"), async (_req, res) => {
  const db = await getDb();
  const users = await all(db, "SELECT id,name,email,role,grade,section,created_at FROM users ORDER BY created_at DESC");
  res.json({ users });
});

// teacher creates student account
router.post("/students", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { name, email, password, grade, section } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  if (await get(db, "SELECT id FROM users WHERE email=?", [email])) return res.status(409).json({ error: "Email exists" });
  const id = uuid();
  await run(db, "INSERT INTO users (id,name,email,password_hash,role,grade,section,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, name, email, bcrypt.hashSync(password, 10), "student", grade || null, section || null, Date.now()]);
  res.json({ user: { id, name, email, role: "student" } });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const db = await getDb();
  await run(db, "DELETE FROM users WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

export default router;