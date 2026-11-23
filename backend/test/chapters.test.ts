import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get, getDb, run, all } from "../src/db/database";
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
    { number: 4, title: "The Topography and the Climate of Bangladesh", kind: "single", part: null });
});

test("parses Chapter and Ch spellings with different separators", () => {
  assert.deepEqual(parseChapterHeading("Chapter 5 - Photosynthesis"),
    { number: 5, title: "Photosynthesis", kind: "single", part: null });
  assert.deepEqual(parseChapterHeading("Ch 7: The Organs of Government"),
    { number: 7, title: "The Organs of Government", kind: "single", part: null });
});

test("parses a Bengali poricched and converts Bengali digits", () => {
  assert.deepEqual(parseChapterHeading("পরিচ্ছেদ ১০: উপসর্গ দিয়ে শব্দ গঠন"),
    { number: 10, title: "উপসর্গ দিয়ে শব্দ গঠন", kind: "single", part: "poricched" });
});

test("leaves range and multi-poricched titles untouched", () => {
  for (const title of [
    "পরিচ্ছেদ ৩৯-৪৩: বাগর্থ, বাগধারা",
    "পরিচ্ছেদ ১০ ও ১১: উপসর্গ ও প্রত্যয়",
    "পরিচ্ছেদ ১২ ও ১৩: সমাস ও সন্ধি",
  ]) {
    assert.deepEqual(parseChapterHeading(title), { number: null, title, kind: "range", part: "poricched" });
  }
});

test("recognises spaced and symbolic range separators", () => {
  for (const title of [
    "পরিচ্ছেদ ৩৯ - ৪৩: বাগর্থ, বাগধারা",
    "Chapter 3 & 4: Composition",
    "Chapter 3 / 4: Composition",
    "Ch. 12 – 13: Composition",
  ]) {
    const part = title.startsWith("পরিচ্ছেদ") ? "poricched" : null;
    assert.deepEqual(parseChapterHeading(title), { number: null, title, kind: "range", part });
  }
});

test("does not treat an ordinal suffix as a chapter number", () => {
  assert.deepEqual(parseChapterHeading("CH. 21st Century Skills"),
    { number: null, title: "CH. 21st Century Skills", kind: "none", part: null });
  assert.deepEqual(parseChapterHeading("পরিচ্ছেদ ১ম: প্রথম"),
    { number: null, title: "পরিচ্ছেদ ১ম: প্রথম", kind: "none", part: "poricched" });
});

test("parses অধ্যায়, গদ্য and পদ্য headings", () => {
  assert.deepEqual(parseChapterHeading("অধ্যায় ৩: রাষ্ট্রভাষা আন্দোলন"),
    { number: 3, title: "রাষ্ট্রভাষা আন্দোলন", kind: "single", part: "oddhay" });
  assert.deepEqual(parseChapterHeading("গদ্য ১: সুভা"),
    { number: 1, title: "সুভা", kind: "single", part: "godyo" });
  assert.deepEqual(parseChapterHeading("পদ্য ২: বোশেখ"),
    { number: 2, title: "বোশেখ", kind: "single", part: "podyo" });
  // A part word without a number is still a part.
  assert.deepEqual(parseChapterHeading("পদ্য: বোশেখ"),
    { number: null, title: "বোশেখ", kind: "none", part: "podyo" });
});

test("parses উপন্যাস and নাটক headings", () => {
  assert.deepEqual(parseChapterHeading("উপন্যাস: পথের পাঁচালী"),
    { number: null, title: "পথের পাঁচালী", kind: "none", part: "uponnas" });
  assert.deepEqual(parseChapterHeading("নাটক ২: সিরাজউদ্দৌলা"),
    { number: 2, title: "সিরাজউদ্দৌলা", kind: "single", part: "natok" });
});

test("does not read a part word inside a longer word", () => {
  assert.deepEqual(parseChapterHeading("গদ্যাংশ: প্রথম অংশ"),
    { number: null, title: "গদ্যাংশ: প্রথম অংশ", kind: "none", part: null });
});

test("leaves an unprefixed title untouched", () => {
  assert.deepEqual(parseChapterHeading("প্রত্যুপকার"), { number: null, title: "প্রত্যুপকার", kind: "none", part: null });
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

test("creating a chapter stores the part word from the heading", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const res = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ number: 1, title: "গদ্য ৫: সুভা" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.chapter.part, "godyo");
  assert.equal(body.chapter.number, 5);
  assert.equal(body.chapter.title, "সুভা");
  const row = await get(await getDb(), "SELECT part FROM chapters WHERE id=?", [body.chapter.id]);
  assert.equal(row.part, "godyo");
});

test("Bangla 2nd Paper chapters default to পরিচ্ছেদ", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const db = await getDb();
  await run(db, "UPDATE subjects SET code='B2' WHERE id=?", [subjectId]);
  const res = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({ number: 1, title: "বানান শুদ্ধকরণ" }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).chapter.part, "poricched");
});

test("bulk import records the part word when it creates a chapter", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const res = await fetch(`${server.baseUrl}/api/questions/bulk-import`, {
    method: "POST",
    headers: { ...auth(teacher.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_id: subjectId,
      questions: [{
        prompt: "Part word import question",
        type: "mcq",
        options: ["A", "B"],
        answer: "A",
        chapter_title: "অধ্যায় ৩: রাষ্ট্রভাষা আন্দোলন",
      }],
    }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).imported, 1);
  const chapter = await get(await getDb(), "SELECT number, title, part FROM chapters WHERE subject_id=?", [subjectId]);
  assert.equal(Number(chapter.number), 3);
  assert.equal(chapter.title, "রাষ্ট্রভাষা আন্দোলন");
  assert.equal(chapter.part, "oddhay");
});

test("keeps same-numbered গদ্য and পদ্য chapters separate on import", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const rows = [
    { prompt: "গদ্য সুভা প্রশ্ন", chapter_title: "গদ্য ১: সুভা" },
    { prompt: "পদ্য বোশেখ প্রশ্ন", chapter_title: "পদ্য ১: বোশেখ" },
  ];
  for (const row of rows) {
    const res = await fetch(`${server.baseUrl}/api/questions/bulk-import`, {
      method: "POST",
      headers: { ...auth(teacher.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_id: subjectId,
        questions: [{ ...row, type: "mcq", options: ["A", "B"], answer: "A" }],
      }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).imported, 1);
  }
  const chapters = await all(await getDb(),
    "SELECT number, title, part FROM chapters WHERE subject_id=? ORDER BY part", [subjectId]) as any[];
  assert.equal(chapters.length, 2);
  assert.deepEqual(chapters.map((c) => [Number(c.number), c.title, c.part]), [
    [1, "সুভা", "godyo"],
    [1, "বোশেখ", "podyo"],
  ]);
});

test("question list filters by গদ্য / পদ্য", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  for (const row of [
    { prompt: "গদ্য প্রশ্ন এক", chapter_title: "গদ্য ১: সুভা" },
    { prompt: "পদ্য প্রশ্ন এক", chapter_title: "পদ্য ১: বোশেখ" },
    { prompt: "উপন্যাস প্রশ্ন এক", chapter_title: "উপন্যাস: পথের পাঁচালী" },
  ]) {
    const res = await fetch(`${server.baseUrl}/api/questions/bulk-import`, {
      method: "POST",
      headers: { ...auth(teacher.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        subject_id: subjectId,
        questions: [{ ...row, type: "mcq", options: ["A", "B"], answer: "A" }],
      }),
    });
    assert.equal(res.status, 200);
  }

  const list = await fetch(`${server.baseUrl}/api/questions?subject_id=${subjectId}&part=godyo`);
  const body = await list.json();
  assert.equal(body.total, 1);
  assert.equal(body.questions.length, 1);
  assert.equal(body.questions[0].prompt, "গদ্য প্রশ্ন এক");

  const all = await (await fetch(`${server.baseUrl}/api/questions?subject_id=${subjectId}`)).json();
  assert.equal(all.total, 3);

  const novel = await (await fetch(`${server.baseUrl}/api/questions?subject_id=${subjectId}&part=uponnas`)).json();
  assert.equal(novel.total, 1);
  assert.equal(novel.questions[0].prompt, "উপন্যাস প্রশ্ন এক");
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

test("undoing a legacy merge restores a clean title and number", async () => {
  const teacher = await createUser("teacher");
  const subjectId = await createSubject();
  const db = await getDb();
  const canonicalId = randomUUID();
  const restoredId = randomUUID();
  const historyId = randomUUID();
  await run(db, "INSERT INTO chapters (id,subject_id,number,title,created_at) VALUES (?,?,?,?,?)",
    [canonicalId, subjectId, 1, "Canonical chapter", Date.now()]);
  const snapshot = JSON.stringify({
    duplicates: [{
      id: restoredId,
      subject_id: subjectId,
      number: 1,
      title: "CH. 11: The Economic Indicators",
      title_bn: "CH. 11: The Economic Indicators",
      summary: null,
      created_at: Date.now(),
    }],
    movedByChapter: {},
  });
  await run(db, "INSERT INTO chapter_merge_history (id,subject_id,canonical_id,data,created_at) VALUES (?,?,?,?,?)",
    [historyId, subjectId, canonicalId, snapshot, Date.now()]);

  const res = await fetch(`${server.baseUrl}/api/subjects/${subjectId}/chapters/merges/${historyId}/undo`, {
    method: "POST",
    headers: auth(teacher.token),
  });
  assert.equal(res.status, 200);

  const restored = await get(db, "SELECT number, title, title_bn FROM chapters WHERE id=?", [restoredId]);
  assert.equal(restored.number, 11);
  assert.equal(restored.title, "The Economic Indicators");
  assert.equal(restored.title_bn, "The Economic Indicators");
});
