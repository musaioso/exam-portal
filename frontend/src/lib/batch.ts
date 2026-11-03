import { api } from "./api";

export interface Batch {
  id: string;
  subject_id: string;
  chapter_id: string | null;
  target_count: number;
  max_per_page: number;
  provider: string;
  model: string;
  fallback_models: string | null;
  allow_vision_fallback: number;
  status: string;
  generated: number;
  quote_ok: number;
  answer_ok: number;
  rejected: number;
  saved: number;
  consecutive_failures: number;
  created_at: number;
}

export interface BatchPage {
  id: string;
  batch_id: string;
  page_number: number | null;
  resolved_page_number: number | null;
  source_file: string;
  printed_number: number | null;
  audit_status: string;
  status: string;
  attempts: number;
  last_error: string | null;
  page_text: string | null;
  image_path: string;
  proposed_number?: number | null;
  audit_reason?: string | null;
}

export interface BatchItem {
  id: string;
  batch_id: string;
  page_number: number | null;
  status: string;
  reason: string | null;
  question_json: string | null;
  source_quote: string | null;
  source_file: string | null;
  verifier_json: string | null;
  verification_method: string | null;
  created_at: number;
}

export interface StepResult {
  status: string;
  page: BatchPage | null;
  imported: number;
  rejected: number;
  reason?: string;
}

export async function createBatch(input: {
  subject_id: string;
  chapter_id: string;
  target_count: number;
  max_per_page: number;
  provider: string;
  model: string;
  fallback_models?: Array<{ provider: string; model: string }>;
  allow_vision_fallback?: boolean;
}): Promise<{ id: string }> {
  const { data } = await api.post("/batches", input);
  return data;
}

export async function uploadPages(batchId: string, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("pages", file);
  const { data } = await api.post(`/batches/${batchId}/pages`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data as { pages: BatchPage[] };
}

export async function auditBatch(batchId: string) {
  const { data } = await api.post(`/batches/${batchId}/audit`);
  return data as { pages: BatchPage[] };
}

export async function confirmPage(batchId: string, sourceFile: string, resolvedPageNumber: number) {
  const { data } = await api.post(`/batches/${batchId}/confirm-page`, {
    source_file: sourceFile,
    resolved_page_number: resolvedPageNumber,
  });
  return data;
}

export async function getBatch(batchId: string) {
  const { data } = await api.get(`/batches/${batchId}`);
  return data as { batch: Batch; pages: BatchPage[] };
}

export async function getBatchItems(batchId: string) {
  const { data } = await api.get(`/batches/${batchId}/items`);
  return data as { items: BatchItem[] };
}

export async function stepBatch(batchId: string) {
  const { data } = await api.post(`/batches/${batchId}/step`, null, { timeout: 180_000 });
  return data as StepResult;
}

export async function pauseBatch(batchId: string) {
  const { data } = await api.post(`/batches/${batchId}/pause`);
  return data;
}

export async function resumeBatch(batchId: string) {
  const { data } = await api.post(`/batches/${batchId}/resume`);
  return data;
}

export async function retryFailed(batchId: string) {
  const { data } = await api.post(`/batches/${batchId}/retry-failed`);
  return data;
}

export async function topUpBatch(batchId: string) {
  const { data } = await api.post(`/batches/${batchId}/top-up`);
  return data;
}

export async function undoBatch(batchId: string) {
  const { data } = await api.delete(`/batches/${batchId}`);
  return data as { deleted: number };
}

export async function listBatches() {
  const { data } = await api.get("/batches");
  return data as { batches: Batch[] };
}

export interface CorrectionRun {
  id: string;
  subject_id: string;
  chapter_id: string | null;
  source_batch_id: string | null;
  search_scope?: string | null;
  status: string;
  checked: number;
  ok: number;
  wrong_page: number;
  wrong_answer: number;
  not_found: number;
  bad_options: number;
  outside_book: number;
  applied: number;
  created_at: number;
}

export interface CorrectionItem {
  id: string;
  run_id: string;
  question_id: string;
  verdict: string;
  current_json: string;
  proposed_json: string | null;
  evidence_json: string | null;
  status: string;
  created_at: number;
  usage?: { exams: number; attempts: number };
}

export async function createCorrection(input: {
  subject_id: string;
  chapter_id?: string;
  source_batch_id: string;
  question_ids?: string[];
  search_scope?: "nearby" | "chapter";
}): Promise<{ id: string }> {
  const { data } = await api.post("/corrections", input);
  return data;
}

export async function stepCorrection(runId: string) {
  const { data } = await api.post(`/corrections/${runId}/step`, null, { timeout: 180_000 });
  return data as { checked: number; items: CorrectionItem[] };
}

export async function getCorrection(runId: string) {
  const { data } = await api.get(`/corrections/${runId}`);
  return data as { run: CorrectionRun; items: CorrectionItem[] };
}

export async function replaceCorrections(runId: string, itemIds: string[], maxPages = 2) {
  const { data } = await api.post(
    `/corrections/${runId}/replace`,
    { item_ids: itemIds, max_pages: maxPages },
    { timeout: 900_000 }
  );
  return data as { replaced: number; failed: number; items: CorrectionItem[] };
}

export async function applyCorrections(runId: string, itemIds: string[]) {
  const { data } = await api.post(`/corrections/${runId}/apply`, { item_ids: itemIds });
  return data as { applied: number };
}

export async function rejectCorrections(runId: string, itemIds: string[]) {
  const { data } = await api.post(`/corrections/${runId}/reject`, { item_ids: itemIds });
  return data as { rejected: number };
}

export async function undoCorrections(runId: string) {
  const { data } = await api.post(`/corrections/${runId}/undo`);
  return data as { restored: number };
}

export async function listCorrections() {
  const { data } = await api.get("/corrections");
  return data as { runs: CorrectionRun[] };
}
