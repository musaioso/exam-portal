import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, get, run } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { createQuestion } from "./helpers";
import { runCorrectionStep } from "../src/services/batch/correct";

process.env.GOOGLE_API_KEY = "test-key";

before(async () => { await migrate(); });

test("whole-chapter scope finds a page the question never cited", async () => {
  const q = await createQuestion({
    pageNumber: null,
    options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"],
    answer: "Padma",
  });
  const db = await getDb();
  const chapterId = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [chapterId, q.subjectId, 1, "Rivers", Date.now()]);
  await run(db, "UPDATE questions SET chapter_id=? WHERE id=?", [chapterId, q.id]);

  const batchId = randomUUID();
  await run(db, `INSERT INTO batch_runs
    (id,subject_id,chapter_id,target_count,max_per_page,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [batchId, q.subjectId, chapterId, 1, 1, "google", "gemini-3.5-flash-lite", "draft", "teacher", Date.now()]);
  for (const [page, text] of [[10, "The Jamuna is a river."], [20, "The Padma is the main river of Bangladesh."]] as const) {
    await run(db, `INSERT INTO batch_pages
      (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,page_text,image_path,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), batchId, page, page, `page${page}.png`, "match", "pending", text,
        `C:\\nonexistent\\page${page}.png`, Date.now()]);
  }

  const runId = randomUUID();
  await run(db, `INSERT INTO correction_runs
    (id,subject_id,chapter_id,source_batch_id,search_scope,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [runId, q.subjectId, chapterId, batchId, "chapter", "draft", "teacher", Date.now()]);

  await runCorrectionStep(runId, {
    auditQuestion: async (_question: any, page: any) => page.pageNumber === 20
      ? { verdict: "ok", proposed: null, evidence: { quote: page.text, pageNumber: page.pageNumber } }
      : { verdict: "outside_book", proposed: null, evidence: { reason: "not here", pageNumber: page.pageNumber } },
  });

  const item = await get(db, "SELECT verdict,proposed_json,evidence_json FROM correction_items WHERE run_id=?", [runId]);
  assert.equal(item.verdict, "wrong_page");
  assert.deepEqual(JSON.parse(item.proposed_json), { page_number: 20 });
  assert.match(item.evidence_json, /"checkedPages":\[20\]/);
});
