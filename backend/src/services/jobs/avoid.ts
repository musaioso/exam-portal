import { all, get } from "../../db/database";
import { normalizeText } from "../../lib/text";
import { deriveLegacyStem } from "./legacy";
import type { JobRecord } from "./store";

export type WorkOrderKind = "mcq" | "short" | "passage";

const LIMIT = 200;
const MAX_CHARS = 120;

function trim(text: unknown): string {
  return String(text ?? "").trim().slice(0, MAX_CHARS);
}

/**
 * What the chapter already holds for one kind, newest first. The work order is
 * per chapter, so this list is chapter-scoped even though the importer's
 * duplicate check stays subject-wide. A passage contributes its stem: the
 * stored `passage_stem` when present, otherwise the stem derived from a legacy
 * `উদ্দীপক:` prompt, otherwise the whole prompt.
 *
 * Over the 200-entry cap the older entries are replaced by one line from the
 * chapter summary — a topic list is still an avoid list, and a 500-line prompt
 * would be ignored by the model.
 */
export async function chapterAvoidList(
  db: any,
  job: JobRecord,
  kind: WorkOrderKind
): Promise<string[]> {
  const where =
    kind === "mcq"
      ? "type='mcq'"
      : kind === "short"
        ? "type='short' AND passage_group IS NULL"
        : "type IN ('short','long')";

  const rows = await all(db,
    `SELECT type, prompt, passage_stem FROM questions
     WHERE chapter_id=? AND ${where}
     ORDER BY created_at DESC, rowid DESC`,
    [job.chapter_id]);

  const seen = new Set<string>();
  const entries: string[] = [];
  for (const row of rows) {
    const source = kind === "passage"
      ? (row.passage_stem || deriveLegacyStem(row.prompt) || row.prompt)
      : row.prompt;
    const key = normalizeText(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(trim(source));
  }

  if (entries.length <= LIMIT) return entries;

  const kept = entries.slice(0, LIMIT);
  const chapter = await get(db, "SELECT summary FROM chapters WHERE id=?", [job.chapter_id]);
  const summary = String(chapter?.summary ?? "").trim();
  if (summary) kept.push(`Also already covered: ${summary}`);
  return kept;
}
