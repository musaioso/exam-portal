import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, get, run } from "../src/db/database";
import { auth, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
let subjectId = "";
let chapterId = "";

before(async () => {
  server = await startServer();
  const db = await getDb();
  subjectId = randomUUID();
  chapterId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,code,created_at) VALUES (?,?,?,?,?)",
    [subjectId, "NotebookLM Test", `nlm-${subjectId}`, "BGSX", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [chapterId, subjectId, 1, "Chapter One", Date.now()]);
});
after(async () => { await server.close(); });

async function importFile(body: any) {
  const teacher = await createUser("teacher");
  return fetch(`${server.baseUrl}/api/questions/bulk-import`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("imports the NotebookLM shape with subject code, quote and derivation", async () => {
  const prompt = "What is the Padma? " + randomUUID();
  const res = await importFile({
    format: "notebooklm-mcq-v1",
    subject_code: "BGSX",
    chapter_number: 1,
    questions: [{
      prompt,
      options: ["A river", "A mountain", "A city", "A lake"],
      answer: "A river",
      explanation: "The page names the Padma.",
      page_number: 12,
      section: "Rivers",
      source_quote: "The Padma is the main river of Bangladesh.",
      derivation: "80000 / 2 = 40000",
      difficulty: "easy",
      marks: 2,
    }],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 1);
  assert.equal(body.format, "notebooklm-mcq-v1");

  const db = await getDb();
  const q = await get(db, "SELECT * FROM questions WHERE prompt=?", [prompt]);
  assert.equal(q.subject_id, subjectId);
  assert.equal(q.chapter_id, chapterId);
  assert.equal(q.page_number, 12);
  assert.equal(q.section, "Rivers");
  assert.equal(q.source_quote, "The Padma is the main river of Bangladesh.");
  assert.match(q.explanation, /Derived: 80000 \/ 2 = 40000/);
  assert.equal(q.marks, 2);

  const again = await importFile({
    format: "notebooklm-mcq-v1",
    subject_code: "BGSX",
    chapter_number: 1,
    questions: [{ prompt, options: ["A", "B", "C", "D"], answer: "A" }],
  });
  assert.equal((await again.json()).skipped, 1);
});

test("maps an A/B/C/D answer to the option text", async () => {
  const prompt = "Pick Beta " + randomUUID();
  const res = await importFile({
    format: "notebooklm-mcq-v1",
    subject_code: "BGSX",
    chapter_number: 1,
    questions: [{
      prompt,
      options: ["Alpha", "Beta", "Gamma", "Delta"],
      answer: "B",
    }],
  });
  assert.equal((await res.json()).imported, 1);
  const db = await getDb();
  const q = await get(db, "SELECT answer FROM questions WHERE prompt=?", [prompt]);
  assert.equal(q.answer, "Beta");
});

test("rejects a NotebookLM row without exactly four unique options", async () => {
  const res = await importFile({
    format: "notebooklm-mcq-v1",
    subject_code: "BGSX",
    chapter_number: 1,
    questions: [{
      prompt: "Three options only " + randomUUID(),
      options: ["A", "B", "C"],
      answer: "A",
    }],
  });
  const body = await res.json();
  assert.equal(body.failed, 1);
  assert.match(body.errors[0].error, /exactly 4 unique options/);
});
