import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get } from "../db/database";
import { requireAuth } from "../middleware/auth";

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

export default router;
