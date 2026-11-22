import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createJob,
  deleteJob,
  getJob,
  listJobs,
  listRuns,
  updateJob,
} from "../services/jobs/store";

const router = Router();
router.use(requireAuth, requireRole("admin", "teacher"));

router.get("/", async (req: Request, res: Response) => {
  const db = await getDb();
  const subjectId = req.query.subject_id ? String(req.query.subject_id) : null;
  res.json({ jobs: await listJobs(db, subjectId) });
});

router.post("/", async (req: Request, res: Response) => {
  const db = await getDb();
  try {
    const job = await createJob(db, req.body || {}, req.user!.id);
    res.json({ job });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Invalid job" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  try {
    const job = await updateJob(db, String(req.params.id), req.body || {});
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ job });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Invalid job" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  const existing = await getJob(db, String(req.params.id));
  if (!existing) return res.status(404).json({ error: "Job not found" });
  await deleteJob(db, String(req.params.id));
  res.json({ ok: true });
});

router.get("/:id/runs", async (req: Request, res: Response) => {
  const db = await getDb();
  const job = await getJob(db, String(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ runs: await listRuns(db, job.id) });
});

export default router;
