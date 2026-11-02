import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { runNextPage } from "../src/services/batch/run";

before(async () => { await migrate(); });

test("step saves only verified, unique questions and stamps the resolved page", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const chapterId = randomUUID();
  const batchId = randomUUID();
  const pageId = randomUUID();
  const teacherId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)", [chapterId, subjectId, 4, "Ch 4", Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,chapter_id,target_count,max_per_page,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [batchId, subjectId, chapterId, 5, 2, "google", "m", "running", teacherId, Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, batchId, 55, 55, "BGS conv 55.png", "match", "pending", "x.png", Date.now()]);

  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => ({ id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const }),
    generatePage: async () => [
      { type: "mcq", difficulty: "easy", prompt: "What is the main river?", options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "The page says so.", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 },
      { type: "mcq", difficulty: "easy", prompt: "What is the capital?", options: ["Dhaka", "Khulna", "Rajshahi", "Sylhet"], answer: "Dhaka", explanation: "Not on the page.", sourceQuote: "Dhaka is the capital of Bangladesh.", marks: 1 },
    ],
    verifyCandidates: async () => [{ index: 0, valid: true }, { index: 1, valid: false, reason: "quote not found" }],
  });

  assert.equal(result.imported, 1);
  assert.equal(result.rejected, 1);
  const rows = await all(db, "SELECT prompt,page_number,source_quote FROM questions WHERE batch_id=?", [batchId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page_number, 55);
  assert.equal(rows[0].source_quote, "The Padma is the main river of Bangladesh.");
  const page = await all(db, "SELECT status FROM batch_pages WHERE id=?", [pageId]);
  assert.equal(page[0].status, "done");
});

test("falls back to the next model after the primary fails", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,fallback_models,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?)`,
    [batchId, subjectId, "google", "primary", JSON.stringify([{ provider: "google", model: "fallback" }]), "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "match", "pending", "x.png", Date.now()]);

  const seen: string[] = [];
  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async (_cfg, model) => {
      seen.push(model);
      if (model === "primary") throw new Error("provider down");
      return [{ type: "mcq", difficulty: "easy", prompt: "What is the main river?", options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "x", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 }];
    },
    verifyCandidates: async () => [{ index: 0, valid: true }],
  });
  assert.equal(result.imported, 1);
  assert.deepEqual(seen, ["primary", "fallback"]);
});

test("three consecutive page failures pause the batch", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  for (const n of [1, 2, 3]) {
    await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), batchId, n, n, `BGS conv ${n}.png`, "match", "pending", "x.png", Date.now()]);
  }
  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  for (let i = 0; i < 3; i++) {
    await runNextPage(batchId, {
      ocrPage: async () => "text",
      getProviderConfig: async () => cfg,
      retry: { attempts: 1, sleep: async () => {} },
      generatePage: async () => { throw new Error("provider down"); },
      verifyCandidates: async () => [],
    });
  }
  const row = await all(db, "SELECT status,consecutive_failures FROM batch_runs WHERE id=?", [batchId]);
  assert.equal(row[0].status, "paused");
  assert.equal(row[0].consecutive_failures, 3);
});
