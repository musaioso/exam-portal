import { all, batch } from "../../db/database";
import { pruneQuestionsFromExams } from "../questions/prune";

/**
 * Undo one import run: delete exactly the rows it created, stamp the run so it
 * cannot be undone twice, and prune the ids from any exam that used them —
 * the same follow-up `bulk-delete` and Batch Studio's undo already do.
 */
export async function undoRun(db: any, jobId: string, runId: string): Promise<{ deleted: number }> {
  const rows = await all(db,
    "SELECT id FROM questions WHERE generation_run_id=? AND job_id=?",
    [runId, jobId]);
  const ids = rows.map((row: any) => String(row.id));

  await batch(db, [
    { sql: "DELETE FROM questions WHERE generation_run_id=? AND job_id=?", params: [runId, jobId] },
    { sql: "UPDATE generation_runs SET undone_at=? WHERE id=? AND job_id=?", params: [Date.now(), runId, jobId] },
  ]);
  await pruneQuestionsFromExams(db, ids);
  return { deleted: ids.length };
}
