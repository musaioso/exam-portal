import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { getDb, all, run } from "../db/database";
import { supportsVision } from "../services/ai/models";
import { parsePageNumberFromFilename } from "../services/batch/pages";
import {
  createBatch,
  addBatchPages,
  getBatch,
  listBatchPages,
  auditBatch,
  confirmBatchPage,
  undoBatch,
} from "../services/batch/store";
import { runNextPage } from "../services/batch/run";

const router = Router();
router.use(requireAuth, requireRole("admin", "teacher"));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 60 },
});

const createSchema = z.object({
  subject_id: z.string().min(1),
  chapter_id: z.string().min(1),
  target_count: z.coerce.number().int().min(1).max(500).default(50),
  max_per_page: z.coerce.number().int().min(1).max(20).default(5),
  provider: z.string().min(1),
  model: z.string().min(1),
  fallback_models: z.array(z.object({ provider: z.string(), model: z.string() })).optional(),
  allow_vision_fallback: z.boolean().optional(),
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const input = parsed.data;
  if (!supportsVision(input.model)) {
    return res.status(400).json({ error: "Pick a vision-capable model." });
  }
  const id = await createBatch({
    ...input,
    fallback_models: input.fallback_models,
    created_by: req.user!.id,
  });
  res.json({ id });
});

router.post("/:id/pages", upload.array("pages", 60), async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  if (files.length === 0) return res.status(400).json({ error: "pages[] required" });
  const dir = path.resolve(process.cwd(), "data", "batches", req.params.id);
  fs.mkdirSync(dir, { recursive: true });
  const pages = files.map((file, index) => {
    const base = path.basename(file.originalname).replace(/[^\w.\-]+/g, "_");
    const imagePath = path.join(dir, `${index}-${base}`);
    fs.writeFileSync(imagePath, file.buffer);
    return {
      pageNumber: parsePageNumberFromFilename(file.originalname),
      sourceFile: file.originalname,
      imagePath,
      imageSha: createHash("sha256").update(file.buffer).digest("hex"),
    };
  });
  await addBatchPages(req.params.id, pages);
  res.json({ pages: await listBatchPages(req.params.id) });
});

router.post("/:id/audit", async (req: Request, res: Response) => {
  const pages = await auditBatch(req.params.id);
  res.json({ pages });
});

const confirmSchema = z.object({
  source_file: z.string().min(1),
  resolved_page_number: z.coerce.number().int().min(1),
});

router.post("/:id/confirm-page", async (req: Request, res: Response) => {
  const parsed = confirmSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  await confirmBatchPage(req.params.id, parsed.data.source_file, parsed.data.resolved_page_number);
  res.json({ ok: true });
});

router.post("/:id/step", async (req: Request, res: Response) => {
  const result = await runNextPage(req.params.id);
  if (result.status === "missing") return res.status(404).json({ error: "Batch not found" });
  res.json(result);
});

router.post("/:id/pause", async (req: Request, res: Response) => {
  const db = await getDb();
  await run(db, "UPDATE batch_runs SET status='paused' WHERE id=?", [req.params.id]);
  res.json({ ok: true, status: "paused" });
});

router.post("/:id/resume", async (req: Request, res: Response) => {
  const db = await getDb();
  await run(db, "UPDATE batch_runs SET status='running', consecutive_failures=0 WHERE id=?", [req.params.id]);
  res.json({ ok: true, status: "running" });
});

router.post("/:id/retry-failed", async (req: Request, res: Response) => {
  const db = await getDb();
  await run(db, "UPDATE batch_pages SET status='pending', last_error=NULL, lease_until=NULL WHERE batch_id=? AND status='failed'", [req.params.id]);
  await run(db, "UPDATE batch_runs SET status='running', consecutive_failures=0 WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const result = await undoBatch(req.params.id);
  res.json(result);
});

router.get("/:id", async (req: Request, res: Response) => {
  const detail = await getBatch(req.params.id);
  if (!detail) return res.status(404).json({ error: "Batch not found" });
  res.json(detail);
});

router.get("/", async (_req: Request, res: Response) => {
  const db = await getDb();
  const batches = await all(db, "SELECT * FROM batch_runs ORDER BY created_at DESC LIMIT 20");
  res.json({ batches });
});

export default router;
