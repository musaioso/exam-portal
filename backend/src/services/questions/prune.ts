import { all, run } from "../../db/database";

/** When questions are deleted, drop their ids from every exam's question_ids
 *  list and recompute total_marks (unpublishing an exam that ends up empty). */
export async function pruneQuestionsFromExams(db: any, deletedIds: string[]) {
  if (!deletedIds.length) return;
  const deleted = new Set(deletedIds);
  const exams = (await all(db, "SELECT id, question_ids, is_published FROM exams", [])) as any[];
  for (const e of exams) {
    let qids: string[];
    try { qids = JSON.parse(e.question_ids); } catch { continue; }
    if (!Array.isArray(qids)) continue;
    const remaining = qids.filter((id) => !deleted.has(id));
    if (remaining.length === qids.length) continue;
    if (remaining.length === 0) {
      await run(db, "UPDATE exams SET question_ids=?, total_marks=0, is_published=0 WHERE id=?", [JSON.stringify([]), e.id]);
    } else {
      const qs = (await all(db, `SELECT marks FROM questions WHERE id IN (${remaining.map(() => "?").join(",")})`, remaining)) as any[];
      const total = qs.reduce((s, q) => s + (q.marks || 1), 0);
      await run(db, "UPDATE exams SET question_ids=?, total_marks=? WHERE id=?", [JSON.stringify(remaining), total, e.id]);
    }
  }
}
