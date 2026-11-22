import { all } from "../../db/database";
import { normalizeText } from "../../lib/text";
import { deriveLegacyStem } from "./legacy";
import type { JobRecord } from "./store";

export interface KindProgress {
  done: number;
  target: number;
}

export interface JobProgress {
  mcq: KindProgress;
  short: KindProgress;
  passage: KindProgress;
}

/**
 * Progress is computed from the bank, never from a counter: MCQs, standalone
 * shorts (`passage_group IS NULL`), and distinct passage stems. A 3-mark short
 * that is a Bangla passage part shares a group, so it never advances the
 * standalone short target. Legacy CQ rows count once per derived stem.
 */
export async function jobProgress(db: any, job: JobRecord): Promise<JobProgress> {
  const rows = job.chapter_id
    ? await all(db, "SELECT type, prompt, passage_group, passage_stem FROM questions WHERE chapter_id=?", [job.chapter_id])
    : await all(db,
      "SELECT type, prompt, passage_group, passage_stem FROM questions WHERE subject_id=? AND chapter_id IS NULL",
      [job.subject_id]);

  let mcq = 0;
  let short = 0;
  const groups = new Set<string>();

  for (const row of rows) {
    if (row.type === "mcq") {
      mcq++;
      continue;
    }
    if (row.type === "short" && row.passage_group == null) short++;
    if (row.passage_group) {
      groups.add(`group:${row.passage_group}`);
      continue;
    }
    if (row.type === "long" || row.type === "short") {
      const stem = row.passage_stem || deriveLegacyStem(row.prompt);
      if (stem) groups.add(`legacy:${normalizeText(stem)}`);
    }
  }

  return {
    mcq: { done: mcq, target: job.targets?.mcq ?? 0 },
    short: { done: short, target: job.targets?.short ?? 0 },
    passage: { done: groups.size, target: job.targets?.passage ?? 0 },
  };
}
