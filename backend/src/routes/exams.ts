import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/", async (_req, res) => {
  const db = await getDb();
  const exams = all(db, "SELECT * FROM exams ORDER BY created_at DESC").map((e: any) => ({
    ...e,
    chapter_ids: e.chapter_ids ? JSON.parse(e.chapter_ids) : [],
    question_ids: JSON.parse(e.question_ids),
    is_published: !!e.is_published,
  }));
  res.json({ exams });
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const e = get(db, "SELECT * FROM exams WHERE id=?", [req.params.id]) as any;
  if (!e) return res.status(404).json({ error: "Not found" });
  e.chapter_ids = e.chapter_ids ? JSON.parse(e.chapter_ids) : [];
  e.question_ids = JSON.parse(e.question_ids);
  e.is_published = !!e.is_published;
  // attach questions
  const raw = all(db, `SELECT * FROM questions WHERE id IN (${e.question_ids.map(()=>'?').join(',')})`, e.question_ids);
  const byId = new Map(raw.map((q: any) => [q.id, q]));
  const qs = e.question_ids.map((id: string) => byId.get(id)).filter(Boolean)
    .map((q: any) => ({ ...q, options: q.options ? JSON.parse(q.options) : null }));
  res.json({ exam: e, questions: qs });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { title, subject_id, chapter_ids, question_ids, duration_minutes } = req.body || {};
  if (!title || !subject_id || !Array.isArray(question_ids) || question_ids.length === 0)
    return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  // compute total marks
  const qs = all(db, `SELECT marks FROM questions WHERE id IN (${question_ids.map(()=>'?').join(',')})`, question_ids);
  const total = qs.reduce((s, q: any) => s + (q.marks || 1), 0);
  const id = uuid();
  run(db, `INSERT INTO exams (id,title,subject_id,chapter_ids,question_ids,duration_minutes,total_marks,created_by,is_published,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, title, subject_id, JSON.stringify(chapter_ids || []), JSON.stringify(question_ids),
      duration_minutes || 30, total, req.user!.id, 0, Date.now()]);
  res.json({ exam: { id, total_marks: total } });
});

router.put("/:id/publish", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  run(db, "UPDATE exams SET is_published=1 WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.put("/:id/unpublish", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  run(db, "UPDATE exams SET is_published=0 WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  run(db, "DELETE FROM exams WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// Attempts
router.post("/:id/start", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const exam = get(db, "SELECT * FROM exams WHERE id=?", [req.params.id]) as any;
  if (!exam || !exam.is_published) return res.status(404).json({ error: "Exam not available" });
  // resume existing in_progress?
  const existing = get(db, "SELECT * FROM exam_attempts WHERE exam_id=? AND student_id=? AND status='in_progress'",
    [req.params.id, req.user!.id]) as any;
  if (existing) {
    existing.answers = JSON.parse(existing.answers);
    return res.json({ attempt: existing });
  }
  const id = uuid();
  run(db, "INSERT INTO exam_attempts (id,exam_id,student_id,answers,status,started_at) VALUES (?,?,?,?,?,?)",
    [id, req.params.id, req.user!.id, JSON.stringify({}), "in_progress", Date.now()]);
  res.json({ attempt: { id, exam_id: req.params.id, student_id: req.user!.id, answers: {}, status: "in_progress", started_at: Date.now() } });
});

router.post("/attempts/:attemptId/answer", requireAuth, async (req: Request, res: Response) => {
  const { question_id, answer } = req.body || {};
  const db = await getDb();
  const attempt = get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  if (attempt.student_id !== req.user!.id) return res.status(403).json({ error: "Forbidden" });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "Already submitted" });
  const answers = JSON.parse(attempt.answers || "{}");
  answers[question_id] = answer;
  run(db, "UPDATE exam_attempts SET answers=? WHERE id=?", [JSON.stringify(answers), req.params.attemptId]);
  res.json({ ok: true });
});

router.post("/attempts/:attemptId/submit", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const attempt = get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  if (attempt.student_id !== req.user!.id) return res.status(403).json({ error: "Forbidden" });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "Already submitted" });
  const exam = get(db, "SELECT * FROM exams WHERE id=?", [attempt.exam_id]) as any;
  const qids: string[] = JSON.parse(exam.question_ids);
  const questions = all(db, `SELECT * FROM questions WHERE id IN (${qids.map(()=>'?').join(',')})`, qids);
  const answers = JSON.parse(attempt.answers || "{}");
  // auto grade mcq
  let score = 0;
  const total = exam.total_marks;
  for (const q of questions as any[]) {
    if (q.type === "mcq") {
      const ans = answers[q.id];
      if (ans != null && String(ans).trim().toLowerCase() === String(q.answer).trim().toLowerCase()) {
        score += q.marks || 1;
      }
    }
  }
  run(db, "UPDATE exam_attempts SET status='submitted', score=?, total=?, submitted_at=? WHERE id=?",
    [score, total, Date.now(), req.params.attemptId]);
  // result
  const rid = uuid();
  const pct = total ? (score / total) * 100 : 0;
  run(db, "INSERT INTO results (id,attempt_id,student_id,exam_id,score,total,percentage,graded_at) VALUES (?,?,?,?,?,?,?,?)",
    [rid, req.params.attemptId, attempt.student_id, attempt.exam_id, score, total, pct, Date.now()]);
  res.json({ attempt_id: req.params.attemptId, score, total, percentage: pct });
});

router.get("/attempts/mine", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = all(db, "SELECT * FROM exam_attempts WHERE student_id=? ORDER BY started_at DESC", [req.user!.id])
    .map((a: any) => ({ ...a, answers: JSON.parse(a.answers || "{}") }));
  res.json({ attempts: rows });
});

router.get("/attempts/:attemptId", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const a = get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.student_id !== req.user!.id && req.user!.role !== "teacher" && req.user!.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  a.answers = JSON.parse(a.answers || "{}");
  res.json({ attempt: a });
});

// Manual grading (teacher) - override score
router.put("/attempts/:attemptId/grade", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { score, total } = req.body || {};
  const db = await getDb();
  const attempt = get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  const t = total != null ? total : attempt.total;
  const pct = t ? (score / t) * 100 : 0;
  run(db, "UPDATE exam_attempts SET status='graded', score=?, total=? WHERE id=?", [score, t, req.params.attemptId]);
  run(db, "UPDATE results SET score=?, total=?, percentage=?, graded_at=? WHERE attempt_id=?", [score, t, pct, Date.now(), req.params.attemptId]);
  res.json({ ok: true, score, total: t, percentage: pct });
});

export default router;