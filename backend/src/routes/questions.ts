import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const db = await getDb();
  const { subject_id, chapter_id, type, difficulty } = req.query as any;
  let sql = "SELECT * FROM questions WHERE 1=1";
  const params: any[] = [];
  if (subject_id) { sql += " AND subject_id=?"; params.push(subject_id); }
  if (chapter_id) { sql += " AND chapter_id=?"; params.push(chapter_id); }
  if (type) { sql += " AND type=?"; params.push(type); }
  if (difficulty) { sql += " AND difficulty=?"; params.push(difficulty); }
  sql += " ORDER BY created_at DESC";
  const rows = all(db, sql, params).map((r: any) => ({
    ...r,
    options: r.options ? JSON.parse(r.options) : null,
    chapter_ids: undefined,
  }));
  res.json({ questions: rows });
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const r = get(db, "SELECT * FROM questions WHERE id=?", [req.params.id]) as any;
  if (!r) return res.status(404).json({ error: "Not found" });
  r.options = r.options ? JSON.parse(r.options) : null;
  res.json({ question: r });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { subject_id, chapter_id, type, difficulty, prompt, options, answer, explanation, marks } = req.body || {};
  if (!subject_id || !type || !prompt) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  const id = uuid();
  run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, subject_id, chapter_id || null, type, difficulty || "medium", prompt,
      options ? JSON.stringify(options) : null, answer || null, explanation || null, marks || 1,
      req.user!.id, Date.now()]);
  res.json({ question: { id } });
});

router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { subject_id, chapter_id, type, difficulty, prompt, options, answer, explanation, marks } = req.body || {};
  const db = await getDb();
  run(db, `UPDATE questions SET
    subject_id=COALESCE(?,subject_id), chapter_id=COALESCE(?,chapter_id), type=COALESCE(?,type),
    difficulty=COALESCE(?,difficulty), prompt=COALESCE(?,prompt),
    options=?, answer=COALESCE(?,answer), explanation=COALESCE(?,explanation), marks=COALESCE(?,marks)
    WHERE id=?`,
    [subject_id, chapter_id, type, difficulty, prompt,
      options ? JSON.stringify(options) : null, answer, explanation, marks, req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  run(db, "DELETE FROM questions WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

export default router;