import { all } from "../db/database";

export type ChallengeSummary = {
  id: string;
  status: string;
  message: string;
  reply: string | null;
};

/**
 * The newest challenge per question for one student, optionally narrowed to one
 * attempt. Review and practice both attach this so a question that was already
 * challenged renders its status instead of a fresh form.
 */
export async function latestChallengesByQuestion(
  db: any,
  studentId: string,
  questionIds: string[],
  attemptId?: string | null
): Promise<Map<string, ChallengeSummary>> {
  const map = new Map<string, ChallengeSummary>();
  if (questionIds.length === 0) return map;
  const holes = questionIds.map(() => "?").join(",");
  const params: any[] = [studentId, ...(attemptId ? [attemptId] : []), ...questionIds];
  const rows = (await all(
    db,
    `SELECT * FROM question_challenges
     WHERE student_id=? ${attemptId ? "AND attempt_id=?" : ""} AND question_id IN (${holes})
     ORDER BY created_at DESC`,
    params
  )) as any[];
  for (const row of rows) {
    if (map.has(row.question_id)) continue;
    map.set(row.question_id, {
      id: row.id,
      status: row.status,
      message: row.message,
      reply: row.reply ?? null,
    });
  }
  return map;
}
