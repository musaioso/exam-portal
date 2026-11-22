import { randomUUID } from "node:crypto";
import { all, run } from "../../db/database";

/**
 * A print pattern is data, not code: the teacher edits these rows in the UI so a
 * new question format never needs a retyped prompt. A plain part carries a
 * `marks` value; a `passage` part carries the ordered marks of its own parts
 * (1,2,3,4 for an SSC CQ; 3,7 for Bangla 1st উপন্যাস/নাটক).
 */
export type PatternKind = "mcq" | "short" | "long" | "passage";

export interface PatternPart {
  kind: PatternKind;
  marks?: number;
  parts?: PatternPart[];
}

export interface PatternRecord {
  id: string;
  name: string;
  subject_id: string | null;
  chapter_match: string | null;
  parts: PatternPart[];
  is_default: number;
}

const KINDS: PatternKind[] = ["mcq", "short", "long", "passage"];
const PASSAGE_KINDS: PatternKind[] = ["short", "long"];

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates and normalises a stored pattern's `parts` JSON. Throws with a
 * message the API can hand straight to the teacher.
 */
export function parseParts(raw: unknown): PatternPart[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("parts must be a non-empty array");
  return raw.map((entry) => {
    if (!isObject(entry)) throw new Error("invalid kind");
    const kind = entry.kind as PatternKind;
    if (!KINDS.includes(kind)) throw new Error("invalid kind");
    if (kind === "passage") {
      const children = entry.parts;
      if (!Array.isArray(children) || children.length < 2 || children.length > 6) {
        throw new Error("passage parts must have 2 to 6 entries");
      }
      return {
        kind,
        parts: children.map((child: unknown) => {
          if (!isObject(child)) throw new Error("invalid kind");
          const childKind = child.kind as PatternKind;
          if (!PASSAGE_KINDS.includes(childKind)) throw new Error("invalid kind");
          if (!Number.isInteger(child.marks) || child.marks <= 0) {
            throw new Error("marks must be a positive integer");
          }
          return { kind: childKind, marks: child.marks };
        }),
      };
    }
    if (!Number.isInteger(entry.marks) || entry.marks <= 0) {
      throw new Error("marks must be a positive integer");
    }
    return { kind, marks: entry.marks };
  });
}

function toRecord(row: any): PatternRecord | null {
  if (!row) return null;
  let parts: PatternPart[];
  try {
    parts = parseParts(JSON.parse(row.parts));
  } catch {
    parts = [];
  }
  return {
    id: row.id,
    name: row.name,
    subject_id: row.subject_id ?? null,
    chapter_match: row.chapter_match ?? null,
    parts,
    is_default: Number(row.is_default) || 0,
  };
}

export async function listPatterns(db: any): Promise<PatternRecord[]> {
  const rows = await all(db, "SELECT * FROM question_patterns ORDER BY is_default DESC, created_at ASC, name ASC");
  return rows.map((row: any) => toRecord(row)!).filter(Boolean);
}

export async function getPattern(db: any, id: string): Promise<PatternRecord | null> {
  const rows = await all(db, "SELECT * FROM question_patterns WHERE id=?", [id]);
  return toRecord(rows[0]);
}

export async function createPattern(
  db: any,
  input: { name?: unknown; subject_id?: unknown; chapter_match?: unknown; parts?: unknown; is_default?: unknown },
  userId?: string | null
): Promise<PatternRecord> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("name is required");
  const parts = parseParts(input.parts);
  const now = Date.now();
  const id = randomUUID();
  await run(db,
    `INSERT INTO question_patterns (id,name,subject_id,chapter_match,parts,is_default,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, name, input.subject_id ? String(input.subject_id) : null,
      input.chapter_match ? String(input.chapter_match) : null,
      JSON.stringify(parts), input.is_default ? 1 : 0, userId ?? null, now, now]);
  return (await getPattern(db, id))!;
}

export async function updatePattern(
  db: any,
  id: string,
  patch: { name?: unknown; subject_id?: unknown; chapter_match?: unknown; parts?: unknown; is_default?: unknown }
): Promise<PatternRecord | null> {
  const existing = await getPattern(db, id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new Error("name is required");
    sets.push("name=?");
    params.push(name);
  }
  if (patch.subject_id !== undefined) {
    sets.push("subject_id=?");
    params.push(patch.subject_id ? String(patch.subject_id) : null);
  }
  if (patch.chapter_match !== undefined) {
    sets.push("chapter_match=?");
    params.push(patch.chapter_match ? String(patch.chapter_match) : null);
  }
  if (patch.parts !== undefined) {
    sets.push("parts=?");
    params.push(JSON.stringify(parseParts(patch.parts)));
  }
  if (patch.is_default !== undefined) {
    sets.push("is_default=?");
    params.push(patch.is_default ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push("updated_at=?");
    params.push(Date.now(), id);
    await run(db, `UPDATE question_patterns SET ${sets.join(", ")} WHERE id=?`, params);
  }
  return getPattern(db, id);
}

export async function deletePattern(db: any, id: string): Promise<void> {
  // generation_jobs.pattern_id is ON DELETE SET NULL, so history survives.
  await run(db, "DELETE FROM question_patterns WHERE id=?", [id]);
}

const SEEDS: Array<{ name: string; subject_id: string | null; chapter_match: string | null; is_default: number; parts: PatternPart[] }> = [
  {
    name: "SSC CQ (default)", subject_id: null, chapter_match: null, is_default: 1,
    parts: [
      { kind: "mcq", marks: 1 },
      {
        kind: "passage", parts: [
          { kind: "long", marks: 1 }, { kind: "long", marks: 2 },
          { kind: "long", marks: 3 }, { kind: "long", marks: 4 },
        ],
      },
      { kind: "short", marks: 2 },
    ],
  },
  {
    name: "Bangla 1st — উপন্যাস/নাটক", subject_id: null, chapter_match: "উপন্যাস|নাটক", is_default: 0,
    parts: [{
      kind: "passage", parts: [
        { kind: "short", marks: 3 }, { kind: "long", marks: 7 },
      ],
    }],
  },
  {
    name: "SSC short", subject_id: null, chapter_match: null, is_default: 0,
    parts: [{ kind: "short", marks: 2 }],
  },
];

/** Inserts the formats known today, once each. Idempotent by name. */
export async function seedPatterns(db: any): Promise<void> {
  for (const seed of SEEDS) {
    const existing = await all(db, "SELECT id FROM question_patterns WHERE name=?", [seed.name]);
    if (existing.length > 0) continue;
    const now = Date.now();
    await run(db,
      `INSERT INTO question_patterns (id,name,subject_id,chapter_match,parts,is_default,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), seed.name, seed.subject_id, seed.chapter_match,
        JSON.stringify(seed.parts), seed.is_default, null, now, now]);
  }
}

function matches(record: PatternRecord, chapterTitle: string): boolean {
  if (!record.chapter_match) return false;
  try {
    return new RegExp(record.chapter_match).test(chapterTitle);
  } catch {
    return false;
  }
}

/**
 * Picks the pattern for a chapter: a subject-specific title match first, then
 * any subject-specific row, then the default, else null.
 */
export async function resolvePattern(
  db: any,
  subjectId: string,
  chapterTitle: string
): Promise<PatternRecord | null> {
  const patterns = await listPatterns(db);
  const forSubject = patterns.filter((p) => p.subject_id === subjectId);
  const byTitle = forSubject.find((p) => matches(p, chapterTitle));
  if (byTitle) return byTitle;
  if (forSubject.length > 0) return forSubject[0];
  return patterns.find((p) => p.is_default === 1) ?? null;
}
