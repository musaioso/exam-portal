import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { signToken, requireAuth } from "../middleware/auth";
import { isBlocked, recordFailure, clearFailures, retryAfterSeconds } from "../middleware/rateLimit";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
  const { name, email, password, inviteCode } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });
  // Teacher accounts are not self-serve: an admin shares the invite code.
  // Without a matching code the request is rejected, so a student cannot
  // register themselves as a teacher (or anything else).
  const expected = (process.env.TEACHER_INVITE_CODE || "school-invite").trim();
  if (String(inviteCode || "").trim() !== expected) {
    return res.status(403).json({ error: "Invalid or missing invite code. Ask your admin for it." });
  }
  const r = "teacher";
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

/**
 * Public, unauthenticated: the names the sign-in page lists so a student can
 * just tap their own. Only students who have a PIN (i.e. were added by a
 * teacher) show up, and no email or result ever leaves this endpoint.
 */
router.get("/students", async (_req: Request, res: Response) => {
  const db = await getDb();
  const students = await all(
    db,
    "SELECT id,name,grade,section FROM users WHERE role='student' AND pin IS NOT NULL ORDER BY grade, section, name"
  );
  res.json({ students });
});

/** Name + 4-digit PIN, no email anywhere. */
router.post("/student-login", async (req: Request, res: Response) => {
  const { studentId, pin } = req.body || {};
  const cleanPin = String(pin || "").trim();
  if (!studentId || !/^[0-9]{4}$/.test(cleanPin)) return res.status(400).json({ error: "Enter your 4-digit PIN" });

  // Requirement kept per student, so one forgetful classmate cannot lock out the rest.
  const key = `pin:${req.ip || "unknown"}:${studentId}`;
  if (isBlocked(key)) {
    const seconds = retryAfterSeconds(key);
    return res.status(429).json({
      error: `Too many wrong PINs. Please wait about ${Math.ceil(seconds / 60)} minute(s) and try again.`,
      retryAfter: seconds,
    });
  }

  const db = await getDb();
  const u = (await get(db, "SELECT id,name,email,role,pin FROM users WHERE id=? AND role='student'", [studentId])) as any;
  if (!u || !u.pin || u.pin !== cleanPin) {
    recordFailure(key);
    return res.status(401).json({ error: "That PIN did not match. Please try again." });
  }

  clearFailures(key);
  const user = { id: u.id, email: u.email, role: "student" as const, name: u.name };
  res.json({ token: signToken(user), user });
});

export default router;