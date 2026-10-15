import { Router, Request, Response } from "express";
import { v4 as uuid } from "uuid";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.get("/export", async (req: Request, res: Response) => {
  const db = await getDb();
  const { subject_id, chapter_id, type, difficulty, q } = req.query as any;
  let sql = "SELECT q.*, s.slug as subject_slug, s.name as subject_name, c.number as chapter_number, c.title as chapter_title FROM questions q LEFT JOIN subjects s ON s.id=q.subject_id LEFT JOIN chapters c ON c.id=q.chapter_id WHERE 1=1";
  const params: any[] = [];
  if (subject_id) { sql += " AND q.subject_id=?"; params.push(subject_id); }
  if (chapter_id) { sql += " AND q.chapter_id=?"; params.push(chapter_id); }
  if (type) { sql += " AND q.type=?"; params.push(type); }
  if (difficulty) { sql += " AND q.difficulty=?"; params.push(difficulty); }
  if (q) { sql += " AND (q.prompt LIKE ? OR q.answer LIKE ?)"; params.push(`%${q}%`, `%${q}%`); }
  sql += " ORDER BY q.created_at DESC";
  const rows = all(db, sql, params).map((r: any) => ({
    ...r,
    options: r.options ? JSON.parse(r.options) : null,
  }));
  res.json({ questions: rows });
});

router.get("/", async (req: Request, res: Response) => {
  const db = await getDb();
  const { subject_id, subject_ids, chapter_id, type, difficulty, q, search, limit, offset, page, pageSize } = req.query as any;
  let sql = "SELECT * FROM questions WHERE 1=1";
  const params: any[] = [];
  if (subject_ids) {
    const arr = Array.isArray(subject_ids) ? subject_ids : subject_ids.toString().split(",");
    const ids = arr.filter(Boolean);
    if (ids.length > 0) {
      sql += ` AND subject_id IN (${ids.map(() => "?").join(",")})`;
      params.push(...ids);
    }
  } else if (subject_id) {
    const s = Array.isArray(subject_id) ? subject_id[0] : subject_id;
    if (s) { sql += " AND subject_id=?"; params.push(s); }
  }
  if (chapter_id) {
    const c = Array.isArray(chapter_id) ? chapter_id[0] : chapter_id;
    sql += " AND chapter_id=?"; params.push(c);
  }
  if (type) { sql += " AND type=?"; params.push(type); }
  if (difficulty) { sql += " AND difficulty=?"; params.push(difficulty); }
  const term = (q || search || "").toString().trim();
  if (term) { sql += " AND (prompt LIKE ? OR answer LIKE ?)"; params.push(`%${term}%`, `%${term}%`); }
  sql += " ORDER BY created_at DESC";
  const l = Math.max(0, parseInt(limit) || 0);
  const ps = Math.max(0, parseInt(pageSize) || 0);
  let o = Math.max(0, parseInt(offset) || 0);
  if (ps > 0 && page) o = Math.max(0, (parseInt(page) - 1) * ps);
  const useLimit = l > 0 ? l : ps;
  const rows = all(db, useLimit > 0 ? sql + " LIMIT ? OFFSET ?" : sql, useLimit > 0 ? [...params, useLimit, o] : params).map((r: any) => ({
    ...r,
    options: r.options ? JSON.parse(r.options) : null,
    chapter_ids: undefined,
  }));
  res.json({ questions: rows });
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const r = get(db, "SELECT * FROM questions WHERE id=?", [req.params.id]) as any;
  if (!r) return res.status(404).json({ error: "Not found" });
  r.options = r.options ? JSON.parse(r.options) : null;
  res.json({ question: r });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { subject_id, chapter_id, type, difficulty, prompt, options, answer, explanation, marks } = req.body || {};
  if (!subject_id || !type || !prompt) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  const id = uuid();
  run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, subject_id, chapter_id || null, type, difficulty || "medium", prompt,
      options ? JSON.stringify(options) : null, answer || null, explanation || null, marks || 1,
      req.user!.id, Date.now()]);
  res.json({ question: { id } });
});

router.post("/bulk-delete", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids[] required" });
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  run(db, `DELETE FROM questions WHERE id IN (${placeholders})`, ids);
  res.json({ ok: true, deleted: ids.length });
});

router.post("/bulk-update", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { ids, patch } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids[] required" });
  const allowed: Record<string, any> = {};
  if (patch?.difficulty && ["easy", "medium", "hard"].includes(patch.difficulty)) allowed.difficulty = patch.difficulty;
  if (patch?.marks != null && Number.isFinite(Number(patch.marks))) allowed.marks = Number(patch.marks);
  if (patch?.chapter_id !== undefined) allowed.chapter_id = patch.chapter_id || null;
  if (patch?.type && ["mcq", "short", "long"].includes(patch.type)) allowed.type = patch.type;
  const keys = Object.keys(allowed);
  if (keys.length === 0) return res.status(400).json({ error: "Nothing to update" });
  const db = await getDb();
  const setClause = keys.map((k) => `${k}=?`).join(", ");
  const placeholders = ids.map(() => "?").join(",");
  run(db, `UPDATE questions SET ${setClause} WHERE id IN (${placeholders})`, [...keys.map((k) => allowed[k]), ...ids]);
  res.json({ ok: true, updated: ids.length });
});

const VALID_TYPES = new Set(["mcq", "short", "long"]);
const VALID_DIFF = new Set(["easy", "medium", "hard"]);

router.post("/bulk-import", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const body = req.body || {};
  const { questions } = body;
  if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ error: "questions[] required" });
  if (questions.length > 500) return res.status(400).json({ error: "Max 500 questions per import" });
  const db = await getDb();

  // Some exported files put subject/chapter once at the top level instead of on
  // every question. Support both shapes; row-level values still win.
  const topSubjectId: string | null = body.subject_id || null;
  const topSubjectSlug: string | null = body.subject_slug || null;
  const topChapterTitle: string = body.chapter_title != null ? String(body.chapter_title).trim() : "";
  const topChapterNumber = body.chapter_number;

  const findSubjectId = (id?: string | null, slug?: string | null): string | null => {
    if (id) { const s = get(db, "SELECT id FROM subjects WHERE id=?", [id]) as any; if (s) return s.id; }
    if (slug) { const s = get(db, "SELECT id FROM subjects WHERE slug=?", [slug]) as any; if (s) return s.id; }
    return null;
  };

  // Resolve a chapter: by id, by number, or by title (case-insensitive). If a
  // title is given but no such chapter exists yet, create it as the next number.
  const resolveChapterId = (
    subjectId: string,
    o: { chapter_id?: any; chapter_number?: any; chapter_title?: string }
  ): string | null => {
    if (o.chapter_id) {
      const c = get(db, "SELECT id FROM chapters WHERE id=? AND subject_id=?", [o.chapter_id, subjectId]) as any;
      if (c) return c.id;
    }
    if (o.chapter_number != null && o.chapter_number !== "") {
      const c = get(db, "SELECT id FROM chapters WHERE subject_id=? AND number=?", [subjectId, Number(o.chapter_number)]) as any;
      if (c) return c.id;
    }
    const title = (o.chapter_title || "").trim();
    if (title) {
      let c = get(db, "SELECT id FROM chapters WHERE subject_id=? AND (title=? COLLATE NOCASE OR title_bn=? COLLATE NOCASE)", [subjectId, title, title]) as any;
      if (!c) {
        const mx = get(db, "SELECT MAX(number) as m FROM chapters WHERE subject_id=?", [subjectId]) as any;
        const number = (mx && mx.m ? Number(mx.m) : 0) + 1;
        const cid = uuid();
        run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
          [cid, subjectId, number, title, title, null, Date.now()]);
        c = { id: cid };
      }
      return c.id;
    }
    return null;
  };

  const defaultSubjectId = findSubjectId(topSubjectId, topSubjectSlug);
  const defaultChapterCache = new Map<string, string | null>();
  const skipDuplicates = body.skip_duplicates !== false; // default: on
  let imported = 0;
  let skipped = 0;
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < questions.length; i++) {
    const row = questions[i] || {};
    try {
      // resolve subject (row-level wins, else top-level default)
      const subject_id = findSubjectId(row.subject_id, row.subject_slug) || defaultSubjectId;
      if (!subject_id) throw new Error("subject_id or valid subject_slug required");
      const type = String(row.type || "mcq").toLowerCase();
      if (!VALID_TYPES.has(type)) throw new Error("invalid type");
      const prompt = String(row.prompt || "").trim();
      if (!prompt) throw new Error("prompt required");
      // Skip rows whose question already exists in this subject (prevents double imports)
      if (skipDuplicates) {
        const dup = get(db, "SELECT id FROM questions WHERE subject_id=? AND prompt=?", [subject_id, prompt]) as any;
        if (dup) { skipped++; continue; }
      }
      // resolve chapter (row-level wins, else top-level default; title may auto-create)
      const rowChapterTitle = row.chapter_title != null ? String(row.chapter_title) : undefined;
      const hasRowChapter = !!(row.chapter_id || (row.chapter_number != null && row.chapter_number !== "") || (rowChapterTitle && rowChapterTitle.trim()));
      let chapter_id: string | null;
      if (hasRowChapter) {
        chapter_id = resolveChapterId(subject_id, { chapter_id: row.chapter_id, chapter_number: row.chapter_number, chapter_title: rowChapterTitle });
      } else if (topChapterTitle || (topChapterNumber != null && topChapterNumber !== "")) {
        if (defaultChapterCache.has(subject_id)) chapter_id = defaultChapterCache.get(subject_id) ?? null;
        else { chapter_id = resolveChapterId(subject_id, { chapter_number: topChapterNumber, chapter_title: topChapterTitle }); defaultChapterCache.set(subject_id, chapter_id); }
      } else {
        chapter_id = null;
      }
      // options
      let options: string[] | null = null;
      if (type === "mcq") {
        if (Array.isArray(row.options)) options = row.options.map((o: any) => String(o)).filter((o: string) => o.trim() !== "");
        else if (typeof row.options === "string" && row.options.trim() !== "") options = row.options.split("|").map((o: string) => o.trim()).filter(Boolean);
        if (!options || options.length < 2) throw new Error("mcq needs at least 2 options");
      }
      const difficulty = VALID_DIFF.has(row.difficulty) ? row.difficulty : "medium";
      const marks = row.marks != null && Number.isFinite(Number(row.marks)) && Number(row.marks) > 0 ? Number(row.marks) : 1;
      const id = uuid();
      run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, subject_id, chapter_id, type, difficulty, prompt,
          options ? JSON.stringify(options) : null, row.answer != null ? String(row.answer) : null,
          row.explanation != null ? String(row.explanation) : null, marks, req.user!.id, Date.now()]);
      imported++;
    } catch (e: any) {
      errors.push({ index: i, error: e?.message || "Invalid row" });
    }
  }
  res.json({ ok: true, imported, skipped, failed: errors.length, errors });
});

router.post("/:id/duplicate", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const src = get(db, "SELECT * FROM questions WHERE id=?", [req.params.id]) as any;
  if (!src) return res.status(404).json({ error: "Not found" });
  const id = uuid();
  run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, src.subject_id, src.chapter_id, src.type, src.difficulty, src.prompt, src.options, src.answer, src.explanation, src.marks, req.user!.id, Date.now()]);
  res.json({ question: { id } });
});
router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { subject_id, chapter_id, type, difficulty, prompt, options, answer, explanation, marks } = req.body || {};
  const db = await getDb();
  run(db, `UPDATE questions SET
    subject_id=COALESCE(?,subject_id), chapter_id=COALESCE(?,chapter_id), type=COALESCE(?,type),
    difficulty=COALESCE(?,difficulty), prompt=COALESCE(?,prompt),
    options=?, answer=COALESCE(?,answer), explanation=COALESCE(?,explanation), marks=COALESCE(?,marks)
    WHERE id=?`,
    [subject_id, chapter_id, type, difficulty, prompt,
      options ? JSON.stringify(options) : null, answer, explanation, marks, req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  run(db, "DELETE FROM questions WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

export default router;