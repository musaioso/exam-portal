import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, run, get, all, runChanges } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import { runCorrectionStep, usageIndex, applyCorrections, undoCorrections } from "../services/batch/correct";

const router = Router();
router.use(requireAuth, requireRole("admin", "teacher"));

const createSchema = z.object({
  subject_id: z.string().min(1),
  chapter_id: z.string().min(1),
  source_batch_id: z.string().min(1),
  question_ids: z.array(z.string()).optional(),
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const input = parsed.data;
  const db = await getDb();
  const batch = await get(db, "SELECT id,subject_id,chapter_id FROM batch_runs WHERE id=?", [input.source_batch_id]);
  if (!batch) return res.status(400).json({ error: "The source page-image batch was not found." });
  if (String(batch.subject_id) !== input.subject_id) {
    return res.status(400).json({ error: "The source batch belongs to a different subject." });
  }
  if (batch.chapter_id && String(batch.chapter_id) !== input.chapter_id) {
    return res.status(400).json({ error: "The source batch belongs to a different chapter." });
  }

  const id = randomUUID();
  const chapterId = input.chapter_id;
  await run(db, `INSERT INTO correction_runs
    (id,subject_id,chapter_id,source_batch_id,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`,
    [id, input.subject_id, chapterId, input.source_batch_id, "draft", req.user!.id, Date.now()]);

  if (input.question_ids?.length) {
    for (const questionId of input.question_ids) {
      const question = await get(db, "SELECT * FROM questions WHERE id=? AND subject_id=?", [questionId, input.subject_id]);
      if (!question) continue;
      await run(db, `INSERT INTO correction_items
        (id,run_id,question_id,verdict,current_json,proposed_json,evidence_json,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), id, questionId, "pending", JSON.stringify(question), null, null, "pending", Date.now()]);
    }
  }

  res.json({ id });
});

router.post("/:id/step", async (req: Request, res: Response) => {
  try {
    const result = await runCorrectionStep(String(req.params.id));
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "The correction audit could not continue." });
  }
});

const idsSchema = z.object({ item_ids: z.array(z.string().min(1)).min(1) });

router.post("/:id/apply", async (req: Request, res: Response) => {
  const parsed = idsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "item_ids[] required" });
  const result = await applyCorrections(String(req.params.id), parsed.data.item_ids, req.user!.id);
  res.json(result);
});

router.post("/:id/reject", async (req: Request, res: Response) => {
  const parsed = idsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "item_ids[] required" });
  const db = await getDb();
  const placeholders = parsed.data.item_ids.map(() => "?").join(",");
  const rejected = await runChanges(
    db,
    `UPDATE correction_items SET status='rejected' WHERE run_id=? AND id IN (${placeholders}) AND status='proposed'`,
    [String(req.params.id), ...parsed.data.item_ids]
  );
  res.json({ rejected });
});

router.post("/:id/undo", async (req: Request, res: Response) => {
  const result = await undoCorrections(String(req.params.id), req.user!.id);
  res.json(result);
});

router.get("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  const correctionRun = await get(db, "SELECT * FROM correction_runs WHERE id=?", [String(req.params.id)]);
  if (!correctionRun) return res.status(404).json({ error: "Correction run not found" });
  const items = await all(db, "SELECT * FROM correction_items WHERE run_id=? ORDER BY created_at DESC LIMIT 500", [String(req.params.id)]);
  const usage = await usageIndex();
  res.json({
    run: correctionRun,
    items: items.map((item: any) => ({
      ...item,
      usage: {
        exams: usage.exams.get(String(item.question_id)) || 0,
        attempts: usage.attempts.get(String(item.question_id)) || 0,
      },
    })),
  });
});

router.get("/", async (_req: Request, res: Response) => {
  const db = await getDb();
  const runs = await all(db, "SELECT * FROM correction_runs ORDER BY created_at DESC LIMIT 20");
  res.json({ runs });
});

export default router;
