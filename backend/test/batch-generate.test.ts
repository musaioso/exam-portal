import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { generatePage, parseStrictReply } from "../src/services/batch/generate";

const good = {
  difficulty: "easy",
  prompt: "What is the main river of Bangladesh?",
  options: ["Padma", "Jamuna", "Karnaphuli", "Meghna"],
  answer: "Padma",
  explanation: "The source names the Padma as the main river.",
  sourceQuote: "The Padma is the main river of Bangladesh.",
  marks: 1,
};

test("parseStrictReply accepts a valid item and drops a page field", () => {
  const items = parseStrictReply(JSON.stringify([{ ...good, page_number: 57 }]));
  assert.equal(items.length, 1);
  assert.equal("page_number" in items[0], false);
  assert.equal(items[0].answer, "Padma");
});

test("parseStrictReply preserves the section heading", () => {
  const items = parseStrictReply(JSON.stringify([{ ...good, section: "Climate of Bangladesh" }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].section, "Climate of Bangladesh");
});

test("parseStrictReply preserves a one-step derivation", () => {
  const items = parseStrictReply(JSON.stringify([{
    ...good,
    answer: "40000",
    options: ["40000", "30000", "50000", "60000"],
    derivation: "80000 / 2 = 40000",
  }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].derivation, "80000 / 2 = 40000");
});

test("parseStrictReply rejects page attribution and bad options", () => {
  assert.equal(parseStrictReply(JSON.stringify([{ ...good, prompt: "According to page 57, what is the river?" }])).length, 0);
  assert.equal(parseStrictReply(JSON.stringify([{ ...good, options: ["Padma", "Padma", "A", "B"] }])).length, 0);
  assert.equal(parseStrictReply(JSON.stringify([{ ...good, answer: "Brahmaputra" }])).length, 0);
});

test("generatePage sends exactly one page image and stamps nothing", async () => {
  let seen: any;
  const items = await generatePage(
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "fake-model",
    Buffer.from("png"),
    "image/png",
    { pageNumber: 57, chapterTitle: "CH. 04: Topography", maxQuestions: 5 },
    { chat: async (_cfg, _model, messages) => { seen = messages; return { text: JSON.stringify([good]) }; } }
  );
  assert.equal(items.length, 1);
  const user = seen.find((m: any) => m.role === "user");
  assert.equal(user.images.length, 1);
  assert.equal(user.images[0].mimeType, "image/png");
});
