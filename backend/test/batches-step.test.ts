import "./env";
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { migrate } from "../src/db/migrate";
import { AIError } from "../src/services/ai/types";
import { runNextPage } from "../src/services/batch/run";

const testImage = path.join(os.tmpdir(), `batch-step-${Date.now()}.png`);
before(async () => {
  fs.writeFileSync(testImage, Buffer.from("png"));
  await migrate();
});

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
    VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, batchId, 55, 55, "BGS conv 55.png", "match", "pending", testImage, Date.now()]);

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
    [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "match", "pending", testImage, Date.now()]);

  const seen: string[] = [];
  let verifiedWith = "";
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
    verifyCandidates: async (args) => {
      verifiedWith = args.model;
      return [{ index: 0, valid: true }];
    },
  });
  assert.equal(result.imported, 1);
  assert.deepEqual(seen, ["primary", "fallback"]);
  assert.equal(verifiedWith, "fallback");
});

test("a quota failure pauses the batch immediately", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "match", "pending", testImage, Date.now()]);

  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const result = await runNextPage(batchId, {
    ocrPage: async () => "text",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async () => { throw new AIError("outside your plan quota", 429); },
    verifyCandidates: async () => [],
  });
  assert.equal(result.status, "paused");
  const row = await all(db, "SELECT status FROM batch_runs WHERE id=?", [batchId]);
  assert.equal(row[0].status, "paused");
});

test("a confirmed page correction is stamped on saved rows", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 56, "BGS conv 55.png", "confirmed", "pending", testImage, Date.now()]);

  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async () => [{ type: "mcq", difficulty: "easy", prompt: "What is the main river?", options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "x", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 }],
    verifyCandidates: async () => [{ index: 0, valid: true }],
  });
  assert.equal(result.imported, 1);
  const rows = await all(db, "SELECT page_number,page FROM questions WHERE batch_id=?", [batchId]);
  assert.equal(rows[0].page_number, 56);
  assert.equal(rows[0].page, "56");
});

test("a missing page image fails before any provider call", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  const pageId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, batchId, 55, 55, "BGS conv 55.png", "match", "pending", "missing-page.png", Date.now()]);

  let called = false;
  const result = await runNextPage(batchId, {
    ocrPage: async () => "text",
    getProviderConfig: async () => ({ id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const }),
    generatePage: async () => { called = true; return []; },
    verifyCandidates: async () => [],
  });
  assert.equal(called, false);
  assert.equal(result.imported, 0);
  const page = await all(db, "SELECT status,last_error FROM batch_pages WHERE id=?", [pageId]);
  assert.equal(page[0].status, "failed");
  assert.match(String(page[0].last_error), /missing or unreadable/);
});

test("a verifier failure marks the page failed instead of aborting the step", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  const pageId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [pageId, batchId, 55, 55, "BGS conv 55.png", "match", "pending", testImage, Date.now()]);

  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async () => [{ type: "mcq", difficulty: "easy", prompt: "What is the main river?", options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "x", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 }],
    verifyCandidates: async () => { throw new Error("verifier 503"); },
  });
  assert.equal(result.imported, 0);
  const page = await all(db, "SELECT status,last_error FROM batch_pages WHERE id=?", [pageId]);
  assert.equal(page[0].status, "failed");
  assert.match(String(page[0].last_error), /verifier 503/);
});

test("tops up completed pages until the target is reached", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,target_count,max_per_page,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", 2, 1, "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "confirmed", "pending", testImage, Date.now()]);

  let calls = 0;
  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const deps = {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async () => {
      calls++;
      return [{ type: "mcq" as const, difficulty: "easy" as const, prompt: `Question ${calls}?`, options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "x", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1 }];
    },
    verifyCandidates: async () => [{ index: 0, valid: true }],
  };

  await runNextPage(batchId, deps);
  await runNextPage(batchId, deps);
  await runNextPage(batchId, deps);

  const runRow = await all(db, "SELECT saved,status FROM batch_runs WHERE id=?", [batchId]);
  assert.equal(runRow[0].saved, 2);
  assert.equal(runRow[0].status, "done");
  const pages = await all(db, "SELECT attempts,status FROM batch_pages WHERE batch_id=?", [batchId]);
  assert.equal(pages[0].attempts, 2);
  assert.equal(pages[0].status, "done");
});

test("caps a page at the remaining target", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,target_count,max_per_page,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", 2, 5, "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "confirmed", "pending", testImage, Date.now()]);

  const cfg = { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" as const };
  const result = await runNextPage(batchId, {
    ocrPage: async () => "The Padma is the main river of Bangladesh.",
    getProviderConfig: async () => cfg,
    retry: { attempts: 1, sleep: async () => {} },
    generatePage: async () => [1, 2, 3].map((n) => ({
      type: "mcq" as const, difficulty: "easy" as const, prompt: `Question ${n}?`,
      options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma", explanation: "x",
      sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1,
    })),
    verifyCandidates: async () => [{ index: 0, valid: true }, { index: 1, valid: true }, { index: 2, valid: true }],
  });

  assert.equal(result.imported, 2);
  const rows = await all(db, "SELECT id FROM questions WHERE batch_id=?", [batchId]);
  assert.equal(rows.length, 2);
  const runRow = await all(db, "SELECT saved,status FROM batch_runs WHERE id=?", [batchId]);
  assert.equal(runRow[0].saved, 2);
  assert.equal(runRow[0].status, "done");
});

test("a live lease returns waiting, not done", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,lease_until,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, 55, "BGS conv 55.png", "match", "running", Date.now() + 60_000, testImage, Date.now()]);

  const result = await runNextPage(batchId);
  assert.equal(result.status, "waiting");
  const row = await all(db, "SELECT status FROM batch_runs WHERE id=?", [batchId]);
  assert.equal(row[0].status, "running");
});

test("unresolved pages return blocked", async () => {
  const db = await getDb();
  const subjectId = randomUUID();
  const batchId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)", [subjectId, "S", `s-${subjectId}`, Date.now()]);
  await run(db, `INSERT INTO batch_runs (id,subject_id,provider,model,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?)`, [batchId, subjectId, "google", "m", "running", "t", Date.now()]);
  await run(db, `INSERT INTO batch_pages (id,batch_id,page_number,resolved_page_number,source_file,audit_status,status,image_path,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), batchId, 55, null, "BGS conv 55.png", "unnumbered", "pending", testImage, Date.now()]);

  const result = await runNextPage(batchId);
  assert.equal(result.status, "blocked");
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
      [randomUUID(), batchId, n, n, `BGS conv ${n}.png`, "match", "pending", testImage, Date.now()]);
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
