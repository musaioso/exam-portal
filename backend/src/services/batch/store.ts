import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, run, get, all, batch } from "../../db/database";
import { pruneQuestionsFromExams } from "../questions/prune";
import { auditPages } from "./pages";

export async function createBatch(input: {
  subject_id: string;
  chapter_id: string;
  target_count: number;
  max_per_page: number;
  provider: string;
  model: string;
  fallback_models?: Array<{ provider: string; model: string }>;
  allow_vision_fallback?: boolean;
  created_by: string;
}): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await run(db, `INSERT INTO batch_runs
    (id,subject_id,chapter_id,target_count,max_per_page,provider,model,fallback_models,
     allow_vision_fallback,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.subject_id, input.chapter_id, input.target_count, input.max_per_page,
      input.provider, input.model, JSON.stringify(input.fallback_models || []),
      input.allow_vision_fallback ? 1 : 0, "draft", input.created_by, Date.now(),
    ]);
  return id;
}

export async function addBatchPages(batchId: string, pages: Array<{
  pageNumber: number | null;
  sourceFile: string;
  imagePath: string;
  imageSha: string;
}>): Promise<void> {
  const db = await getDb();
  for (const page of pages) {
    await run(db, `INSERT INTO batch_pages
      (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,image_sha,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), batchId, page.pageNumber, null, page.sourceFile, "unnumbered", "pending",
        page.imagePath, page.imageSha, Date.now()]);
  }
}

export async function listBatchPages(batchId: string): Promise<any[]> {
  const db = await getDb();
  return all(db, "SELECT * FROM batch_pages WHERE batch_id=? ORDER BY COALESCE(page_number, 999999), source_file", [batchId]);
}

export async function getBatch(batchId: string): Promise<{ batch: any; pages: any[] } | null> {
  const db = await getDb();
  const batch = await get(db, "SELECT * FROM batch_runs WHERE id=?", [batchId]);
  if (!batch) return null;
  return { batch, pages: await listBatchPages(batchId) };
}

export async function auditBatch(
  batchId: string,
  deps: { readNumbers?: (image: Buffer) => Promise<number[]> } = {}
): Promise<any[]> {
  const db = await getDb();
  const pages = await listBatchPages(batchId);
  const sourcePages = pages.map((p: any) => ({
    sourceFile: String(p.source_file),
    image: p.image_path && fs.existsSync(p.image_path) ? fs.readFileSync(p.image_path) : Buffer.alloc(0),
    mimeType: "image/png",
    filenameNumber: p.page_number == null ? null : Number(p.page_number),
  }));
  const audits = await auditPages(sourcePages, deps);
  const byFile = new Map(audits.map((a) => [a.sourceFile, a]));
  for (const page of pages) {
    const audit = byFile.get(String(page.source_file));
    if (!audit) continue;
    if (page.audit_status === "confirmed") continue;
    await run(db, `UPDATE batch_pages SET printed_number=?, audit_status=?, resolved_page_number=? WHERE id=?`,
      [audit.printedNumber, audit.auditStatus,
        audit.auditStatus === "match" ? audit.filenameNumber : null, page.id]);
  }
  const fresh = await listBatchPages(batchId);
  return fresh.map((p: any) => {
    const audit = byFile.get(String(p.source_file));
    return { ...p, proposed_number: audit?.proposedNumber ?? null, audit_reason: audit?.reason ?? null };
  });
}

export async function confirmBatchPage(
  batchId: string,
  sourceFile: string,
  resolvedPageNumber: number
): Promise<void> {
  const db = await getDb();
  await run(db, `UPDATE batch_pages
    SET audit_status='confirmed', resolved_page_number=?, page_number=COALESCE(page_number, ?)
    WHERE batch_id=? AND source_file=?`,
    [resolvedPageNumber, resolvedPageNumber, batchId, sourceFile]);
}

export async function undoBatch(batchId: string): Promise<{ deleted: number }> {
  const db = await getDb();
  const batchRow = await get(db, "SELECT id,status FROM batch_runs WHERE id=?", [batchId]);
  if (!batchRow) return { deleted: 0 };
  if (batchRow.status === "running") return { deleted: 0 };
  const rows = await all(db, "SELECT id FROM questions WHERE batch_id=?", [batchId]);
  const deletedIds = rows.map((row: any) => String(row.id));
  await batch(db, [
    { sql: "DELETE FROM questions WHERE batch_id=?", params: [batchId] },
    { sql: "DELETE FROM batch_runs WHERE id=?", params: [batchId] },
  ]);
  await pruneQuestionsFromExams(db, deletedIds);
  const root = path.resolve(process.cwd(), "data", "batches");
  const dir = path.join(root, path.basename(batchId));
  if (dir.startsWith(root + path.sep)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the cache is best-effort; the database rows are the record */
    }
  }
  return { deleted: rows.length };
}
