import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createPattern,
  deletePattern,
  getPattern,
  listPatterns,
  updatePattern,
} from "../services/jobs/patterns";

const router = Router();
router.use(requireAuth, requireRole("admin", "teacher"));

router.get("/", async (_req: Request, res: Response) => {
  const db = await getDb();
  res.json({ patterns: await listPatterns(db) });
});

router.post("/", async (req: Request, res: Response) => {
  const db = await getDb();
  try {
    const pattern = await createPattern(db, req.body || {}, req.user!.id);
    res.json({ pattern });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Invalid pattern" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  try {
    const pattern = await updatePattern(db, String(req.params.id), req.body || {});
    if (!pattern) return res.status(404).json({ error: "Pattern not found" });
    res.json({ pattern });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Invalid pattern" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  const existing = await getPattern(db, String(req.params.id));
  if (!existing) return res.status(404).json({ error: "Pattern not found" });
  await deletePattern(db, String(req.params.id));
  res.json({ ok: true });
});

export default router;
