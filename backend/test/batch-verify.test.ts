import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { isQuoteOnPage, missingNumbers, verifyCandidates } from "../src/services/batch/verify";

test("quote matching tolerates OCR noise", () => {
  const page = "The climate of Bangladesh is on the whole equable.";
  assert.equal(isQuoteOnPage(page, "The climate of Bangladesh is on the whole equable."), true);
  assert.equal(isQuoteOnPage(page, "climate of Bangladash is on the whole equable"), true);
  assert.equal(isQuoteOnPage(page, "The Padma is the main river."), false);
});

test("every numeric token must appear on the page", () => {
  assert.deepEqual(missingNumbers("In 2022 the rate was 7.1 percent.", "What was the rate in 2023?"), ["2023"]);
  assert.deepEqual(missingNumbers("In 2022 the rate was 7.1 percent.", "What was the rate in 2022?"), []);
  assert.deepEqual(missingNumbers("In 2022 the rate was 7.1 percent.", "Was it 22?"), ["22"]);
  assert.deepEqual(missingNumbers("In 2022 the rate was 7.1 percent.", "Was it 7.1?"), []);
});

test("a derived answer may use a result number that is not on the page", async () => {
  const verdicts = await verifyCandidates({
    pageText: "The panel had 80000 members from both East and West Pakistan.",
    image: Buffer.from("png"),
    mimeType: "image/png",
    candidates: [{
      type: "mcq", difficulty: "easy",
      prompt: "Half of the 80000 members came from East Pakistan. How many came from East Pakistan?",
      options: ["40000", "30000", "50000", "60000"], answer: "40000",
      explanation: "Half of 80000.", sourceQuote: "The panel had 80000 members from both East and West Pakistan.",
      derivation: "80000 / 2 = 40000", marks: 1,
    }],
    cfg: { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    model: "fake-model",
    deps: { chat: async () => ({ text: '[{"index":0,"valid":true}]' }) },
  });
  assert.equal(verdicts[0].valid, true);
});

test("verifyCandidates rejects when the verifier says invalid", async () => {
  const verdicts = await verifyCandidates({
    pageText: "The Padma is the main river of Bangladesh.",
    image: Buffer.from("png"),
    mimeType: "image/png",
    candidates: [{
      type: "mcq", difficulty: "easy", prompt: "What is the main river?",
      options: ["Padma", "Jamuna", "Meghna", "Karnaphuli"], answer: "Padma",
      explanation: "The page says so.", sourceQuote: "The Padma is the main river of Bangladesh.", marks: 1,
    }],
    cfg: { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    model: "fake-model",
    deps: { chat: async () => ({ text: '[{"index":0,"valid":false,"reason":"answer not supported"}]' }) },
  });
  assert.equal(verdicts[0].valid, false);
});
