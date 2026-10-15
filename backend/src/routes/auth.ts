import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { signToken, requireAuth } from "../middleware/auth";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const r = (role === "teacher" || role === "student") ? role : "student";
  const db = await getDb();
  const existing = await get(db, "SELECT id FROM users WHERE email = ?", [email]);
  if (existing) return res.status(409).json({ error: "Email already registered" });
  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  await run(db, "INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
    [id, name, email, hash, r, Date.now()]);
  const token = signToken({ id, email, role: r as any, name });
  res.json({ token, user: { id, name, email, role: r } });
});

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  const u = await get(db, "SELECT * FROM users WHERE email = ?", [email]) as any;
  if (!u) return res.status(401).json({ error: "Invalid credentials" });
  if (!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
  const user = { id: u.id, email: u.email, role: u.role, name: u.name };
  const token = signToken(user);
  res.json({ token, user });
});

router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

export default router;