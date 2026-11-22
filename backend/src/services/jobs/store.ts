import { randomUUID } from "node:crypto";
import { all, get, run } from "../../db/database";
import { parseParts, resolvePattern, type PatternRecord } from "./patterns";
import { jobProgress, type JobProgress } from "./progress";

export interface JobTargets {
  mcq?: number;
  short?: number;
  passage?: number;
}

export interface JobRecord {
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
  /** Present on list/get responses; the row itself only stores pattern_id. */
  pattern?: PatternRecord | null;
  /** Present on list responses: computed from the bank, not stored. */
  progress?: JobProgress;
}

export interface GenerationRun {
  id: string;
  job_id: string;
  kind: "mcq" | "short" | "passage";
  requested: number;
  prompt_text: string;
  imported: number;
  imported_rows: number;
  skipped: number;
  failed: number;
  undone_at: number | null;
  created_at: number;
}

export interface CreateJobInput {
  subject_id?: unknown;
  chapter_id?: unknown;
  pattern_id?: unknown;
  exam_label?: unknown;
  targets?: unknown;
  notes?: unknown;
}

export interface UpdateJobInput extends CreateJobInput {
  status?: unknown;
}

/** Keeps only the three known kinds with a positive count. */
export function cleanTargets(raw: unknown): JobTargets {
  const out: JobTargets = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of ["mcq", "short", "passage"] as const) {
    const value = Number((raw as any)[key]);
    if (Number.isFinite(value) && value > 0) out[key] = Math.floor(value);
  }
  return out;
}

function parseTargets(raw: unknown): JobTargets {
  try {
    return cleanTargets(JSON.parse(String(raw ?? "{}")));
  } catch {
    return {};
  }
}

function mapJob(row: any): JobRecord {
  const job: JobRecord = {
    id: row.id,
    subject_id: row.subject_id,
    chapter_id: row.chapter_id,
    pattern_id: row.pattern_id ?? null,
    exam_label: row.exam_label,
    targets: parseTargets(row.targets),
    status: row.status,
    notes: row.notes ?? null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
  if (row.p_id) {
    let parts: PatternRecord["parts"] = [];
    try {
      parts = parseParts(JSON.parse(row.p_parts));
    } catch {
      parts = [];
    }
    job.pattern = {
      id: row.p_id,
      name: row.p_name,
      subject_id: row.p_subject_id ?? null,
      chapter_match: row.p_chapter_match ?? null,
      parts,
      is_default: Number(row.p_is_default) || 0,
    };
  } else {
    job.pattern = null;
  }
  return job;
}

const JOB_SELECT = `
  SELECT j.*,
    p.id AS p_id, p.name AS p_name, p.subject_id AS p_subject_id,
    p.chapter_match AS p_chapter_match, p.parts AS p_parts, p.is_default AS p_is_default
  FROM generation_jobs j
  LEFT JOIN question_patterns p ON p.id = j.pattern_id`;

export async function getJob(db: any, id: string): Promise<JobRecord | null> {
  const rows = await all(db, `${JOB_SELECT} WHERE j.id=?`, [id]);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function jobWithPattern(db: any, id: string): Promise<JobRecord | null> {
  return getJob(db, id);
}

export async function listJobs(db: any, subjectId?: string | null): Promise<JobRecord[]> {
  const rows = subjectId
    ? await all(db, `${JOB_SELECT} WHERE j.subject_id=? ORDER BY j.created_at DESC`, [subjectId])
    : await all(db, `${JOB_SELECT} ORDER BY j.created_at DESC`);
  const jobs = rows.map(mapJob);
  for (const job of jobs) job.progress = await jobProgress(db, job);
  return jobs;
}

export async function createJob(db: any, input: CreateJobInput, userId: string): Promise<JobRecord> {
  const subjectId = input.subject_id ? String(input.subject_id) : "";
  const chapterId = input.chapter_id ? String(input.chapter_id) : "";
  if (!subjectId) throw new Error("subject_id is required");
  if (!chapterId) throw new Error("chapter_id is required");
  const chapter = await get(db, "SELECT id,title FROM chapters WHERE id=? AND subject_id=?", [chapterId, subjectId]);
  if (!chapter) throw new Error("The chapter was not found for that subject.");

  let patternId = input.pattern_id ? String(input.pattern_id) : null;
  if (!patternId) {
    const pattern = await resolvePattern(db, subjectId, String(chapter.title ?? ""));
    patternId = pattern?.id ?? null;
  }

  const now = Date.now();
  const id = randomUUID();
  await run(db,
    `INSERT INTO generation_jobs
       (id,subject_id,chapter_id,pattern_id,exam_label,targets,status,notes,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, subjectId, chapterId, patternId,
      input.exam_label ? String(input.exam_label) : "SSC 2027",
      JSON.stringify(cleanTargets(input.targets)),
      "active",
      input.notes != null ? String(input.notes) : null,
      userId, now, now]);
  return (await getJob(db, id))!;
}

export async function updateJob(db: any, id: string, patch: UpdateJobInput): Promise<JobRecord | null> {
  const existing = await getJob(db, id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.subject_id !== undefined) {
    if (!patch.subject_id) throw new Error("subject_id is required");
    sets.push("subject_id=?");
    params.push(String(patch.subject_id));
  }
  if (patch.chapter_id !== undefined) {
    if (!patch.chapter_id) throw new Error("chapter_id is required");
    sets.push("chapter_id=?");
    params.push(String(patch.chapter_id));
  }
  if (patch.pattern_id !== undefined) {
    sets.push("pattern_id=?");
    params.push(patch.pattern_id ? String(patch.pattern_id) : null);
  }
  if (patch.exam_label !== undefined) {
    const label = String(patch.exam_label ?? "").trim();
    if (!label) throw new Error("exam_label is required");
    sets.push("exam_label=?");
    params.push(label);
  }
  if (patch.targets !== undefined) {
    sets.push("targets=?");
    params.push(JSON.stringify(cleanTargets(patch.targets)));
  }
  if (patch.notes !== undefined) {
    sets.push("notes=?");
    params.push(patch.notes != null ? String(patch.notes) : null);
  }
  if (patch.status !== undefined) {
    const status = String(patch.status ?? "").trim();
    if (!["active", "done", "paused"].includes(status)) {
      throw new Error("status must be active, done or paused");
    }
    sets.push("status=?");
    params.push(status);
  }
  if (sets.length > 0) {
    sets.push("updated_at=?");
    params.push(Date.now(), id);
    await run(db, `UPDATE generation_jobs SET ${sets.join(", ")} WHERE id=?`, params);
  }
  return getJob(db, id);
}

export async function deleteJob(db: any, id: string): Promise<void> {
  // Runs cascade with the job; questions keep their job_id/run id so no question
  // is ever rewritten or deleted by editing job metadata.
  await run(db, "DELETE FROM generation_jobs WHERE id=?", [id]);
}

export async function listRuns(db: any, jobId: string): Promise<GenerationRun[]> {
  const rows = await all(db,
    "SELECT * FROM generation_runs WHERE job_id=? ORDER BY created_at DESC, rowid DESC", [jobId]);
  return rows as GenerationRun[];
}

/** Records one work order: the run is created before the teacher copies it, so
 * the exact prompt text that was issued survives the chat that produced it. */
export async function createRun(
  db: any,
  jobId: string,
  kind: GenerationRun["kind"],
  requested: number,
  promptText: string,
  userId: string
): Promise<GenerationRun> {
  const id = randomUUID();
  await run(db,
    `INSERT INTO generation_runs
       (id,job_id,kind,requested,prompt_text,created_by,created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, jobId, kind, requested, promptText, userId, Date.now()]);
  return (await get(db, "SELECT * FROM generation_runs WHERE id=?", [id])) as GenerationRun;
}
