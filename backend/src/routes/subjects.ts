import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// Subjects
router.get("/", async (_req, res) => {
  const db = await getDb();
  const subjects = all(db, "SELECT * FROM subjects ORDER BY name");
  res.json({ subjects });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { name, name_bn, slug, code, description } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  const id = uuid();
  run(db, "INSERT INTO subjects (id,name,name_bn,slug,code,description,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, name, name_bn || null, slug, code || null, description || null, Date.now()]);
  res.json({ subject: { id, name, slug } });
});

router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { name, name_bn, code, description } = req.body || {};
  const db = await getDb();
  run(db, "UPDATE subjects SET name=COALESCE(?,name), name_bn=COALESCE(?,name_bn), code=COALESCE(?,code), description=COALESCE(?,description) WHERE id=?",
    [name, name_bn, code, description, req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  const db = await getDb();
  // Check if subject exists
  const subject = get(db, "SELECT id FROM subjects WHERE id=?", [req.params.id]);
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  // Delete subject (cascades to chapters and questions via ON DELETE CASCADE)
  run(db, "DELETE FROM subjects WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// Chapters nested
router.get("/:subjectId/chapters", async (req, res) => {
  const db = await getDb();
  const chapters = all(db, "SELECT * FROM chapters WHERE subject_id=? ORDER BY number", [req.params.subjectId]);
  res.json({ chapters });
});

router.post("/:subjectId/chapters", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { number, title, title_bn, summary } = req.body || {};
  if (!title) return res.status(400).json({ error: "Missing title" });
  const db = await getDb();
  const id = uuid();
  run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, req.params.subjectId, number || 1, title, title_bn || null, summary || null, Date.now()]);
  res.json({ chapter: { id, title } });
});

router.put("/chapters/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { number, title, title_bn, summary } = req.body || {};
  const db = await getDb();
  run(db, "UPDATE chapters SET number=COALESCE(?,number), title=COALESCE(?,title), title_bn=COALESCE(?,title_bn), summary=COALESCE(?,summary) WHERE id=?",
    [number, title, title_bn, summary, req.params.id]);
  res.json({ ok: true });
});

router.delete("/chapters/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  // Check if chapter exists
  const chapter = get(db, "SELECT id FROM chapters WHERE id=?", [req.params.id]);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  // Delete chapter (questions referencing it will have chapter_id set to NULL)
  run(db, "DELETE FROM chapters WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

export default router;