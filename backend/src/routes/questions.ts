import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import { normalizeText } from "../lib/text";

const router = Router();

/**
 * Do two copies agree on the answer? Choices are compared only when both sides
 * actually carry them, so re-typing a question without its options yet does not
 * raise a false "answers differ" alarm.
 */
function sameAnswer(a: { answer?: unknown; options?: unknown }, b: { answer?: unknown; options?: unknown }): boolean {
  if (normalizeText(a.answer) !== normalizeText(b.answer)) return false;
  const aOptions = Array.isArray(a.options) ? a.options : null;
  const bOptions = Array.isArray(b.options) ? b.options : null;
  if (!aOptions || !bOptions) return true;
  return normalizeText(aOptions.join(" ")) === normalizeText(bOptions.join(" "));
}

const first = (v: any) => (Array.isArray(v) ? v[0] : v);

/** The options of a question, whether they arrive as JSON text or as a real array. */
function optionList(raw: unknown): string[] {
  let list: any = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.map((o) => String(o ?? "")) : [];
}

/**
 * Where does the key sit inside the option list? Resolving it on the server and
 * shipping the *index* means the browser never has to match the student's pick
 * against the answer text, so a difference in case, Bangla digits ("১.৫" vs
 * "1.5") or Unicode composition ("য়" vs "য" + nukta) can never mis-grade an
 * answer. The comparison uses the same normalisation as the duplicate scan.
 * Returns -1 when the key matches no option at all (broken data).
 */
function answerIndex(options: string[], answer: unknown): number {
  const key = normalizeText(answer);
  if (!key) return -1;
  return options.findIndex((o) => normalizeText(o) === key);
}

/**
 * A multi-value filter may arrive as a repeated query parameter, as an array
 * or as one comma-separated string. Normalise all three into a list of ids.
 */
function idList(v: any): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return [...new Set(arr.map((x) => String(x ?? "").trim()).filter(Boolean))];
}

/**
 * Group the bank by (subject, normalised prompt) and keep only the groups with
 * two or more copies. Feeds both the "Duplicates" panel and the warning shown
 * when a new question would repeat one that is already stored.
 */
async function duplicateGroups(db: any, filters: { subject_id?: any; chapter_id?: any; type?: any } = {}) {
  const subject_id = first(filters.subject_id);
  const chapter_id = first(filters.chapter_id);
  const type = first(filters.type);
  let sql = `SELECT q.id, q.subject_id, q.chapter_id, q.type, q.difficulty, q.prompt, q.options, q.answer, q.explanation, q.marks, q.created_at,
    s.name AS subject_name, c.number AS chapter_number, c.title AS chapter_title
    FROM questions q
    LEFT JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN chapters c ON c.id = q.chapter_id
    WHERE 1=1`;
  const params: any[] = [];
  if (subject_id) { sql += " AND q.subject_id=?"; params.push(subject_id); }
  if (chapter_id) { sql += " AND q.chapter_id=?"; params.push(chapter_id); }
  if (type) { sql += " AND q.type=?"; params.push(type); }
  sql += " ORDER BY q.created_at ASC";
  const rows = (await all(db, sql, params)) as any[];

  const buckets = new Map<string, any[]>();
  for (const row of rows) {
    const item = { ...row, options: row.options ? JSON.parse(row.options) : null };
    const key = `${row.subject_id}::${normalizeText(row.prompt)}`;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const groups = [...buckets.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      subject_id: items[0].subject_id,
      subject_name: items[0].subject_name,
      count: items.length,
      /** true when the copies disagree on the answer/choices — deleting needs a human eye */
      answerDiffers: !items.every((q) => sameAnswer(q, items[0])),
      items,
    }))
    .sort((a, b) => b.count - a.count || String(a.subject_name).localeCompare(String(b.subject_name)) || a.key.localeCompare(b.key));

  return { groups, scanned: rows.length, duplicates: groups.reduce((n, g) => n + g.count - 1, 0) };
}

router.get("/duplicates", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const { subject_id, chapter_id, type } = req.query as any;
  res.json(await duplicateGroups(db, { subject_id, chapter_id, type }));
});

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
  const rows = (await all(db, sql, params)).map((r: any) => ({
    ...r,
    options: r.options ? JSON.parse(r.options) : null,
  }));
  res.json({ questions: rows });
});

router.get("/", async (req: Request, res: Response) => {
  const db = await getDb();
  const { subject_id, subject_ids, chapter_id, type, difficulty, q, search, limit, offset, page, pageSize, answer_quality } = req.query as any;
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
  // Flag questions whose answer is a placeholder/OCR artifact (e.g. "পাঠ্যবইয়ের সুনির্দিষ্ট উত্তর")
  // instead of a real answer. Patterns are matched case-insensitively.
  const PLACEHOLDER_PATTERNS = ["পাঠ্যবই"];
  if (answer_quality === "placeholder") {
    sql += " AND (" + PLACEHOLDER_PATTERNS.map(() => "LOWER(answer) LIKE ?").join(" OR ") + ")";
    for (const p of PLACEHOLDER_PATTERNS) params.push(`%${p.toLowerCase()}%`);
  } else if (answer_quality === "real") {
    sql += " AND answer IS NOT NULL AND answer <> ''";
    for (const p of PLACEHOLDER_PATTERNS) sql += " AND LOWER(answer) NOT LIKE ?";
    for (const p of PLACEHOLDER_PATTERNS) params.push(`%${p.toLowerCase()}%`);
  }
  const term = (q || search || "").toString().trim();
  if (term) { sql += " AND (prompt LIKE ? OR answer LIKE ?)"; params.push(`%${term}%`, `%${term}%`); }

  // Total matching rows, for pagination controls.
  const countSql = sql.replace("SELECT * FROM questions", "SELECT COUNT(*) AS n FROM questions");
  const countRow = await get(db, countSql, params) as any;
  const total = Number(countRow?.n ?? 0);

  sql += " ORDER BY created_at DESC";
  const l = Math.max(0, parseInt(limit) || 0);
  const ps = Math.max(0, parseInt(pageSize) || 0);
  let o = Math.max(0, parseInt(offset) || 0);
  if (ps > 0 && page) o = Math.max(0, (parseInt(page) - 1) * ps);
  const useLimit = l > 0 ? l : ps;
  const rows = (await all(db, useLimit > 0 ? sql + " LIMIT ? OFFSET ?" : sql, useLimit > 0 ? [...params, useLimit, o] : params)).map((r: any) => ({
    ...r,
    options: r.options ? JSON.parse(r.options) : null,
    chapter_ids: undefined,
  }));
  res.json({ questions: rows, total });
});

// Standalone self-study: random MCQs from the bank, optionally narrowed to a
// subject, a chapter and a difficulty level. The answer key and the
// explanation ride along on purpose: the page scores the pick and explains it
// instantly, which is impossible without them. This is a practice round
// (nothing is saved, no mark book), so exposing them client-side is fine.
// Kept before "/:id" so "practice" is not mistaken for a question id.
router.get("/practice", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const subject_id = req.query.subject_id as string | undefined;
  const chapterIds = [...new Set([...idList(req.query.chapter_ids), ...idList(req.query.chapter_id)])];
  const difficulty = req.query.difficulty as string | undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

  let where = `q.type = 'mcq' AND q.options IS NOT NULL AND q.options <> '[]'`;
  const params: any[] = [];
  if (subject_id) { where += " AND q.subject_id = ?"; params.push(subject_id); }
  // Several chapters at once: pick any set of them, or none for "all chapters".
  if (chapterIds.length) {
    where += ` AND q.chapter_id IN (${chapterIds.map(() => "?").join(",")})`;
    params.push(...chapterIds);
  }
  if (difficulty && ["easy", "medium", "hard"].includes(difficulty)) {
    where += " AND q.difficulty = ?";
    params.push(difficulty);
  }

  // How many MCQs the filter matches in total. The client shows this so a
  // "round of 10" can never quietly turn into a round of 6.
  const counted = (await get(db, `SELECT COUNT(*) AS n FROM questions q WHERE ${where}`, params)) as any;
  const available = Number(counted?.n || 0);

  const rows = (await all(
    db,
    `SELECT q.id, q.subject_id, q.type, q.difficulty, q.prompt, q.options, q.answer,
       q.explanation, q.marks, q.chapter_id,
       s.name AS subject_name, c.number AS chapter_number, c.title AS chapter_title
     FROM questions q
     LEFT JOIN subjects s ON s.id = q.subject_id
     LEFT JOIN chapters c ON c.id = q.chapter_id
     WHERE ${where}
     ORDER BY RANDOM() LIMIT ?`,
    [...params, limit]
  )) as any[];

  res.json({
    questions: rows.map((q) => {
      const options = optionList(q.options);
      return { ...q, options, answer_index: answerIndex(options, q.answer) };
    }),
    available,
    returned: rows.length,
    subject_id: subject_id || null,
    chapter_ids: chapterIds,
    difficulty: difficulty || null,
    limit,
  });
});

/**
 * What the standalone practice setup screen offers: the subjects and chapters
 * that actually hold MCQs (with counts, so a subject with no MCQs is never
 * offered as if it had some), plus how many questions each difficulty level
 * holds under the currently selected subject and chapter.
 */
router.get("/practice/filters", requireAuth, async (req: Request, res: Response) => {
  const db = await getDb();
  const subject_id = req.query.subject_id as string | undefined;
  const chapterIds = [...new Set([...idList(req.query.chapter_ids), ...idList(req.query.chapter_id)])];
  const MCQ = "q.type='mcq' AND q.options IS NOT NULL AND q.options <> '[]'";

  const subjects = (await all(
    db,
    `SELECT s.id, s.name, COUNT(q.id) AS mcq_count
     FROM subjects s LEFT JOIN questions q ON q.subject_id = s.id AND ${MCQ}
     GROUP BY s.id ORDER BY mcq_count DESC, s.name ASC`
  )) as any[];

  // The chapters of the chosen subject (all of them when nothing is chosen yet).
  // The subject name comes along so the chips can say which book a chapter
  // belongs to when no single subject has been picked.
  let chapterSql = `SELECT c.id, c.subject_id, c.number, c.title, s.name AS subject_name, COUNT(q.id) AS mcq_count
     FROM chapters c LEFT JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN questions q ON q.chapter_id = c.id AND ${MCQ}`;
  const chapterParams: any[] = [];
  if (subject_id) { chapterSql += " WHERE c.subject_id = ?"; chapterParams.push(subject_id); }
  chapterSql += " GROUP BY c.id ORDER BY c.number ASC";
  const chapters = (await all(db, chapterSql, chapterParams)) as any[];

  let scoped = `q.type='mcq' AND q.options IS NOT NULL AND q.options <> '[]'`;
  const scopedParams: any[] = [];
  if (subject_id) { scoped += " AND q.subject_id = ?"; scopedParams.push(subject_id); }
  // Same multi-chapter rule as the round itself, so the counts the student
  // sees match the questions the round will actually contain.
  if (chapterIds.length) {
    scoped += ` AND q.chapter_id IN (${chapterIds.map(() => "?").join(",")})`;
    scopedParams.push(...chapterIds);
  }

  const difficulties = (await all(
    db,
    `SELECT q.difficulty, COUNT(*) AS n FROM questions q WHERE ${scoped} GROUP BY q.difficulty`,
    scopedParams
  )) as any[];

  const totalRow = (await get(db, `SELECT COUNT(*) AS n FROM questions q WHERE ${scoped}`, scopedParams)) as any;

  res.json({
    subjects,
    chapters,
    difficulties,
    total: Number(totalRow?.n || 0),
  });
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const r = await get(db, "SELECT * FROM questions WHERE id=?", [req.params.id]) as any;
  if (!r) return res.status(404).json({ error: "Not found" });
  r.options = r.options ? JSON.parse(r.options) : null;
  res.json({ question: r });
});

router.post("/", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { subject_id, chapter_id, type, difficulty, prompt, options, answer, explanation, marks, force } = req.body || {};
  if (!subject_id || !type || !prompt) return res.status(400).json({ error: "Missing fields" });
  const db = await getDb();
  // A second copy of a question is nearly always a slip, so the first attempt
  // comes back as 409 listing the copies already stored; the client resends with
  // force:true after the teacher has seen them.
  if (force !== true) {
    const existing = (await all(db, "SELECT id, chapter_id, type, difficulty, prompt, options, answer, created_at FROM questions WHERE subject_id=?", [subject_id])) as any[];
    const wanted = normalizeText(prompt);
    const copies = existing.filter((q) => normalizeText(q.prompt) === wanted);
    if (copies.length > 0) {
      return res.status(409).json({
        error: "duplicate",
        message: "An identical question is already in this subject.",
        answerDiffers: copies.some((q) => !sameAnswer(q, { answer, options })),
        duplicates: copies.map((q) => ({ ...q, options: q.options ? JSON.parse(q.options) : null })),
      });
    }
  }
  const pageRaw = (req.body as any)?.page ?? (req.body as any)?.page_number ?? (req.body as any)?.book_page ?? (req.body as any)?.pageNo ?? (req.body as any)?.page_no ?? null;
  let pageVal: string | null = null;
  let pageNum: number | null = null;
  if (pageRaw !== null && pageRaw !== undefined) {
    const s = String(pageRaw).trim();
    pageVal = s === "" ? null : s;
    const n = Number(pageRaw);
    if (Number.isFinite(n) && n > 0) pageNum = Math.floor(n);
  }
  const id = uuid();
  await run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,page,page_number,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, subject_id, chapter_id || null, type, difficulty || "medium", prompt,
      options ? JSON.stringify(options) : null, answer || null, explanation || null, marks || 1,
      pageVal, pageNum,
      req.user!.id, Date.now()]);
  res.json({ question: { id } });
});

router.post("/bulk-delete", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids[] required" });
  const db = await getDb();
  const placeholders = ids.map(() => "?").join(",");
  await run(db, `DELETE FROM questions WHERE id IN (${placeholders})`, ids);
  await pruneQuestionsFromExams(db, ids);
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
  await run(db, `UPDATE questions SET ${setClause} WHERE id IN (${placeholders})`, [...keys.map((k) => allowed[k]), ...ids]);
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

  const findSubjectId = async (id?: string | null, slug?: string | null): Promise<string | null> => {
    if (id) { const s = await get(db, "SELECT id FROM subjects WHERE id=?", [id]) as any; if (s) return s.id; }
    if (slug) { const s = await get(db, "SELECT id FROM subjects WHERE slug=?", [slug]) as any; if (s) return s.id; }
    return null;
  };

  // Resolve a chapter: by id, by number, or by title (case-insensitive). If a
  // title is given but no such chapter exists yet, create it as the next number.
  const resolveChapterId = async (
    subjectId: string,
    o: { chapter_id?: any; chapter_number?: any; chapter_title?: string }
  ): Promise<string | null> => {
    if (o.chapter_id) {
      const c = await get(db, "SELECT id FROM chapters WHERE id=? AND subject_id=?", [o.chapter_id, subjectId]) as any;
      if (c) return c.id;
    }
    if (o.chapter_number != null && o.chapter_number !== "") {
      const c = await get(db, "SELECT id FROM chapters WHERE subject_id=? AND number=?", [subjectId, Number(o.chapter_number)]) as any;
      if (c) return c.id;
    }
    const title = (o.chapter_title || "").trim();
    if (title) {
      let c = await get(db, "SELECT id FROM chapters WHERE subject_id=? AND (title=? COLLATE NOCASE OR title_bn=? COLLATE NOCASE)", [subjectId, title, title]) as any;
      if (!c) {
        const mx = await get(db, "SELECT MAX(number) as m FROM chapters WHERE subject_id=?", [subjectId]) as any;
        const number = (mx && mx.m ? Number(mx.m) : 0) + 1;
        const cid = uuid();
        await run(db, "INSERT INTO chapters (id,subject_id,number,title,title_bn,summary,created_at) VALUES (?,?,?,?,?,?,?)",
          [cid, subjectId, number, title, title, null, Date.now()]);
        c = { id: cid };
      }
      return c.id;
    }
    return null;
  };

  const defaultSubjectId = await findSubjectId(topSubjectId, topSubjectSlug);
  const defaultChapterCache = new Map<string, string | null>();
  const skipDuplicates = body.skip_duplicates !== false; // default: on
  // Normalised prompts already in the bank — one lookup per subject, extended as
  // rows land so a file that repeats itself is caught too.
  const knownPrompts = new Map<string, Set<string>>();
  const promptsFor = async (subjectId: string) => {
    let set = knownPrompts.get(subjectId);
    if (!set) {
      const rows = (await all(db, "SELECT prompt FROM questions WHERE subject_id=?", [subjectId])) as any[];
      set = new Set(rows.map((r) => normalizeText(r.prompt)));
      knownPrompts.set(subjectId, set);
    }
    return set;
  };
  let imported = 0;
  let skipped = 0;
  const duplicateRows: number[] = [];
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < questions.length; i++) {
    const row = questions[i] || {};
    try {
      // resolve subject (row-level wins, else top-level default)
      const subject_id = (await findSubjectId(row.subject_id, row.subject_slug)) || defaultSubjectId;
      if (!subject_id) throw new Error("subject_id or valid subject_slug required");
      const type = String(row.type || "mcq").toLowerCase();
      if (!VALID_TYPES.has(type)) throw new Error("invalid type");
      const prompt = String(row.prompt || "").trim();
      if (!prompt) throw new Error("prompt required");
      // Skip rows whose question already exists in this subject (prevents double imports)
      const promptKey = normalizeText(prompt);
      if (skipDuplicates && (await promptsFor(subject_id)).has(promptKey)) {
        skipped++;
        duplicateRows.push(i);
        continue;
      }
      // resolve chapter (row-level wins, else top-level default; title may auto-create)
      const rowChapterTitle = row.chapter_title != null ? String(row.chapter_title) : undefined;
      const hasRowChapter = !!(row.chapter_id || (row.chapter_number != null && row.chapter_number !== "") || (rowChapterTitle && rowChapterTitle.trim()));
      let chapter_id: string | null;
      if (hasRowChapter) {
        chapter_id = await resolveChapterId(subject_id, { chapter_id: row.chapter_id, chapter_number: row.chapter_number, chapter_title: rowChapterTitle });
      } else if (topChapterTitle || (topChapterNumber != null && topChapterNumber !== "")) {
        if (defaultChapterCache.has(subject_id)) chapter_id = defaultChapterCache.get(subject_id) ?? null;
        else { chapter_id = await resolveChapterId(subject_id, { chapter_number: topChapterNumber, chapter_title: topChapterTitle }); defaultChapterCache.set(subject_id, chapter_id); }
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
      // Book/source page ref — keep both numeric and text forms
      const pageRaw = row.page ?? row.page_number ?? row.book_page ?? row.pageNo ?? row.page_no ?? null;
      let pageVal: string | null = null;
      let pageNum: number | null = null;
      if (pageRaw !== null && pageRaw !== undefined) {
        const s = String(pageRaw).trim();
        pageVal = s === "" ? null : s;
        const n = Number(pageRaw);
        if (Number.isFinite(n) && n > 0) pageNum = Math.floor(n);
      }
      const id = uuid();
      await run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,page,page_number,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, subject_id, chapter_id, type, difficulty, prompt,
          options ? JSON.stringify(options) : null, row.answer != null ? String(row.answer) : null,
          row.explanation != null ? String(row.explanation) : null, marks, pageVal, pageNum, req.user!.id, Date.now()]);
      if (skipDuplicates) (await promptsFor(subject_id)).add(promptKey);
      imported++;
    } catch (e: any) {
      errors.push({ index: i, error: e?.message || "Invalid row" });
    }
  }
  res.json({ ok: true, imported, skipped, failed: errors.length, errors, duplicateRows });
});

router.post("/:id/duplicate", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  const src = await get(db, "SELECT * FROM questions WHERE id=?", [req.params.id]) as any;
  if (!src) return res.status(404).json({ error: "Not found" });
  const id = uuid();
  await run(db, `INSERT INTO questions (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,page,page_number,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, src.subject_id, src.chapter_id, src.type, src.difficulty, src.prompt, src.options, src.answer, src.explanation, src.marks, src.page ?? null, src.page_number ?? null, req.user!.id, Date.now()]);
  res.json({ question: { id } });
});
router.put("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const body: any = req.body || {};
  const { subject_id, chapter_id, type, difficulty, prompt, options, answer, explanation, marks } = body;
  // Was a page sent at all? The form always sends one, but other clients may
  // omit it — in that case leave any stored page untouched instead of clearing
  // it. Must be decided before `??` coerces absent keys to null.
  const hasPage = ["page", "page_number", "book_page", "pageNo", "page_no"].some((k) => k in body);
  const pageRaw = hasPage ? (body.page ?? body.page_number ?? body.book_page ?? body.pageNo ?? body.page_no ?? null) : null;
  let pageVal: string | null = null;
  let pageNum: number | null = null;
  if (pageRaw !== null && pageRaw !== undefined) {
    const s = String(pageRaw).trim();
    pageVal = s === "" ? null : s;
    const n = Number(pageRaw);
    if (Number.isFinite(n) && n > 0) pageNum = Math.floor(n);
  }
  const db = await getDb();
  if (hasPage) {
    await run(db, `UPDATE questions SET
      subject_id=COALESCE(?,subject_id), chapter_id=COALESCE(?,chapter_id), type=COALESCE(?,type),
      difficulty=COALESCE(?,difficulty), prompt=COALESCE(?,prompt),
      options=?, answer=COALESCE(?,answer), explanation=COALESCE(?,explanation), marks=COALESCE(?,marks),
      page=?, page_number=?
      WHERE id=?`,
      [subject_id, chapter_id, type, difficulty, prompt,
        options ? JSON.stringify(options) : null, answer, explanation, marks, pageVal, pageNum, req.params.id]);
  } else {
    await run(db, `UPDATE questions SET
      subject_id=COALESCE(?,subject_id), chapter_id=COALESCE(?,chapter_id), type=COALESCE(?,type),
      difficulty=COALESCE(?,difficulty), prompt=COALESCE(?,prompt),
      options=?, answer=COALESCE(?,answer), explanation=COALESCE(?,explanation), marks=COALESCE(?,marks)
      WHERE id=?`,
      [subject_id, chapter_id, type, difficulty, prompt,
        options ? JSON.stringify(options) : null, answer, explanation, marks, req.params.id]);
  }
  res.json({ ok: true });
});

/** When questions are deleted, drop their ids from every exam's question_ids
 *  list and recompute total_marks (unpublishing an exam that ends up empty)
 *  so students never start a paper full of missing questions. */
async function pruneQuestionsFromExams(db: any, deletedIds: string[]) {
  if (!deletedIds.length) return;
  const deleted = new Set(deletedIds);
  const exams = (await all(db, "SELECT id, question_ids, is_published FROM exams", [])) as any[];
  for (const e of exams) {
    let qids: string[];
    try { qids = JSON.parse(e.question_ids); } catch { continue; }
    if (!Array.isArray(qids)) continue;
    const remaining = qids.filter((id) => !deleted.has(id));
    if (remaining.length === qids.length) continue;
    if (remaining.length === 0) {
      await run(db, "UPDATE exams SET question_ids=?, total_marks=0, is_published=0 WHERE id=?", [JSON.stringify([]), e.id]);
    } else {
      const qs = (await all(db, `SELECT marks FROM questions WHERE id IN (${remaining.map(() => "?").join(",")})`, remaining)) as any[];
      const total = qs.reduce((s, q) => s + (q.marks || 1), 0);
      await run(db, "UPDATE exams SET question_ids=?, total_marks=? WHERE id=?", [JSON.stringify(remaining), total, e.id]);
    }
  }
}

router.delete("/:id", requireAuth, requireRole("admin", "teacher"), async (req: Request, res: Response) => {
  const db = await getDb();
  await run(db, "DELETE FROM questions WHERE id=?", [req.params.id]);
  await pruneQuestionsFromExams(db, [req.params.id as string]);
  res.json({ ok: true });
});

export default router;