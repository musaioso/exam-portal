import { Router, Request, Response } from "express";
import { randomUUID as uuid } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { getDb, get, all, run } from "../db/database";
import {
  getProviderConfig,
  providerSummaries,
  keyStatuses,
  providerKeyMeta,
  validateProviderKey,
} from "../services/ai/providers";
import { setStoredKey, deleteStoredKey } from "../services/ai/keystore";
import { listModels, invalidateModels } from "../services/ai/models";
import { generateQuestions, flagAgainstBank } from "../services/ai/prompt";
import { visionCapableProviders } from "../services/ai/vision";
import { AIError } from "../services/ai/types";
import { normalizeText } from "../lib/text";

/**
 * The AI gateway surface, teacher/admin only:
 *
 *   GET    /api/ai/models           live model catalog per configured provider
 *   GET    /api/ai/keys             key-manager status per provider (masked)
 *   POST   /api/ai/keys             validate + store a provider API key
 *   DELETE /api/ai/keys/:provider   remove a UI-stored key
 *   GET    /api/ai/history          recent generation runs (stats, not content)
 *   POST   /api/ai/generate         source text → validated questions for review
 *   POST   /api/ai/check-duplicates re-flag edited prompts during review
 *
 * Nothing here writes questions. Saving goes through the existing
 * /api/questions/bulk-import, whose skip_duplicates pass is the final,
 * authoritative duplicate gate.
 */

const router = Router();

router.use(requireAuth, requireRole("admin", "teacher"));

router.get("/models", async (req: Request, res: Response) => {
  const providers = await listModels({ refresh: req.query.refresh === "1" });
  // Optional seed for the UI's model picker (AI_DEFAULT_MODEL). It is only a
  // default — every provider's full list is still offered, and the pick is
  // ignored when the model is absent or cannot be called from a server.
  res.json({ providers, defaultModel: process.env.AI_DEFAULT_MODEL || null });
});

/**
 * GET /api/ai/vision — which enabled providers can read page images, and with
 * which models. Drives the "read with AI" control on the source uploader; a
 * provider appears here only when a key is configured AND it lists at least
 * one vision-capable model.
 */
router.get("/vision", async (_req: Request, res: Response) => {
  res.json({ providers: await visionCapableProviders() });
});

/* ------------------------------------------------------------- key manager */

/** Masked status for every provider — the raw key never leaves the server. */
router.get("/keys", async (_req: Request, res: Response) => {
  res.json({ keys: await keyStatuses() });
});

const keySchema = z.object({
  provider: z.string().min(1),
  key: z.string().min(1, "Enter an API key").max(512, "That key looks too long"),
  /** Store even though the vendor's /models check failed. */
  force: z.boolean().optional(),
});

/**
 * Validate a pasted key against the vendor's own /models endpoint and store
 * it in the database (app_meta) when it checks out. A rejected key can still
 * be stored with force:true — some vendors gate /models while chat works —
 * and the UI asks for explicit confirmation first.
 */
router.post("/keys", async (req: Request, res: Response) => {
  const parsed = keySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  }
  const meta = providerKeyMeta(parsed.data.provider);
  if (!meta) return res.status(400).json({ error: "Unknown provider." });
  if (meta.keyless) {
    return res.status(400).json({ error: `${meta.label} does not use an API key — set its host environment variable instead.` });
  }

  const key = parsed.data.key.trim();
  const check = await validateProviderKey(meta.id, key);
  if (!check.ok && !parsed.data.force) {
    // 409 = "we did not store anything; confirm to save anyway".
    return res.status(409).json({ error: check.message, needsConfirm: true });
  }

  await setStoredKey(meta.id, key);
  invalidateModels(meta.id);
  res.json({
    ok: true,
    source: "stored",
    ...(check.ok ? { models: check.models } : { warning: check.message }),
  });
});

/** Removes a UI-stored key. Env-sourced keys must be removed from the server env. */
router.delete("/keys/:provider", async (req: Request, res: Response) => {
  const providerId = String(req.params.provider || "");
  const meta = providerKeyMeta(providerId);
  if (!meta) return res.status(400).json({ error: "Unknown provider." });
  const status = (await keyStatuses()).find((k) => k.id === meta.id);
  if (status?.source === "env") {
    return res.status(400).json({
      error: `The ${meta.label} key comes from the server environment (${status.envVar}) — remove it there.`,
    });
  }
  await deleteStoredKey(meta.id);
  invalidateModels(meta.id);
  res.json({ ok: true });
});

/** Recent runs — counts and timing only; question text is never stored here. */
router.get("/history", async (_req: Request, res: Response) => {
  const db = await getDb();
  const rows = (await all(
    db,
    `SELECT g.id, g.provider, g.model, g.source, g.requested, g.produced, g.duplicates,
            g.invalid, g.duration_ms, g.created_at, g.created_by, s.name AS subject_name
     FROM ai_generations g LEFT JOIN subjects s ON s.id = g.subject_id
     ORDER BY g.created_at DESC LIMIT 30`
  )) as any[];
  res.json({ history: rows });
});

const generateSchema = z.object({
  provider: z.string().min(1, "provider required"),
  model: z.string().min(1, "model required"),
  subject_id: z.string().optional(),
  chapter_id: z.string().optional(),
  /** Preferred: several sources at once (PDFs + images side by side). */
  documentIds: z.array(z.string().min(1)).max(20).optional(),
  /** Single-document alias kept for older clients/tests. */
  documentId: z.string().optional(),
  pageFrom: z.coerce.number().int().min(1).optional(),
  pageTo: z.coerce.number().int().min(1).optional(),
  text: z.string().optional(),
  count: z.coerce.number().int().min(1).max(50).default(10),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  types: z.array(z.enum(["mcq", "short", "long"])).min(1).max(3).default(["mcq"]),
  language: z.enum(["auto", "english", "bangla"]).default("auto"),
});

/**
 * Resolve the source text: one or more uploaded documents (PDFs/images —
 * already OCR'd at upload time) and/or pasted text.
 *
 * A page range only applies when exactly one document is selected — with a
 * mixed batch ("chapter 3 PDF + these two page photos") a global range makes
 * no sense, so the whole of each selected source is used.
 */
async function resolveSource(input: z.infer<typeof generateSchema>): Promise<{ text?: string; error?: string }> {
  const ids = input.documentIds?.length ? input.documentIds : input.documentId ? [input.documentId] : [];
  if (ids.length > 0) {
    const db = await getDb();
    const parts: string[] = [];
    const single = ids.length === 1;
    for (const id of ids) {
      const doc = (await get(db, "SELECT id,name,pages,content FROM ai_documents WHERE id=?", [id])) as any;
      if (!doc) return { error: "One of the selected source documents no longer exists — refresh the source list." };
      let pages: string[];
      try {
        pages = JSON.parse(doc.content);
        if (!Array.isArray(pages)) throw new Error();
      } catch {
        return { error: `The stored text of "${doc.name}" is unreadable — upload it again.` };
      }
      if (single) {
        const from = Math.min(input.pageFrom ?? 1, pages.length);
        const to = Math.min(input.pageTo ?? pages.length, pages.length);
        if (input.pageFrom && input.pageFrom > pages.length) return { error: `The document only has ${pages.length} pages.` };
        if (from > to) return { error: "pageFrom must not be greater than pageTo." };
        const sliced = pages.slice(from - 1, to).join("\n\n");
        if (!sliced.trim()) return { error: "No text found on the selected pages." };
        parts.push(sliced);
      } else {
        const joined = pages.join("\n\n");
        if (joined.trim()) parts.push(joined);
      }
    }
    const text = parts.join("\n\n");
    if (!text.trim()) return { error: "No text found in the selected sources." };
    return { text };
  }
  const text = (input.text || "").trim();
  if (!text) return { error: "Provide source text or pick an uploaded document." };
  return { text };
}

router.post("/generate", async (req: Request, res: Response) => {
  const parsed = generateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  }
  const input = parsed.data;

  const source = await resolveSource(input);
  if (source.error) return res.status(400).json({ error: source.error });

  const cfg = await getProviderConfig(input.provider);
  if (!cfg) {
    const known = await providerSummaries();
    if (!known.some((p) => p.id === input.provider)) return res.status(400).json({ error: `Unknown provider "${input.provider}".` });
    const label = known.find((p) => p.id === input.provider)?.label || input.provider;
    return res.status(400).json({
      error: `The ${label} provider isn't configured yet — add its API key in the “AI model” section of this page.`,
    });
  }

  const db = await getDb();

  // Subject/chapter labels make the prompt more precise; the bank's prompts
  // feed both the AVOID list (keeps the model from re-asking) and the
  // review-time duplicate flags on the response.
  let subjectName: string | undefined;
  let chapterTitle: string | undefined;
  let bankPrompts: string[] = [];
  if (input.subject_id) {
    const subject = (await all(db, "SELECT name FROM subjects WHERE id=?", [input.subject_id])) as any[];
    subjectName = subject[0]?.name;
    const rows = (await all(db, "SELECT prompt FROM questions WHERE subject_id=?", [input.subject_id])) as any[];
    bankPrompts = rows.map((r) => r.prompt);
    if (input.chapter_id) {
      const chapters = (await all(db, "SELECT title FROM chapters WHERE id=?", [input.chapter_id])) as any[];
      chapterTitle = chapters[0]?.title;
    }
  }
  const existingKeys = new Set(bankPrompts.map((p) => normalizeText(p)));
  const startedAt = Date.now();

  try {
    const outcome = await generateQuestions(cfg, input.model, {
      subject: subjectName,
      chapter: chapterTitle,
      text: source.text || "",
      count: input.count,
      difficulty: input.difficulty,
      types: input.types,
      language: input.language,
      avoidPrompts: bankPrompts,
    });

    // Nothing valid even after the model's one repair round-trip.
    if (outcome.questions.length === 0 && outcome.dropped.length === 0) {
      throw new AIError("The model did not return usable JSON even after a retry. Try another model.", 502);
    }

    const duplicates = flagAgainstBank(outcome.questions, existingKeys);

    // Log the run for the history panel. Best-effort: a logging failure must
    // never turn a good generation into an error.
    const generationId = uuid();
    const docCount = input.documentIds?.length || (input.documentId ? 1 : 0);
    try {
      await run(
        db,
        `INSERT INTO ai_generations (id,provider,model,source,subject_id,requested,produced,duplicates,invalid,duration_ms,created_by,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          generationId, cfg.id, input.model,
          docCount > 1 ? "documents" : docCount ? "document" : "text",
          input.subject_id || null,
          input.count, outcome.questions.length, duplicates,
          outcome.dropped.length, Date.now() - startedAt,
          req.user!.id, Date.now(),
        ]
      );
    } catch { /* analytics only */ }

    res.json({
      provider: cfg.id,
      model: input.model,
      generationId,
      questions: outcome.questions,
      dropped: outcome.dropped,
      duplicates,
      truncated: outcome.truncated,
      usage: outcome.usage,
    });
  } catch (err: any) {
    if (err instanceof AIError) return res.status(err.status).json({ error: err.message, detail: err.detail });
    throw err;
  }
});

const checkSchema = z.object({
  subject_id: z.string().min(1),
  prompts: z.array(z.string()).max(200),
});

/**
 * Re-checks prompts during/after review (the user may have edited a question
 * after generation). A prompt is a duplicate when it matches the bank OR an
 * earlier prompt in the same batch.
 */
router.post("/check-duplicates", async (req: Request, res: Response) => {
  const parsed = checkSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const { subject_id, prompts } = parsed.data;

  const db = await getDb();
  const rows = (await all(db, "SELECT prompt FROM questions WHERE subject_id=?", [subject_id])) as any[];
  const keys = new Set(rows.map((r) => normalizeText(r.prompt)));

  const seen = new Set<string>();
  const duplicates = prompts.map((p) => {
    const key = normalizeText(p);
    const dup = keys.has(key) || seen.has(key);
    seen.add(key);
    return dup;
  });
  res.json({ duplicates });
});

export default router;
