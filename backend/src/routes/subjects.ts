import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

// Subjects
router.get("/", async (_req, res) => {
  const db = await getDb();
  const subjects = await all(db, "SELECT * FROM subjects ORDER BY name");
  res.json({ subjects });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { name, name_bn, slug, code, description } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  const id = uuid();
  await run(db, "INSERT INTO subjects (id,name,name_bn,slug,code,description,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, name, name_bn || null, slug, code || null, description || null, Date.now()]);
  res.json({ subject: { id, name, slug } });
});

router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { name, name_bn, code, description } = req.body || {};
  const db = await getDb();
  await run(db, "UPDATE subjects SET name=COALESCE(?,name), name_bn=COALESCE(?,name_bn), code=COALESCE(?,code), description=COALESCE(?,description) WHERE id=?",
    [name, name_bn, code, description, req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (req: Request, res: Response) => {
  const db = await getDb();
  // Check if subject exists
  const subject = await get(db, "SELECT id FROM subjects WHERE id=?", [req.params.id]);
  if (!subject) return res.status(404).json({ error: "Subject not found" });
  // Delete subject (cascades to chapters and questions via ON DELETE CASCADE)
  await run(db, "DELETE FROM subjects WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// Chapters nested
router.get("/:subjectId/chapters", async (req, res) => {
  const db = await getDb();
  const chapters = await all(
    db,
    `SELECT c.*, (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id) AS question_count
     FROM chapters c WHERE c.subject_id=? ORDER BY c.number`,
    [req.params.subjectId]
  );
  res.json({ chapters });
});

// Merge one or more duplicate chapters into a single canonical chapter: move all
// of their questions to the canonical chapter, then delete the duplicates. Keeps
// question ids intact so existing exams are unaffected.
router.post("/:subjectId/chapters/merge", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { canonical_id, duplicate_ids } = req.body || {};
  if (!canonical_id || !Array.isArray(duplicate_ids) || duplicate_ids.length === 0) {
    return res.status(400).json({ error: "canonical_id and duplicate_ids[] required" });
  }
  const ids = [...new Set(duplicate_ids.map((x: any) => String(x)).filter((x) => x && x !== canonical_id))];
  if (ids.length === 0) return res.status(400).json({ error: "No duplicates to merge" });

  const db = await getDb();
  // Validate ownership: every chapter must belong to this subject.
  const allIds = [canonical_id, ...ids];
  const rows = (await all(
    db,
    `SELECT id FROM chapters WHERE subject_id=? AND id IN (${allIds.map(() => "?").join(",")})`,
    [req.params.subjectId, ...allIds]
  )) as any[];
  if (rows.length !== allIds.length) return res.status(400).json({ error: "Chapter not found in this subject" });

  const placeholders = ids.map(() => "?").join(",");

  // Snapshot the duplicate chapters + the questions that will move, so the merge
  // can be undone later.
  const dupRows = (await all(db, `SELECT * FROM chapters WHERE id IN (${placeholders})`, ids)) as any[];
  const movedByChapter: Record<string, string[]> = {};
  for (const dupId of ids) {
    const qs = (await all(db, "SELECT id FROM questions WHERE chapter_id=?", [dupId])) as any[];
    movedByChapter[dupId] = qs.map((q: any) => String(q.id));
  }

  const before = (await all(
    db,
    `SELECT COUNT(*) AS n FROM questions WHERE chapter_id IN (${placeholders})`,
    ids
  )) as any[];
  const movedCount = Number(before?.[0]?.n ?? 0);
  await run(db, `UPDATE questions SET chapter_id=? WHERE chapter_id IN (${placeholders})`, [canonical_id, ...ids]);
  await run(db, `DELETE FROM chapters WHERE id IN (${placeholders})`, ids);

  const remaining = (await all(
    db,
    `SELECT COUNT(*) AS n FROM chapters WHERE id IN (${placeholders})`,
    ids
  )) as any[];
  const deleted = ids.length - Number(remaining?.[0]?.n ?? 0);

  // Record history (keep last 10 per subject).
  const historyId = uuid();
  const historyData = JSON.stringify({
    duplicates: dupRows.map((r: any) => ({
      id: r.id,
      subject_id: r.subject_id,
      number: r.number,
      title: r.title,
      title_bn: r.title_bn,
      summary: r.summary,
      created_at: r.created_at,
    })),
    movedByChapter,
  });
  await run(
    db,
    "INSERT INTO chapter_merge_history (id,subject_id,canonical_id,data,created_at) VALUES (?,?,?,?,?)",
    [historyId, req.params.subjectId, canonical_id, historyData, Date.now()]
  );
  // Prune older entries beyond the last 10 for this subject.
  const old = (await all(
    db,
    "SELECT id FROM chapter_merge_history WHERE subject_id=? ORDER BY created_at DESC",
    [req.params.subjectId]
  )) as any[];
  if (old.length > 10) {
    const toDelete = old.slice(10).map((r: any) => r.id);
    const ph = toDelete.map(() => "?").join(",");
    await run(db, `DELETE FROM chapter_merge_history WHERE id IN (${ph})`, toDelete);
  }

  res.json({ ok: true, merged: ids.length, moved_questions: movedCount, deleted, history_id: historyId });
});

router.post("/:subjectId/chapters", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { number, title, title_bn, summary } = req.body || {};
  if (!title) return res.status(400).json({ error: "Missing title" });
  const db = await getDb();
  const id = uuid();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, req.params.subjectId, number || 1, title, title_bn || null, summary || null, Date.now()]);
  res.json({ chapter: { id, title } });
});

router.put("/chapters/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { number, title, title_bn, summary } = req.body || {};
  const db = await getDb();
  await run(db, "UPDATE chapters SET number=COALESCE(?,number), title=COALESCE(?,title), title_bn=COALESCE(?,title_bn), summary=COALESCE(?,summary) WHERE id=?",
    [number, title, title_bn, summary, req.params.id]);
  res.json({ ok: true });
});

router.delete("/chapters/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  // Check if chapter exists
  const chapter = await get(db, "SELECT id FROM chapters WHERE id=?", [req.params.id]);
  if (!chapter) return res.status(404).json({ error: "Chapter not found" });
  // Delete chapter (questions referencing it will have chapter_id set to NULL)
  await run(db, "DELETE FROM chapters WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// List recent merge operations for a subject (newest first), for the undo UI.
router.get("/:subjectId/chapters/merges", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const rows = (await all(
    db,
    "SELECT id, canonical_id, data, created_at FROM chapter_merge_history WHERE subject_id=? ORDER BY created_at DESC LIMIT 10",
    [req.params.subjectId]
  )) as any[];
  const items = rows.map((r: any) => {
    let info: any = {};
    try { info = JSON.parse(r.data); } catch {}
    return {
      id: r.id,
      canonical_id: r.canonical_id,
      created_at: r.created_at,
      duplicate_count: Array.isArray(info.duplicates) ? info.duplicates.length : 0,
      titles: Array.isArray(info.duplicates) ? info.duplicates.map((d: any) => d.title) : [],
    };
  });
  res.json({ merges: items });
});

// Undo a previous merge: recreate the deleted chapters and move the questions
// back to their original chapters.
router.post("/:subjectId/chapters/merges/:historyId/undo", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const row = (await get(
    db,
    "SELECT * FROM chapter_merge_history WHERE id=? AND subject_id=?",
    [req.params.historyId, req.params.subjectId]
  )) as any;
  if (!row) return res.status(404).json({ error: "Merge history not found" });

  let info: any = {};
  try { info = JSON.parse(row.data); } catch { return res.status(400).json({ error: "Corrupt history" }); }

  const duplicates = Array.isArray(info.duplicates) ? info.duplicates : [];
  const movedByChapter = info.movedByChapter || {};

  // Recreate the deleted chapters (ignore if an id was reused).
  for (const d of duplicates) {
    const exists = await get(db, "SELECT id FROM chapters WHERE id=?", [d.id]);
    if (exists) continue;
    await run(
      db,
      "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
      [d.id, req.params.subjectId, d.number || 1, d.title, d.title_bn || null, d.summary || null, d.created_at || Date.now()]
    );
  }

  // Move questions back to their original chapters.
  for (const [chapterId, qids] of Object.entries(movedByChapter)) {
    if (!Array.isArray(qids) || qids.length === 0) continue;
    const ph = qids.map(() => "?").join(",");
    await run(db, `UPDATE questions SET chapter_id=? WHERE id IN (${ph})`, [chapterId, ...qids]);
  }

  await run(db, "DELETE FROM chapter_merge_history WHERE id=?", [req.params.historyId]);

  res.json({ ok: true, restored: duplicates.length });
});

export default router;