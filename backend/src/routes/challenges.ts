import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const MAX_MESSAGE = 2000;

/**
 * A student's dispute of one question. Exam and missed-question practice carry
 * the attempt (and exam) so the inbox can name the paper; standalone practice
 * has neither.
 */
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { question_id, message, attempt_id } = req.body || {};
  const text = String(message ?? "").trim();
  if (!question_id) return res.status(400).json({ error: "Missing question" });
  if (!text || text.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `Challenge reason must be 1-${MAX_MESSAGE} characters` });
  }

  const db = await getDb();
  const question = await get(db, "SELECT id FROM questions WHERE id=?", [question_id]);
  if (!question) return res.status(404).json({ error: "Not found" });

  let source: "exam" | "practice" = "practice";
  let examId: string | null = null;
  let attemptId: string | null = null;

  if (attempt_id) {
    const attempt = (await get(db, "SELECT * FROM exam_attempts WHERE id=?", [attempt_id])) as any;
    if (!attempt) return res.status(404).json({ error: "Not found" });
    if (attempt.student_id !== req.user!.id) return res.status(403).json({ error: "Forbidden" });
    if (attempt.status === "in_progress") {
      return res.status(400).json({ error: "Submit the exam before challenging an answer" });
    }
    const exam = (await get(db, "SELECT id, question_ids FROM exams WHERE id=?", [attempt.exam_id])) as any;
    const qids: string[] = exam ? JSON.parse(exam.question_ids || "[]") : [];
    if (!exam || !qids.includes(question_id)) {
      return res.status(400).json({ error: "Question is not part of that exam" });
    }
    source = "exam";
    examId = exam.id;
    attemptId = attempt.id;
  }

  const existing = (await get(
    db,
    `SELECT * FROM question_challenges
     WHERE student_id=? AND question_id=? AND status='open'
       AND ${attemptId ? "attempt_id=?" : "attempt_id IS NULL"}
     ORDER BY created_at DESC LIMIT 1`,
    attemptId ? [req.user!.id, question_id, attemptId] : [req.user!.id, question_id]
  )) as any;
  if (existing) {
    return res.status(409).json({ error: "already_challenged", challenge: existing });
  }

  const id = uuid();
  await run(
    db,
    `INSERT INTO question_challenges
      (id,question_id,student_id,attempt_id,exam_id,source,message,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, question_id, req.user!.id, attemptId, examId, source, text, "open", Date.now()]
  );
  const challenge = await get(db, "SELECT * FROM question_challenges WHERE id=?", [id]);
  res.json({ challenge });
});

/** The caller's own challenge history. */
router.get("/mine", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = await all(
    db,
    `SELECT c.*, q.prompt AS question_prompt, q.page, q.page_number, e.title AS exam_title
     FROM question_challenges c
     JOIN questions q ON q.id = c.question_id
     LEFT JOIN exams e ON e.id = c.exam_id
     WHERE c.student_id = ?
     ORDER BY c.created_at DESC`,
    [req.user!.id]
  );
  res.json({ challenges: rows });
});

/** The staff inbox, newest first. */
router.get("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const status = String(req.query.status || "open");
  const where: string[] = [];
  const params: any[] = [];
  if (["open", "accepted", "rejected"].includes(status)) {
    where.push("c.status=?");
    params.push(status);
  }
  const term = String(req.query.q || "").trim();
  if (term) {
    const like = `%${term}%`;
    where.push("(u.name LIKE ? OR u.email LIKE ? OR q.prompt LIKE ? OR e.title LIKE ?)");
    params.push(like, like, like, like);
  }
  const rows = await all(
    db,
    `SELECT c.*, u.name AS student_name, u.email AS student_email,
       q.prompt AS question_prompt, q.options AS question_options,
       q.answer AS question_answer, q.explanation AS question_explanation,
       q.page, q.page_number, e.title AS exam_title
     FROM question_challenges c
     JOIN users u ON u.id = c.student_id
     JOIN questions q ON q.id = c.question_id
     LEFT JOIN exams e ON e.id = c.exam_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY c.created_at DESC`,
    params
  );
  res.json({
    challenges: (rows as any[]).map((row) => ({
      ...row,
      question_options: row.question_options ? JSON.parse(row.question_options) : null,
    })),
  });
});

/** Accept or reject an open challenge, with an optional reply. */
router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { status, reply } = req.body || {};
  if (!["accepted", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be accepted or rejected" });
  }
  const text = reply == null ? null : String(reply).trim();
  if (text && text.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `Reply must be at most ${MAX_MESSAGE} characters` });
  }

  const db = await getDb();
  const existing = (await get(db, "SELECT * FROM question_challenges WHERE id=?", [req.params.id])) as any;
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "open") {
    return res.status(409).json({ error: "This challenge has already been resolved" });
  }

  await run(
    db,
    "UPDATE question_challenges SET status=?, reply=?, reviewed_by=?, reviewed_at=? WHERE id=?",
    [status, text || null, req.user!.id, Date.now(), req.params.id]
  );
  const challenge = await get(db, "SELECT * FROM question_challenges WHERE id=?", [req.params.id]);
  res.json({ challenge });
});

export default router;