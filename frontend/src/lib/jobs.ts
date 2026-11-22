import { api } from "./api";

/** The three things a work order can ask NotebookLM for. */
export type JobKind = "mcq" | "short" | "passage";

export type PatternKind = "mcq" | "short" | "long" | "passage";

export interface PatternPart {
  kind: PatternKind;
  marks?: number;
  parts?: PatternPart[];
}

export interface Pattern {
  id: string;
  name: string;
  subject_id: string | null;
  chapter_match: string | null;
  parts: PatternPart[];
  is_default: number;
}

export interface JobTargets {
  mcq?: number;
  short?: number;
  passage?: number;
}

export interface KindProgress {
  done: number;
  target: number;
}

export interface JobProgress {
  mcq: KindProgress;
  short: KindProgress;
  passage: KindProgress;
}

export interface Job {
  id: string;
  subject_id: string;
  chapter_id: string;
  pattern_id: string | null;
  exam_label: string;
  targets: JobTargets;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  pattern: Pattern | null;
  /** Attached to the list response, computed from the bank. */
  progress?: JobProgress;
  /** Imported rows that still have no page number on the job's chapter. */
  unverified_pages?: number;
}

export interface GenerationRun {
  id: string;
  job_id: string;
  kind: JobKind;
  requested: number;
  prompt_text: string;
  imported: number;
  imported_rows: number;
  skipped: number;
  failed: number;
  undone_at: number | null;
  created_at: number;
}

export interface ImportResult {
  imported: number;
  importedRows: number;
  skipped: number;
  skippedInChapter: number;
  skippedInSubject: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
  skips?: Array<{ index: number; reason: string }>;
  run?: GenerationRun;
}

export interface CreateJobInput {
  subject_id: string;
  chapter_id: string;
  pattern_id?: string | null;
  exam_label?: string;
  targets?: JobTargets;
  notes?: string;
}

export interface SavePatternInput {
  name: string;
  subject_id?: string | null;
  chapter_match?: string | null;
  parts: PatternPart[];
  is_default?: boolean | number;
}

export async function listJobs(subjectId?: string) {
  const { data } = await api.get("/jobs", { params: subjectId ? { subject_id: subjectId } : undefined });
  return data as { jobs: Job[] };
}

export async function createJob(input: CreateJobInput) {
  const { data } = await api.post("/jobs", input);
  return data as { job: Job };
}

export async function updateJob(id: string, patch: Partial<CreateJobInput> & { status?: string }) {
  const { data } = await api.put(`/jobs/${id}`, patch);
  return data as { job: Job };
}

export async function deleteJob(id: string) {
  const { data } = await api.delete(`/jobs/${id}`);
  return data as { ok: true };
}

export async function listRuns(jobId: string) {
  const { data } = await api.get(`/jobs/${jobId}/runs`);
  return data as { runs: GenerationRun[] };
}

export async function createWorkOrder(jobId: string, kind: JobKind, count: number) {
  const { data } = await api.post(`/jobs/${jobId}/work-order`, { kind, count });
  return data as { run: GenerationRun; prompt: string };
}

export async function importReply(jobId: string, runId: string, payload: string, dryRun = false) {
  const { data } = await api.post(`/jobs/${jobId}/runs/${runId}/import`, { payload, dryRun });
  return data as ImportResult;
}

export async function undoRun(jobId: string, runId: string) {
  const { data } = await api.post(`/jobs/${jobId}/runs/${runId}/undo`);
  return data as { deleted: number; run: GenerationRun };
}

export async function listPatterns() {
  const { data } = await api.get("/patterns");
  return data as { patterns: Pattern[] };
}

export async function savePattern(input: SavePatternInput, id?: string) {
  const { data } = id
    ? await api.put(`/patterns/${id}`, input)
    : await api.post("/patterns", input);
  return data as { pattern: Pattern };
}

export async function deletePattern(id: string) {
  const { data } = await api.delete(`/patterns/${id}`);
  return data as { ok: true };
}
