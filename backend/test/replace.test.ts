import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, get, run } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { createQuestion } from "./helpers";
import { replaceItems } from "../src/services/batch/replace";

process.env.GOOGLE_API_KEY = "test-key";

before(async () => { await migrate(); });

async function setup(questionOptions: any = {}) {
  const q = await createQuestion({
    pageNumber: 55, answer: "A", options: ["A", "B", "C", "D"], ...questionOptions,
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
  await run(db, `INSERT INTO batch_pages
    (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,page_text,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 55, "page55.png", "match", "pending",
      "Rivers\nThe Padma is the main river of Bangladesh.", "C:\\nonexistent\\page55.png", Date.now()]);

  const runId = randomUUID();
  await run(db, `INSERT INTO correction_runs
    (id,subject_id,chapter_id,source_batch_id,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`,
    [runId, q.subjectId, chapterId, batchId, "review", "teacher", Date.now()]);
  const itemId = randomUUID();
  await run(db, `INSERT INTO correction_items
    (id,run_id,question_id,verdict,current_json,proposed_json,evidence_json,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [itemId, runId, q.id, "outside_book", JSON.stringify(q), null, JSON.stringify({}), "proposed", Date.now()]);

  return { q, db, chapterId, batchId, runId, itemId };
}

const candidate = {
  type: "mcq" as const,
  difficulty: "easy" as const,
  prompt: "What is the main river of Bangladesh?",
  options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"],
  answer: "Padma",
  explanation: "The page says so.",
  sourceQuote: "The Padma is the main river of Bangladesh.",
  section: "Rivers",
  marks: 1,
};

test("replaceItems stores a full replacement without touching the question", async () => {
  const { q, db, runId, itemId } = await setup();
  const result = await replaceItems(runId, [itemId], {}, {
    generatePage: async () => [candidate],
    verifyCandidates: async () => [{ index: 0, valid: true }],
  });

  assert.deepEqual({ replaced: result.replaced, failed: result.failed }, { replaced: 1, failed: 0 });
  const item = await get(db, "SELECT proposed_json,status FROM correction_items WHERE id=?", [itemId]);
  const proposed = JSON.parse(item.proposed_json);
  assert.equal(proposed.prompt, candidate.prompt);
  assert.deepEqual(proposed.options, candidate.options);
  assert.equal(proposed.answer, "Padma");
  assert.equal(proposed.page_number, 55);
  assert.equal(proposed.section, "Rivers");
  assert.equal(proposed.source_quote, candidate.sourceQuote);

  const question = await get(db, "SELECT prompt FROM questions WHERE id=?", [q.id]);
  assert.equal(question.prompt, "Test question?");
});

test("replaceItems reports the verifier reason when nothing passes", async () => {
  const { db, runId, itemId } = await setup();
  const result = await replaceItems(runId, [itemId], { maxPages: 1, attemptsPerPage: 1 }, {
    generatePage: async () => [candidate],
    verifyCandidates: async () => [{ index: 0, valid: false, reason: "quote not found on page" }],
  });

  assert.deepEqual({ replaced: result.replaced, failed: result.failed }, { replaced: 0, failed: 1 });
  const item = await get(db, "SELECT proposed_json,evidence_json FROM correction_items WHERE id=?", [itemId]);
  assert.equal(item.proposed_json, null);
  assert.match(item.evidence_json, /quote not found on page/);
});
