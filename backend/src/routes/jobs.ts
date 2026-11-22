import { Router, Request, Response } from "express";
import { get, getDb } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import { chapterAvoidList, type WorkOrderKind } from "../services/jobs/avoid";
import { jobProgress } from "../services/jobs/progress";
import {
  createJob,
  createRun,
  deleteJob,
  getJob,
  listJobs,
  listRuns,
  updateJob,
} from "../services/jobs/store";
import { renderWorkOrder } from "../services/jobs/work-order";

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

router.post("/:id/work-order", async (req: Request, res: Response) => {
  const db = await getDb();
  const job = await getJob(db, String(req.params.id));
  if (!job) return res.status(404).json({ error: "Job not found" });

  const body = req.body || {};
  const kind = String(body.kind ?? "");
  if (!["mcq", "short", "passage"].includes(kind)) {
    return res.status(400).json({ error: "kind must be mcq, short or passage" });
  }
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1) {
    return res.status(400).json({ error: "count must be a positive integer" });
  }
  if (!job.pattern) {
    return res.status(400).json({ error: "this job has no pattern" });
  }
  if (!job.pattern.parts.some((part) => part.kind === kind)) {
    return res.status(400).json({ error: `this job's pattern has no ${kind}` });
  }

  const subject = await get(db, "SELECT code,name FROM subjects WHERE id=?", [job.subject_id]);
  if (!subject) return res.status(400).json({ error: "The subject was not found." });
  const chapter = await get(db, "SELECT number,title FROM chapters WHERE id=?", [job.chapter_id]);
  if (!chapter) return res.status(400).json({ error: "The chapter was not found." });

  try {
    const runKind = kind as WorkOrderKind;
    const avoid = await chapterAvoidList(db, job, runKind);
    const progress = await jobProgress(db, job);
    const remaining = Math.max((progress[runKind].target ?? 0) - progress[runKind].done, 0);
    const prompt = renderWorkOrder({
      job,
      subject: { code: subject.code ?? null, name: String(subject.name ?? "") },
      chapter: { number: Number(chapter.number), title: String(chapter.title ?? "") },
      pattern: job.pattern,
      kind: runKind,
      count,
      avoid,
      remaining,
    });
    const run = await createRun(db, job.id, runKind, count, prompt, req.user!.id);
    res.json({ run, prompt });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Could not build the work order" });
  }
});

export default router;
