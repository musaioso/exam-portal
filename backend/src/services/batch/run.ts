import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { getDb, run, get, all, runChanges, batch } from "../../db/database";
import { normalizeText } from "../../lib/text";
import { getProviderConfig } from "../ai/providers";
import { ocrImage } from "../ai/ocr";
import { generatePage as realGeneratePage, type Candidate } from "./generate";
import { verifyCandidates as realVerifyCandidates } from "./verify";
import { withRetry, modelChain } from "./retry";

export interface StepResult {
  status: string;
  page: any | null;
  imported: number;
  rejected: number;
  reason?: string;
}

type GenerateFn = typeof realGeneratePage;
type VerifyFn = typeof realVerifyCandidates;
type ConfigFn = typeof getProviderConfig;

export async function runNextPage(
  batchId: string,
  deps: {
    generatePage?: GenerateFn;
    verifyCandidates?: VerifyFn;
    ocrPage?: (image: Buffer) => Promise<string>;
    getProviderConfig?: ConfigFn;
    retry?: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void> };
    now?: () => number;
  } = {}
): Promise<StepResult> {
  const db = await getDb();
  const now = deps.now?.() ?? Date.now();
  const lease = now + 120_000;

  const runRow = await get(db, "SELECT * FROM batch_runs WHERE id=?", [batchId]);
  if (!runRow) return { status: "missing", page: null, imported: 0, rejected: 0, reason: "Batch not found" };
  if (runRow.status === "done") return { status: "done", page: null, imported: 0, rejected: 0 };
  if (runRow.status === "paused") return { status: "paused", page: null, imported: 0, rejected: 0 };
  if (runRow.status === "draft") {
    await run(db, "UPDATE batch_runs SET status='running' WHERE id=?", [batchId]);
    runRow.status = "running";
  }

  const changed = await runChanges(db, `UPDATE batch_pages
    SET status='running', attempts=attempts+1, lease_until=?
    WHERE id = (
      SELECT id FROM batch_pages
      WHERE batch_id=? AND resolved_page_number IS NOT NULL
        AND (status='pending' OR (status='running' AND lease_until < ?))
      ORDER BY resolved_page_number LIMIT 1
    )
    AND (status='pending' OR (status='running' AND lease_until < ?))`,
    [lease, batchId, now, now]);

  if (!changed) {
    const pending = await get(db, "SELECT COUNT(*) AS n FROM batch_pages WHERE batch_id=? AND status='pending'", [batchId]);
    if (Number(pending?.n ?? 0) === 0) {
      await run(db, "UPDATE batch_runs SET status='done', completed_at=? WHERE id=? AND status='running'", [Date.now(), batchId]);
      return { status: "done", page: null, imported: 0, rejected: 0 };
    }
    return { status: "running", page: null, imported: 0, rejected: 0 };
  }

  const page = await get(
    db,
    "SELECT * FROM batch_pages WHERE batch_id=? AND status='running' AND lease_until=? ORDER BY resolved_page_number LIMIT 1",
    [batchId, lease]
  );
  if (!page) return { status: "running", page: null, imported: 0, rejected: 0 };

  let image = Buffer.alloc(0);
  try {
    if (page.image_path && fs.existsSync(page.image_path)) image = fs.readFileSync(page.image_path);
  } catch {
    image = Buffer.alloc(0);
  }

  const chapter = runRow.chapter_id
    ? await get(db, "SELECT title FROM chapters WHERE id=?", [runRow.chapter_id])
    : null;

  let pageText = String(page.page_text || "");
  if (!pageText) {
    try {
      const read = deps.ocrPage ?? ((b: Buffer) => ocrImage(b, ["eng", "ben"]));
      pageText = await read(image);
    } catch {
      pageText = "";
    }
    if (pageText) await run(db, "UPDATE batch_pages SET page_text=? WHERE id=?", [pageText, page.id]);
  }

  const meta = {
    pageNumber: Number(page.resolved_page_number),
    chapterTitle: String(chapter?.title || ""),
    maxQuestions: Number(runRow.max_per_page) || 5,
  };

  let fallbacks: Array<{ provider: string; model: string }> = [];
  try {
    const parsed = JSON.parse(runRow.fallback_models || "[]");
    if (Array.isArray(parsed)) fallbacks = parsed.filter((x: any) => x && x.provider && x.model);
  } catch {
    fallbacks = [];
  }

  const resolveCfg = deps.getProviderConfig ?? getProviderConfig;
  const generate = deps.generatePage ?? realGeneratePage;
  const chain = modelChain({ provider: String(runRow.provider), model: String(runRow.model) }, fallbacks);
  let candidates: Candidate[] | null = null;
  let primaryCfg: Awaited<ReturnType<ConfigFn>> | null = null;
  let lastError: unknown = null;

  for (const entry of chain) {
    const cfg = await resolveCfg(entry.provider);
    if (!cfg) {
      lastError = new Error(`Provider ${entry.provider} is not configured.`);
      continue;
    }
    if (!primaryCfg) primaryCfg = cfg;
    try {
      candidates = await withRetry(
        () => generate(cfg, entry.model, image, "image/png", meta),
        deps.retry
      );
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!candidates) {
    const reason = String((lastError as any)?.message || lastError || "Generation failed");
    await run(db, "UPDATE batch_pages SET status='failed', last_error=?, lease_until=NULL WHERE id=?",
      [reason, page.id]);
    await run(db, "UPDATE batch_runs SET consecutive_failures=consecutive_failures+1 WHERE id=?", [batchId]);
    const after = await get(db, "SELECT consecutive_failures FROM batch_runs WHERE id=?", [batchId]);
    const failures = Number(after?.consecutive_failures ?? 0);
    if (failures >= 3) await run(db, "UPDATE batch_runs SET status='paused' WHERE id=?", [batchId]);
    return { status: failures >= 3 ? "paused" : "running", page, imported: 0, rejected: 0, reason };
  }

  if (!primaryCfg) {
    const reason = "No provider configuration available for verification.";
    await run(db, "UPDATE batch_pages SET status='failed', last_error=?, lease_until=NULL WHERE id=?",
      [reason, page.id]);
    return { status: "running", page, imported: 0, rejected: 0, reason };
  }

  const verify = deps.verifyCandidates ?? realVerifyCandidates;
  const verdicts = await verify({
    pageText: pageText || null,
    image,
    mimeType: "image/png",
    candidates,
    cfg: primaryCfg,
    model: String(runRow.model),
    allowVisionFallback: !!runRow.allow_vision_fallback,
  });
  const verdictByIndex = new Map(verdicts.map((v) => [v.index, v]));

  const existingRows = await all(db, "SELECT prompt FROM questions WHERE subject_id=?", [runRow.subject_id]);
  const existing = new Set(existingRows.map((r: any) => normalizeText(String(r.prompt))));
  const itemRows = await all(db, "SELECT prompt_hash FROM batch_items WHERE batch_id=?", [batchId]);
  const seenHashes = new Set(itemRows.map((r: any) => r.prompt_hash).filter(Boolean) as string[]);

  const statements: Array<{ sql: string; params: any[] }> = [];
  let imported = 0;
  let rejectedCount = 0;
  let quoteOk = 0;
  let answerOk = 0;

  candidates.forEach((candidate, index) => {
    const verdict = verdictByIndex.get(index);
    const valid = verdict?.valid === true;
    if (!valid) {
      rejectedCount++;
      statements.push({
        sql: `INSERT INTO batch_items
          (id,batch_id,page_number,status,reason,question_json,source_quote,source_file,verifier_json,verification_method,prompt_hash,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [randomUUID(), batchId, Number(page.resolved_page_number), "rejected",
          verdict?.reason || "rejected", JSON.stringify(candidate), candidate.sourceQuote, page.source_file,
          JSON.stringify(verdict || null), verdict?.method || "ocr", null, Date.now()],
      });
      return;
    }
    quoteOk++;
    answerOk++;
    const key = normalizeText(candidate.prompt);
    const promptHash = createHash("sha256").update(key).digest("hex");
    if (existing.has(key) || seenHashes.has(promptHash)) {
      rejectedCount++;
      statements.push({
        sql: `INSERT INTO batch_items
          (id,batch_id,page_number,status,reason,question_json,source_quote,source_file,verifier_json,verification_method,prompt_hash,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [randomUUID(), batchId, Number(page.resolved_page_number), "rejected",
          "duplicate question", JSON.stringify(candidate), candidate.sourceQuote, page.source_file,
          JSON.stringify(verdict), verdict?.method || "ocr", null, Date.now()],
      });
      return;
    }
    existing.add(key);
    seenHashes.add(promptHash);
    const id = randomUUID();
    statements.push({
      sql: `INSERT INTO questions
        (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,page,page_number,
         batch_id,source_quote,source_file,verification,verification_method,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [id, runRow.subject_id, runRow.chapter_id, "mcq", candidate.difficulty, candidate.prompt,
        JSON.stringify(candidate.options), candidate.answer, candidate.explanation, candidate.marks,
        String(page.resolved_page_number), Number(page.resolved_page_number), batchId,
        candidate.sourceQuote, page.source_file, JSON.stringify(verdict), verdict?.method || "ocr",
        runRow.created_by, Date.now()],
    });
    statements.push({
      sql: `INSERT INTO batch_items
        (id,batch_id,page_number,status,reason,question_json,source_quote,source_file,verifier_json,verification_method,prompt_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [randomUUID(), batchId, Number(page.resolved_page_number), "accepted", null,
        JSON.stringify(candidate), candidate.sourceQuote, page.source_file,
        JSON.stringify(verdict), verdict?.method || "ocr", promptHash, Date.now()],
    });
    imported++;
  });

  statements.push({
    sql: "UPDATE batch_pages SET status='done', lease_until=NULL, last_error=NULL WHERE id=?",
    params: [page.id],
  });
  statements.push({
    sql: `UPDATE batch_runs SET generated=generated+?, quote_ok=quote_ok+?, answer_ok=answer_ok+?,
      rejected=rejected+?, saved=saved+?, consecutive_failures=0 WHERE id=?`,
    params: [candidates.length, quoteOk, answerOk, rejectedCount, imported, batchId],
  });

  await batch(db, statements);

  const after = await get(db, "SELECT saved,target_count FROM batch_runs WHERE id=?", [batchId]);
  const pending = await get(
    db,
    "SELECT COUNT(*) AS n FROM batch_pages WHERE batch_id=? AND status IN ('pending','running')",
    [batchId]
  );
  let status = "running";
  if (Number(after?.saved ?? 0) >= Number(after?.target_count ?? 0) || Number(pending?.n ?? 0) === 0) {
    await run(db, "UPDATE batch_runs SET status='done', completed_at=? WHERE id=?", [Date.now(), batchId]);
    status = "done";
  }

  return { status, page, imported, rejected: rejectedCount };
}
