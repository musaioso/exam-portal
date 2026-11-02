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

export async function undoBatch(batchId: string) {
  const { data } = await api.delete(`/batches/${batchId}`);
  return data as { deleted: number };
}

export async function listBatches() {
  const { data } = await api.get("/batches");
  return data as { batches: Batch[] };
}
