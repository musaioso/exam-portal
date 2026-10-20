import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole, optionalAuth } from "../middleware/auth";

const router = Router();

// Teacher/admin: list attempts with student + exam info
router.get("/attempts", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const { exam_id, student_id, status, subject_id, q } = req.query as any;
  const where: string[] = [];
  const params: any[] = [];
  if (exam_id) { where.push("ea.exam_id=?"); params.push(exam_id); }
  if (student_id) { where.push("ea.student_id=?"); params.push(student_id); }
  if (status) { where.push("ea.status=?"); params.push(status); }
  if (subject_id) { where.push("e.subject_id=?"); params.push(subject_id); }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    where.push("(u.name LIKE ? OR u.email LIKE ? OR e.title LIKE ?)");
    params.push(like, like, like);
  }
  const sql = `SELECT ea.*, u.name as student_name, u.email as student_email, u.grade as student_grade, u.section as student_section,
      e.title as exam_title, e.total_marks as exam_total_marks, e.subject_id as subject_id
    FROM exam_attempts ea
    JOIN users u ON u.id=ea.student_id
    JOIN exams e ON e.id=ea.exam_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ea.started_at DESC`;
  const rows = (await all(db, sql, params)).map((a: any) => ({ ...a, answers: JSON.parse(a.answers || "{}"), is_published: undefined }));
  res.json({ attempts: rows });
});

router.get("/:id/attempts", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = (await all(db, `SELECT ea.*, u.name as student_name, u.email as student_email, u.grade as student_grade, u.section as student_section,
      e.title as exam_title, e.total_marks as exam_total_marks, e.subject_id as subject_id
    FROM exam_attempts ea
    JOIN users u ON u.id=ea.student_id
    JOIN exams e ON e.id=ea.exam_id
    WHERE ea.exam_id=?
    ORDER BY ea.started_at DESC`, [req.params.id]))
    .map((a: any) => ({ ...a, answers: JSON.parse(a.answers || "{}") }));
  res.json({ attempts: rows });
});

// Class leaderboard — every student with at least one marked attempt, ranked by
// average score. Registered before "/:id" on purpose: that catch-all param route
// would otherwise swallow the word "leaderboard".
router.get("/leaderboard", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = await all(db, `
    SELECT u.id, u.name, COUNT(*) as attempts, AVG(r.percentage) as average, MAX(r.percentage) as best
    FROM results r
    JOIN users u ON u.id = r.student_id
    WHERE u.role = 'student'
    GROUP BY u.id
    ORDER BY average DESC, attempts DESC, u.name ASC`);
  const table = (rows as any[]).map((r: any, i: number) => ({
    rank: i + 1,
    student_id: r.id,
    name: r.name,
    attempts: Number(r.attempts) || 0,
    average: Math.round(Number(r.average) || 0),
    best: Math.round(Number(r.best) || 0),
  }));
  res.json({
    me: table.find((r: any) => r.student_id === req.user!.id) || null,
    top: table.slice(0, 10),
    total: table.length,
  });
});

// The exam catalogue. Drafts belong to their authors, so everyone except staff
// only ever receives published papers — the client-side filter in the UI is a
// convenience, not the access boundary.
router.get("/", optionalAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const isStaff = req.user?.role === "admin" || req.user?.role === "teacher";
  const visibility = isStaff ? "" : "WHERE COALESCE(is_published, 0) <> 0";
  const exams = (await all(db, `SELECT * FROM exams ${visibility} ORDER BY created_at DESC`)).map((e: any) => ({
    ...e,
    subject_ids: e.subject_ids ? JSON.parse(e.subject_ids) : [e.subject_id].filter(Boolean),
    subject_times: e.subject_times ? JSON.parse(e.subject_times) : [],
    chapter_ids: e.chapter_ids ? JSON.parse(e.chapter_ids) : [],
    question_ids: JSON.parse(e.question_ids),
    is_published: !!e.is_published,
    shuffle_questions: !!e.shuffle_questions,
    shuffle_options: !!e.shuffle_options,
  }));
  res.json({ exams });
});

router.get("/:id", requireAuth, async (req, res) => {
  const db = await getDb();
  const e = await get(db, "SELECT * FROM exams WHERE id=?", [req.params.id]) as any;
  if (!e) return res.status(404).json({ error: "Not found" });
  e.subject_ids = e.subject_ids ? JSON.parse(e.subject_ids) : [e.subject_id].filter(Boolean);
  e.subject_times = e.subject_times ? JSON.parse(e.subject_times) : [];
  e.chapter_ids = e.chapter_ids ? JSON.parse(e.chapter_ids) : [];
  e.question_ids = JSON.parse(e.question_ids);
  e.is_published = !!e.is_published;
  e.shuffle_questions = !!e.shuffle_questions;
  e.shuffle_options = !!e.shuffle_options;
  // attach questions
  const raw = await all(db, `SELECT * FROM questions WHERE id IN (${e.question_ids.map(()=>'?').join(',')})`, e.question_ids);
  const byId = new Map(raw.map((q: any) => [q.id, q]));
  // Students must never receive the key here — this endpoint is what a paper
  // is built from while they are still sitting it. The key and the explanation
  // are served by /attempts/:attemptId/review, and only once the attempt has
  // been submitted or graded.
  const isStaff = req.user!.role === "teacher" || req.user!.role === "admin";
  const qs = e.question_ids.map((id: string) => byId.get(id)).filter(Boolean)
    .map((q: any) => ({ ...q, options: q.options ? JSON.parse(q.options) : null }))
    .map((q: any) => (isStaff ? q : { ...q, answer: null, explanation: null }));
  res.json({ exam: e, questions: qs });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { title, subject_id, subject_ids, subject_times, chapter_ids, question_ids, duration_minutes, shuffle_questions, shuffle_options, shuffle_seed } = req.body || {};
  const subjList: string[] = Array.isArray(subject_ids) && subject_ids.length > 0
    ? subject_ids
    : [subject_id].filter(Boolean);
  if (!title || subjList.length === 0 || !Array.isArray(question_ids) || question_ids.length === 0)
    return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  // compute total marks
  const qs = await all(db, `SELECT marks FROM questions WHERE id IN (${question_ids.map(()=>'?').join(',')})`, question_ids);
  const total = qs.reduce((s, q: any) => s + (q.marks || 1), 0);
  // per-subject times: if provided, duration is the sum
  const times: Array<{ subject_id: string; minutes: number }> = Array.isArray(subject_times)
    ? subject_times.filter((t: any) => t && t.subject_id).map((t: any) => ({ subject_id: t.subject_id, minutes: Number(t.minutes) || 0 }))
    : [];
  const duration = times.length > 0
    ? times.reduce((s, t) => s + t.minutes, 0) || Number(duration_minutes) || 30
    : Number(duration_minutes) || 30;
  const id = uuid();
  const wantShuffle = !!(shuffle_questions || shuffle_options);
  const seed = wantShuffle
    ? (typeof shuffle_seed === "number" ? shuffle_seed : Math.floor(Math.random() * 2147483647))
    : null;
  await run(db, `INSERT INTO exams (id,title,subject_id,subject_ids,subject_times,chapter_ids,question_ids,duration_minutes,total_marks,shuffle_questions,shuffle_options,shuffle_seed,created_by,is_published,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, title, subjList[0], JSON.stringify(subjList), JSON.stringify(times), JSON.stringify(chapter_ids || []), JSON.stringify(question_ids),
      duration, total, shuffle_questions ? 1 : 0, shuffle_options ? 1 : 0, seed, req.user!.id, 0, Date.now()]);
  res.json({ exam: { id, total_marks: total, shuffle_seed: seed } });
});

router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const existing = await get(db, "SELECT * FROM exams WHERE id=?", [req.params.id]) as any;
  if (!existing) return res.status(404).json({ error: "Not found" });
  const { title, subject_id, subject_ids, subject_times, chapter_ids, question_ids, duration_minutes, shuffle_questions, shuffle_options, shuffle_seed } = req.body || {};
  const subjList: string[] = Array.isArray(subject_ids) && subject_ids.length > 0
    ? subject_ids
    : [subject_id || existing.subject_id].filter(Boolean);
  if (!title || subjList.length === 0 || !Array.isArray(question_ids) || question_ids.length === 0)
    return res.status(400).json({ error: "Missing fields" });
  // recompute total marks
  const qs = await all(db, `SELECT marks FROM questions WHERE id IN (${question_ids.map(()=>'?').join(',')})`, question_ids);
  const total = qs.reduce((s, q: any) => s + (q.marks || 1), 0);
  const times: Array<{ subject_id: string; minutes: number }> = Array.isArray(subject_times)
    ? subject_times.filter((t: any) => t && t.subject_id).map((t: any) => ({ subject_id: t.subject_id, minutes: Number(t.minutes) || 0 }))
    : [];
  const duration = times.length > 0
    ? times.reduce((s, t) => s + t.minutes, 0) || Number(duration_minutes) || existing.duration_minutes || 30
    : Number(duration_minutes) || existing.duration_minutes || 30;
  const wantShuffle = !!(shuffle_questions || shuffle_options);
  let seed: number | null = null;
  if (wantShuffle) {
    if (shuffle_seed === null) seed = Math.floor(Math.random() * 2147483647); // regenerate
    else if (typeof shuffle_seed === "number") seed = shuffle_seed;
    else if (existing.shuffle_seed != null) seed = existing.shuffle_seed; // keep
    else seed = Math.floor(Math.random() * 2147483647);
  }
  await run(db, `UPDATE exams SET title=?, subject_id=?, subject_ids=?, subject_times=?, chapter_ids=?, question_ids=?,
      duration_minutes=?, total_marks=?, shuffle_questions=?, shuffle_options=?, shuffle_seed=? WHERE id=?`,
    [title, subjList[0], JSON.stringify(subjList), JSON.stringify(times), JSON.stringify(chapter_ids || existing.chapter_ids || []),
      JSON.stringify(question_ids), duration, total, shuffle_questions ? 1 : 0, shuffle_options ? 1 : 0, seed, req.params.id]);
  res.json({ exam: { id: req.params.id, total_marks: total, shuffle_seed: seed } });
});

router.put("/:id/publish", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  await run(db, "UPDATE exams SET is_published=1 WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.put("/:id/unpublish", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  await run(db, "UPDATE exams SET is_published=0 WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireRole("admin", "teacher"), async (req, res) => {
  const db = await getDb();
  await run(db, "DELETE FROM exams WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// Attempts
router.post("/:id/start", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const exam = await get(db, "SELECT * FROM exams WHERE id=?", [req.params.id]) as any;
  if (!exam || !exam.is_published) return res.status(404).json({ error: "Exam not available" });
  // resume existing in_progress?
  const existing = await get(db, "SELECT * FROM exam_attempts WHERE exam_id=? AND student_id=? AND status='in_progress'",
    [req.params.id, req.user!.id]) as any;
  if (existing) {
    existing.answers = JSON.parse(existing.answers);
    return res.json({ attempt: existing });
  }
  const id = uuid();
  await run(db, "INSERT INTO exam_attempts (id,exam_id,student_id,answers,status,started_at) VALUES (?,?,?,?,?,?)",
    [id, req.params.id, req.user!.id, JSON.stringify({}), "in_progress", Date.now()]);
  res.json({ attempt: { id, exam_id: req.params.id, student_id: req.user!.id, answers: {}, status: "in_progress", started_at: Date.now() } });
});

router.post("/attempts/:attemptId/answer", requireAuth, async (req: Request, res: Response) => {
  const { question_id, answer } = req.body || {};
  const db = await getDb();
  const attempt = await get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  if (attempt.student_id !== req.user!.id) return res.status(403).json({ error: "Forbidden" });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "Already submitted" });
  const answers = JSON.parse(attempt.answers || "{}");
  // Once an MCQ answer is given it cannot be changed (no option re-selection).
  const q = (await get(db, "SELECT type FROM questions WHERE id=?", [question_id])) as any;
  if (q?.type === "mcq" && answers[question_id] !== undefined && answers[question_id] !== null && String(answers[question_id]).trim() !== "") {
    return res.status(400).json({ error: "Answer locked" });
  }
  answers[question_id] = answer;
  await run(db, "UPDATE exam_attempts SET answers=? WHERE id=?", [JSON.stringify(answers), req.params.attemptId]);
  res.json({ ok: true });
});

router.post("/attempts/:attemptId/submit", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const attempt = await get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  if (attempt.student_id !== req.user!.id) return res.status(403).json({ error: "Forbidden" });
  if (attempt.status !== "in_progress") return res.status(400).json({ error: "Already submitted" });
  const exam = await get(db, "SELECT * FROM exams WHERE id=?", [attempt.exam_id]) as any;
  const qids: string[] = JSON.parse(exam.question_ids);
  const questions = await all(db, `SELECT * FROM questions WHERE id IN (${qids.map(()=>'?').join(',')})`, qids);
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
  await run(db, "UPDATE exam_attempts SET status='submitted', score=?, total=?, submitted_at=? WHERE id=?",
    [score, total, Date.now(), req.params.attemptId]);
  // result
  const rid = uuid();
  const pct = total ? (score / total) * 100 : 0;
  await run(db, "INSERT INTO results (id,attempt_id,student_id,exam_id,score,total,percentage,graded_at) VALUES (?,?,?,?,?,?,?,?)",
    [rid, req.params.attemptId, attempt.student_id, attempt.exam_id, score, total, pct, Date.now()]);
  res.json({ attempt_id: req.params.attemptId, score, total, percentage: pct });
});

router.get("/attempts/mine", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = (await all(db, "SELECT * FROM exam_attempts WHERE student_id=? ORDER BY started_at DESC", [req.user!.id]))
    .map((a: any) => ({ ...a, answers: JSON.parse(a.answers || "{}") }));
  res.json({ attempts: rows });
});

router.get("/attempts/:attemptId", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const a = await get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!a) return res.status(404).json({ error: "Not found" });
  if (a.student_id !== req.user!.id && req.user!.role !== "teacher" && req.user!.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  a.answers = JSON.parse(a.answers || "{}");
  res.json({ attempt: a });
});

/**
 * The marked-up version of one attempt: every question with what the student
 * gave, whether it was right, and (once the attempt is submitted/graded, or for
 * a teacher) the key plus the explanation. This is what powers the student's
 * post-exam review and the "practice the ones you missed" flow — and it is the
 * only place the key is ever handed to a student.
 */
router.get("/attempts/:attemptId/review", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const a = await get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!a) return res.status(404).json({ error: "Not found" });
  const isStaff = req.user!.role === "teacher" || req.user!.role === "admin";
  if (a.student_id !== req.user!.id && !isStaff) return res.status(403).json({ error: "Forbidden" });

  const exam = await get(db, "SELECT * FROM exams WHERE id=?", [a.exam_id]) as any;
  if (!exam) return res.status(404).json({ error: "Not found" });
  const qids: string[] = JSON.parse(exam.question_ids || "[]");
  const raw = qids.length
    ? ((await all(db, `SELECT * FROM questions WHERE id IN (${qids.map(() => '?').join(',')})`, qids)) as any[])
    : [];
  const byId = new Map(raw.map((q: any) => [q.id, q]));
  const answers: Record<string, any> = JSON.parse(a.answers || "{}");
  const showKey = isStaff || a.status !== "in_progress";

  const questions = qids
    .map((id: string) => byId.get(id))
    .filter(Boolean)
    .map((q: any) => {
      const given = answers[q.id];
      const answered = given != null && String(given) !== "";
      const correct =
        q.type === "mcq" &&
        answered &&
        String(given).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase();
      return {
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        marks: q.marks ?? 1,
        options: q.options ? JSON.parse(q.options) : null,
        given: given ?? null,
        answered,
        correct: q.type === "mcq" ? correct : null,
        answer: showKey ? (q.answer ?? null) : null,
        explanation: showKey ? (q.explanation ?? null) : null,
      };
    });

  res.json({
    attempt: {
      id: a.id,
      exam_id: a.exam_id,
      student_id: a.student_id,
      status: a.status,
      score: a.score,
      total: a.total,
      started_at: a.started_at,
      submitted_at: a.submitted_at,
    },
    exam: {
      id: exam.id,
      title: exam.title,
      subject_id: exam.subject_id,
      total_marks: exam.total_marks,
      duration_minutes: exam.duration_minutes,
    },
    questions,
    showKey,
  });
});

// Manual grading (teacher) - override score
router.put("/attempts/:attemptId/grade", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { score, total } = req.body || {};
  const db = await getDb();
  const attempt = await get(db, "SELECT * FROM exam_attempts WHERE id=?", [req.params.attemptId]) as any;
  if (!attempt) return res.status(404).json({ error: "Not found" });
  const t = total != null ? total : attempt.total;
  const pct = t ? (score / t) * 100 : 0;
  await run(db, "UPDATE exam_attempts SET status='graded', score=?, total=? WHERE id=?", [score, t, req.params.attemptId]);
  await run(db, "UPDATE results SET score=?, total=?, percentage=?, graded_at=? WHERE attempt_id=?", [score, t, pct, Date.now(), req.params.attemptId]);
  res.json({ ok: true, score, total: t, percentage: pct });
});

export default router;