import { Router, Request, Response } from "express";
import { getDb, all, storage } from "../db/database";
import { SCHEMA_VERSION } from "../db/migrate";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// Everything worth keeping. `users` is handled separately below so that the
// password hashes can never leave the server.
const CONTENT_TABLES = [
  "subjects",
  "chapters",
  "questions",
  "exams",
  "exam_attempts",
  "results",
] as const;

/**
 * GET /api/backup
 *
 * One-shot JSON export of the whole school: subjects, chapters, questions,
 * exams, attempts and results. Admins also get the account list (without
 * password hashes); teachers get the content only.
 *
 * Download this before big changes — it is a plain JSON file that can be
 * re-imported later if anything ever goes wrong.
 */
router.get("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();

  const data: Record<string, unknown[]> = {};
  for (const table of CONTENT_TABLES) {
    data[table] = await all(db, `SELECT * FROM ${table}`);
  }
  if (req.user?.role === "admin") {
    data.users = await all(
      db,
      "SELECT id,name,email,role,grade,section,created_at FROM users ORDER BY created_at"
    );
  }

  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(data)) counts[table] = rows.length;

  res.json({
    app: "mcq-exam-portal",
    backup_version: 1,
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    // Tells you which database this snapshot came from ("remote" = Turso).
    storage,
    counts,
    data,
  });
});

export default router;
