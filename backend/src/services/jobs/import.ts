import { randomUUID } from "node:crypto";
import { all, batch, get } from "../../db/database";
import { parseSourcePage } from "../../lib/page";
import { normalizeText } from "../../lib/text";
import { deriveLegacyStem } from "./legacy";
import type { PatternPart, PatternRecord } from "./patterns";
import { parseReply } from "./sanitize";
import type { GenerationRun, JobRecord } from "./store";
import {
  validateMcq,
  validatePassage,
  validateWritten,
  type Difficulty,
} from "./validate";

export interface ImportResult {
  imported: number;        // units
  importedRows: number;    // rows
  skipped: number;         // units
  skippedInChapter: number;
  skippedInSubject: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
  /** Why a unit was skipped; a passage names the part that collided. */
  skips: Array<{ index: number; reason: string }>;
}

export interface ImportOptions {
  db: any;
  job: JobRecord;
  run: GenerationRun;
  pattern: PatternRecord;
  payload: unknown;
  userId: string;
  dryRun?: boolean;
}

/** The four SSC CQ parts; a two-part Bangla passage uses the first two. */
const PART_LETTERS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];

const QUESTION_INSERT = `INSERT INTO questions
  (id,subject_id,chapter_id,type,difficulty,prompt,options,answer,explanation,marks,
   page,page_number,section,source_quote,created_by,created_at,
   job_id,generation_run_id,passage_group,passage_stem,passage_part,passage_index)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

type Kind = "mcq" | "short" | "passage";

interface DuplicateSets {
  chapterPrompts: Set<string>;
  chapterStems: Set<string>;
  subjectPrompts: Set<string>;
  subjectStems: Set<string>;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** What shape a reply item has, independent of what the run asked for. */
function shapeOf(item: unknown): "passage" | "mcq" | "written" | "unknown" {
  if (!isObject(item)) return "unknown";
  if (Array.isArray(item.parts)) return "passage";
  if (Array.isArray(item.options) && item.options.length > 0) return "mcq";
  if (item.prompt != null) return "written";
  return "unknown";
}

function shapeLabel(shape: ReturnType<typeof shapeOf>): string {
  if (shape === "passage") return "a passage";
  if (shape === "mcq") return "an mcq";
  if (shape === "written") return "a short/long question";
  return "not a question";
}

function arrayFrom(data: unknown, key: "questions" | "passages"): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (isObject(data) && Array.isArray(data[key])) return data[key];
  return null;
}

function stemOf(row: any): string {
  return String(row.passage_stem || deriveLegacyStem(row.prompt) || "");
}

function remember(set: Set<string>, value: unknown): void {
  const key = normalizeText(value);
  if (key) set.add(key);
}

async function loadDuplicates(
  db: any,
  subjectId: string,
  chapterId: string
): Promise<DuplicateSets> {
  const sets: DuplicateSets = {
    chapterPrompts: new Set(),
    chapterStems: new Set(),
    subjectPrompts: new Set(),
    subjectStems: new Set(),
  };
  const subjects = await all(db, "SELECT prompt, passage_stem FROM questions WHERE subject_id=?", [subjectId]);
  for (const row of subjects) {
    remember(sets.subjectPrompts, row.prompt);
    remember(sets.subjectStems, stemOf(row));
  }
  const chapter = await all(db, "SELECT prompt, passage_stem FROM questions WHERE chapter_id=?", [chapterId]);
  for (const row of chapter) {
    remember(sets.chapterPrompts, row.prompt);
    remember(sets.chapterStems, stemOf(row));
  }
  return sets;
}

function bucketOf(
  sets: DuplicateSets,
  value: unknown,
  kind: "prompt" | "stem"
): "chapter" | "subject" | null {
  const key = normalizeText(value);
  if (!key) return null;
  const chapter = kind === "prompt" ? sets.chapterPrompts : sets.chapterStems;
  const subject = kind === "prompt" ? sets.subjectPrompts : sets.subjectStems;
  if (chapter.has(key)) return "chapter";
  if (subject.has(key)) return "subject";
  return null;
}

function rememberRow(sets: DuplicateSets, prompt: unknown, stem: unknown): void {
  remember(sets.chapterPrompts, prompt);
  remember(sets.subjectPrompts, prompt);
  if (stem) {
    remember(sets.chapterStems, stem);
    remember(sets.subjectStems, stem);
  }
}

function bucketText(bucket: "chapter" | "subject"): string {
  return bucket === "chapter" ? "this chapter" : "elsewhere in this subject";
}

function passageSpecs(pattern: PatternRecord): PatternPart[] {
  const passage = pattern.parts.find((part) => part.kind === "passage");
  return (passage?.parts ?? []).filter(
    (part) => (part.kind === "short" || part.kind === "long") && Number.isFinite(part.marks)
  );
}

function marksFor(pattern: PatternRecord, kind: "mcq" | "short", fallback: number): number {
  const part = pattern.parts.find((entry) => entry.kind === kind);
  return part && Number.isFinite(part.marks) ? Number(part.marks) : fallback;
}

export async function importReply(opts: ImportOptions): Promise<ImportResult> {
  const { db, job, run, pattern, payload, userId, dryRun = false } = opts;
  // The route always passes a full row; a caller may pass a partial one, so the
  // stored run is the authority for the kind it asked for.
  const kind = ((run as any).kind ??
    (await get(db, "SELECT kind FROM generation_runs WHERE id=?", [run.id]))?.kind) as Kind;
  if (!kind) throw new Error("The run was not found");
  const result: ImportResult = {
    imported: 0,
    importedRows: 0,
    skipped: 0,
    skippedInChapter: 0,
    skippedInSubject: 0,
    failed: 0,
    errors: [],
    skips: [],
  };
  const fail = (index: number, error: string) => {
    result.failed++;
    result.errors.push({ index, error });
  };
  const skip = (index: number, bucket: "chapter" | "subject", reason: string) => {
    result.skipped++;
    if (bucket === "chapter") result.skippedInChapter++;
    else result.skippedInSubject++;
    result.skips.push({ index, reason });
  };

  const data = typeof payload === "string" ? parseReply(payload) : payload;
  const primaryKey = kind === "passage" ? "passages" : "questions";
  const otherKey = kind === "passage" ? "questions" : "passages";
  let items = arrayFrom(data, primaryKey);
  if (!items) {
    const other = arrayFrom(data, otherKey);
    if (other) {
      // The whole reply is the other kind. Nothing from it may be imported.
      other.forEach((item, index) => {
        fail(index, `this run asked for ${kind}; row ${index + 1} is ${shapeLabel(shapeOf(item))}`);
      });
      items = [];
    } else if (isObject(data)) {
      items = [data]; // a reply carrying exactly one object
    } else {
      throw new Error("The reply does not contain any questions");
    }
  }

  const specs = kind === "passage" ? passageSpecs(pattern) : [];
  if (kind === "passage" && specs.length === 0) {
    throw new Error("this job's pattern has no passage");
  }
  const partMarks = specs.map((part) => Number(part.marks));
  const sets = await loadDuplicates(db, job.subject_id, job.chapter_id);
  const inserts: Array<{ sql: string; params: any[] }> = [];
  const now = Date.now();

  const insertRow = (row: {
    type: "mcq" | "short" | "long";
    difficulty: Difficulty;
    prompt: string;
    options: string | null;
    answer: string | null;
    explanation: string | null;
    marks: number;
    page: string | null;
    pageNumber: number | null;
    section: string | null;
    sourceQuote: string | null;
    passageGroup?: string | null;
    passageStem?: string | null;
    passagePart?: string | null;
    passageIndex?: number | null;
  }) => {
    inserts.push({
      sql: QUESTION_INSERT,
      params: [
        randomUUID(), job.subject_id, job.chapter_id, row.type, row.difficulty, row.prompt,
        row.options, row.answer, row.explanation, row.marks,
        row.page, row.pageNumber, row.section, row.sourceQuote, userId, now,
        job.id, run.id, row.passageGroup ?? null, row.passageStem ?? null,
        row.passagePart ?? null, row.passageIndex ?? null,
      ],
    });
  };

  const importOne = (item: unknown, index: number): void => {
    const shape = shapeOf(item);
    if (kind === "passage" && shape !== "passage") {
      fail(index, `this run asked for passage; row ${index + 1} is ${shapeLabel(shape)}`);
      return;
    }
    if (kind === "mcq" && shape !== "mcq") {
      fail(index, `this run asked for mcq; row ${index + 1} is ${shapeLabel(shape)}`);
      return;
    }
    if (kind === "short" && shape !== "written") {
      fail(index, `this run asked for short; row ${index + 1} is ${shapeLabel(shape)}`);
      return;
    }

    try {
      if (kind === "passage") {
        const row = validatePassage(item, partMarks);
        const stemBucket = bucketOf(sets, row.stem, "stem");
        if (stemBucket) {
          skip(index, stemBucket, `stem already in ${bucketText(stemBucket)}`);
          return;
        }
        const prompts = row.parts.map(
          (part, partIndex) => `উদ্দীপক: ${row.stem} (${PART_LETTERS[partIndex]}) ${part.question}`
        );
        for (let partIndex = 0; partIndex < prompts.length; partIndex++) {
          const promptBucket = bucketOf(sets, prompts[partIndex], "prompt");
          if (promptBucket) {
            skip(
              index,
              promptBucket,
              `part ${PART_LETTERS[partIndex]} already in ${bucketText(promptBucket)}`
            );
            return;
          }
        }
        const group = randomUUID();
        const { page, page_number } = parseSourcePage(row.page_number);
        prompts.forEach((prompt, partIndex) => {
          const spec = specs[partIndex];
          insertRow({
            type: spec.kind === "short" ? "short" : "long",
            difficulty: row.difficulty,
            prompt,
            options: null,
            answer: row.parts[partIndex].answer,
            explanation: row.parts[partIndex].scheme,
            marks: Number(spec.marks),
            page,
            pageNumber: page_number,
            section: row.section,
            sourceQuote: row.source_quote,
            passageGroup: group,
            passageStem: row.stem,
            passagePart: PART_LETTERS[partIndex],
            passageIndex: partIndex,
          });
          rememberRow(sets, prompt, null);
        });
        remember(sets.chapterStems, row.stem);
        remember(sets.subjectStems, row.stem);
        result.imported++;
        result.importedRows += prompts.length;
        return;
      }

      const mcq = kind === "mcq" ? validateMcq(item) : null;
      const written = kind === "short" ? validateWritten(item) : null;
      const row = mcq ?? written!;
      const promptBucket = bucketOf(sets, row.prompt, "prompt");
      if (promptBucket) {
        skip(index, promptBucket, `prompt already in ${bucketText(promptBucket)}`);
        return;
      }
      const { page, page_number } = parseSourcePage(row.page_number);
      if (mcq) {
        insertRow({
          type: "mcq",
          difficulty: mcq.difficulty,
          prompt: mcq.prompt,
          options: JSON.stringify(mcq.options),
          answer: mcq.answer,
          explanation: mcq.explanation,
          marks: marksFor(pattern, "mcq", 1),
          page,
          pageNumber: page_number,
          section: mcq.section,
          sourceQuote: mcq.source_quote,
        });
      } else {
        insertRow({
          type: "short",
          difficulty: written!.difficulty,
          prompt: written!.prompt,
          options: null,
          answer: written!.answer,
          explanation: written!.explanation,
          marks: written!.marks ?? marksFor(pattern, "short", 2),
          page,
          pageNumber: page_number,
          section: written!.section,
          sourceQuote: written!.source_quote,
        });
      }
      rememberRow(sets, row.prompt, null);
      result.imported++;
      result.importedRows++;
    } catch (error: any) {
      fail(index, error?.message || "Invalid row");
    }
  };

  for (let index = 0; index < items.length; index++) importOne(items[index], index);

  if (!dryRun) {
    inserts.push({
      sql: `UPDATE generation_runs
        SET imported=imported+?, imported_rows=imported_rows+?, skipped=skipped+?, failed=failed+?
        WHERE id=?`,
      params: [result.imported, result.importedRows, result.skipped, result.failed, run.id],
    });
    await batch(db, inserts);
  }

  return result;
}
