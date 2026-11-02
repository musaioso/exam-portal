import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get, getDb, run } from "../src/db/database";
import { parseChapterHeading } from "../src/lib/chapter";
import { auth, createUser, startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

async function createSubject() {
  const db = await getDb();
  const id = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)",
    [id, "Test Subject", `s-${id}`, Date.now()]);
  return id;
}

test("parses an English CH. prefix and zero-padded number", () => {
  assert.deepEqual(parseChapterHeading("CH. 04: The Topography and the Climate of Bangladesh"),
    { number: 4, title: "The Topography and the Climate of Bangladesh" });
});

test("parses Chapter and Ch spellings with different separators", () => {
  assert.deepEqual(parseChapterHeading("Chapter 5 - Photosynthesis"),
    { number: 5, title: "Photosynthesis" });
  assert.deepEqual(parseChapterHeading("Ch 7: The Organs of Government"),
    { number: 7, title: "The Organs of Government" });
});

test("parses a Bengali poricched and converts Bengali digits", () => {
  assert.deepEqual(parseChapterHeading("পরিচ্ছেদ ১০: উপসর্গ দিয়ে শব্দ গঠন"),
    { number: 10, title: "উপসর্গ দিয়ে শব্দ গঠন" });
});

test("leaves range and multi-poricched titles untouched", () => {
  for (const title of [
    "পরিচ্ছেদ ৩৯-৪৩: বাগর্থ, বাগধারা",
    "পরিচ্ছেদ ১০ ও ১১: উপসর্গ ও প্রত্যয়",
    "পরিচ্ছেদ ১২ ও ১৩: সমাস ও সন্ধি",
  ]) {
    assert.deepEqual(parseChapterHeading(title), { number: null, title });
  }
});

test("leaves an unprefixed title untouched", () => {
  assert.deepEqual(parseChapterHeading("প্রত্যুপকার"), { number: null, title: "প্রত্যুপকার" });
});

test("creating a chapter takes its number from the title and strips the prefix", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const res = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      number: 1,
      title: "CH. 11: The Economic Indicators and the Nature of the Economy of Bangladesh",
      title_bn: "CH. 11: The Economic Indicators and the Nature of the Economy of Bangladesh",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.chapter.number, 11);
  assert.equal(body.chapter.title, "The Economic Indicators and the Nature of the Economy of Bangladesh");

  const list = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters`);
  const chapters = (await list.json()).chapters;
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].number, 11);
  assert.equal(chapters[0].title, "The Economic Indicators and the Nature of the Economy of Bangladesh");
});

test("creating a range chapter keeps its title and explicit number", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const title = "পরিচ্ছেদ ১০ ও ১১: উপসর্গ ও প্রত্যয় দিয়ে শব্দ গঠন";
  const res = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ number: 42, title }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.chapter.number, 42);
  assert.equal(body.chapter.title, title);
});

test("updating a chapter takes its number from the new title", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const db = await getDb();
  const id = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [id, subjectId, 1, "Old title", Date.now()]);

  const res = await fetch(`${server.baseUrl}/api/subjects/chapters/${id}`, {
    method: "PUT",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ number: 1, title: "CH. 06: The State, Citizenship and Law" }),
  });
  assert.equal(res.status, 200);
  const row = await get(db, "SELECT number, title FROM chapters WHERE id=?", [id]);
  assert.equal(row.number, 6);
  assert.equal(row.title, "The State, Citizenship and Law");
});

test("bulk import reuses one chapter keyed by the title number, not the supplied number", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const chapterTitle = "CH. 04: The Topography and the Climate of Bangladesh";

  const first = await fetch(`${server.baseUrl}/api/questions/bulk-import`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_id: subjectId,
      questions: [{
        prompt: "First topography question",
        type: "mcq",
        options: ["A", "B"],
        answer: "A",
        chapter_title: chapterTitle,
        chapter_number: 1,
      }],
    }),
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).imported, 1);

  const second = await fetch(`${server.baseUrl}/api/questions/bulk-import`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_id: subjectId,
      questions: [{
        prompt: "Second topography question",
        type: "mcq",
        options: ["A", "B"],
        answer: "A",
        chapter_title: chapterTitle,
        chapter_number: 2,
      }],
    }),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).imported, 1);

  const db = await getDb();
  const chapters = await get(db, "SELECT COUNT(*) AS n FROM chapters WHERE subject_id=?", [subjectId]);
  assert.equal(Number(chapters.n), 1);
  const chapter = await get(db, "SELECT id, number, title FROM chapters WHERE subject_id=?", [subjectId]);
  assert.equal(Number(chapter.number), 4);
  assert.equal(chapter.title, "The Topography and the Climate of Bangladesh");
  const linked = await get(db, "SELECT COUNT(*) AS n FROM questions WHERE chapter_id=?", [chapter.id]);
  assert.equal(Number(linked.n), 2);
});

test("renumber endpoint fixes English prefixes and strips them from titles", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const db = await getDb();
  const singleId = randomUUID();
  const rangeId = randomUUID();
  const rangeTitle = "পরিচ্ছেদ ১২ ও ১৩: সমাস ও সন্ধি";
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [singleId, subjectId, 1, "CH. 09: The United Nations and Bangladesh", Date.now()]);
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [rangeId, subjectId, 43, rangeTitle, Date.now()]);

  const res = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters/renumber`, {
    method: "POST",
    headers: auth(teacher.token),
  });
  assert.equal(res.status, 200);

  const single = await get(db, "SELECT number, title FROM chapters WHERE id=?", [singleId]);
  assert.equal(single.number, 9);
  assert.equal(single.title, "The United Nations and Bangladesh");
  const range = await get(db, "SELECT number, title FROM chapters WHERE id=?", [rangeId]);
  assert.equal(range.number, 43);
  assert.equal(range.title, rangeTitle);
});
