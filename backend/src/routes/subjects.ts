import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import { parseChapterHeading } from "../lib/chapter";

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

  // Renumber the canonical chapter to its heading number when it has a single
  // one; range/multi-chapter headings keep their existing number.
  const canonRow = await get(db, "SELECT title FROM chapters WHERE id=?", [canonical_id]);
  const canonNumber = parseChapterHeading(String(canonRow?.title || "")).number;
  if (canonNumber != null && canonNumber > 0) {
    await run(db, "UPDATE chapters SET number=? WHERE id=?", [canonNumber, canonical_id]);
  }

  res.json({ ok: true, merged: ids.length, moved_questions: movedCount, deleted, history_id: historyId });
});

router.post("/:subjectId/chapters", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { number, title, title_bn, summary } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Missing title" });
  const heading = parseChapterHeading(String(title));
  const headingBn = title_bn ? parseChapterHeading(String(title_bn)) : null;
  // The number in the title is the book's number and wins over the number the
  // form happened to send; a range heading has no single number, so keep that.
  const explicitNumber = Number.isFinite(Number(number)) && Number(number) > 0 ? Number(number) : 1;
  let chapterNumber = explicitNumber;
  if (heading.kind === "single" && heading.number != null) chapterNumber = heading.number;
  else if (heading.kind === "none" && headingBn?.number != null) chapterNumber = headingBn.number;
  const chapterTitle = heading.title;
  const chapterTitleBn = headingBn ? headingBn.title : null;
  const db = await getDb();
  const id = uuid();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
    [id, req.params.subjectId, chapterNumber, chapterTitle, chapterTitleBn, summary || null, Date.now()]);
  res.json({ chapter: { id, number: chapterNumber, title: chapterTitle } });
});

router.put("/chapters/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { number, title, title_bn, summary } = req.body || {};
  if (title !== undefined && !String(title).trim()) return res.status(400).json({ error: "Missing title" });
  const db = await getDb();
  const existing = await get(db, "SELECT number, title, title_bn FROM chapters WHERE id=?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Chapter not found" });

  let chapterNumber = Number.isFinite(Number(number)) && Number(number) > 0 ? Number(number) : Number(existing.number);
  let chapterTitle = existing.title;
  let chapterTitleBn = existing.title_bn;
  // Only a title with no heading of its own may take its number from title_bn;
  // a range title keeps the number it already has.
  let titleKind = parseChapterHeading(existing.title).kind;

  // Parse the heading(s) being written. The main title wins over title_bn, and
  // either wins over an explicit `number`, so the stored pair cannot drift apart.
  let titleNumber: number | null = null;
  let bnNumber: number | null = null;
  if (title !== undefined) {
    const heading = parseChapterHeading(String(title));
    chapterTitle = heading.title;
    titleNumber = heading.number;
    titleKind = heading.kind;
  }
  if (title_bn !== undefined) {
    if (title_bn) {
      const headingBn = parseChapterHeading(String(title_bn));
      chapterTitleBn = headingBn.title;
      bnNumber = headingBn.number;
    } else {
      chapterTitleBn = null;
    }
  }
  const parsedNumber = titleNumber ?? (titleKind === "none" ? bnNumber : null);
  if (parsedNumber != null && parsedNumber > 0) chapterNumber = parsedNumber;

  await run(db, "UPDATE chapters SET number=?, title=?, title_bn=?, summary=COALESCE(?,summary) WHERE id=?",
    [chapterNumber, chapterTitle, chapterTitleBn, summary, req.params.id]);
  res.json({ ok: true, chapter: { number: chapterNumber, title: chapterTitle } });
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

// Renumber every chapter in a subject from its heading and remove the number
// prefix from the stored title. Range/multi-chapter titles keep their existing
// number and stay untouched.
router.post("/:subjectId/chapters/renumber", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const chapters = (await all(db, "SELECT id, title, title_bn, number FROM chapters WHERE subject_id=?", [req.params.subjectId])) as any[];
  let updated = 0;
  for (const ch of chapters) {
    const fromTitle = parseChapterHeading(ch.title);
    const fromBn = ch.title_bn != null ? parseChapterHeading(ch.title_bn) : null;
    const number = fromTitle.kind === "single"
      ? fromTitle.number
      : fromTitle.kind === "none"
        ? (fromBn?.number ?? null)
        : null;
    const sets: string[] = [];
    const params: any[] = [];
    if (number != null && number !== Number(ch.number)) {
      sets.push("number=?");
      params.push(number);
    }
    if (fromTitle.title !== ch.title) {
      sets.push("title=?");
      params.push(fromTitle.title);
    }
    if (fromBn && fromBn.title !== ch.title_bn) {
      sets.push("title_bn=?");
      params.push(fromBn.title);
    }
    if (sets.length === 0) continue;
    params.push(ch.id);
    await run(db, `UPDATE chapters SET ${sets.join(", ")} WHERE id=?`, params);
    updated++;
  }
  res.json({ ok: true, updated });
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

  // Recreate the deleted chapters (ignore if an id was reused). Snapshots taken
  // before the v14 migration can still carry a heading prefix, so normalise them
  // on the way back in rather than restoring the old mismatch.
  for (const d of duplicates) {
    const exists = await get(db, "SELECT id FROM chapters WHERE id=?", [d.id]);
    if (exists) continue;
    const heading = parseChapterHeading(String(d.title || ""));
    const headingBn = d.title_bn ? parseChapterHeading(String(d.title_bn)) : null;
    const savedNumber = Number(d.number);
    const number = heading.kind === "single"
      ? heading.number
      : heading.kind === "none" && headingBn?.number != null
        ? headingBn.number
        : Number.isFinite(savedNumber) && savedNumber > 0 ? savedNumber : 1;
    const title = heading.title;
    const titleBn = d.title_bn ? (headingBn ? headingBn.title : d.title_bn) : null;
    await run(
      db,
      "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
      [d.id, req.params.subjectId, number, title, titleBn, d.summary || null, d.created_at || Date.now()]
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