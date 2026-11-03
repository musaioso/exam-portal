import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { auditQuestion } from "../src/services/batch/correct";

test("a wrong page is proposed without touching the question", async () => {
  const question = {
    id: "q1", prompt: "What is the main river?", options: JSON.stringify(["Padma", "Jamuna", "Meghna", "Karnaphuli"]),
    answer: "Padma", page_number: 55, explanation: "x",
  };
  const result = await auditQuestion(
    question,
    { pageNumber: 55, text: "The Padma is the main river of Bangladesh.", image: Buffer.from("png") },
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "m",
    { chat: async () => ({ text: '{"supported":true,"quote":"The Padma is the main river of Bangladesh."}' }) }
  );
  assert.equal(result.verdict, "ok");
  assert.equal(result.proposed, null);
  assert.ok(result.evidence.quote.includes("Padma"));
});

test("a one-step derived numeric answer is accepted", async () => {
  const question = {
    id: "q4",
    prompt: "Half of the 80000 members came from East Pakistan. How many came from East Pakistan?",
    options: JSON.stringify(["40000", "30000", "50000", "60000"]),
    answer: "40000", page_number: 10, explanation: "x",
  };
  const result = await auditQuestion(
    question,
    {
      pageNumber: 10,
      text: "The panel had 80000 members from both East and West Pakistan.",
      image: Buffer.from("png"),
    },
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "m",
    {
      chat: async () => ({
        text: JSON.stringify({
          supported: false,
          quote: "The panel had 80000 members from both East and West Pakistan.",
          derived: true,
          derivation: "80000 / 2 = 40000",
        }),
      }),
    }
  );
  assert.equal(result.verdict, "ok");
  assert.equal(result.evidence.derived, true);
  assert.equal(result.evidence.derivation, "80000 / 2 = 40000");
});

test("a verifier that echoes the keyed answer is not a correction", async () => {
  const question = {
    id: "q3", prompt: "What is the main river?", options: JSON.stringify(["Padma", "Jamuna", "Meghna", "Karnaphuli"]),
    answer: "Padma", page_number: 55, explanation: "x",
  };
  const result = await auditQuestion(
    question,
    { pageNumber: 55, text: "The page says nothing about the answer.", image: Buffer.from("png") },
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "m",
    { chat: async () => ({ text: '{"supported":false,"correctAnswer":"Padma"}' }) }
  );
  assert.equal(result.verdict, "not_found");
  assert.equal(result.proposed, null);
});

test("a manual-edit verdict carries no applyable proposal", async () => {
  const question = {
    id: "q2", prompt: "What is the main river?", options: JSON.stringify(["Padma", "Jamuna", "Meghna", "Karnaphuli"]),
    answer: "Padma", page_number: 55, explanation: "x",
  };
  const result = await auditQuestion(
    question,
    { pageNumber: 55, text: "The page says nothing about the answer.", image: Buffer.from("png") },
    { id: "fake", label: "Fake", baseURL: "http://fake", chatStyle: "google" },
    "m",
    { chat: async () => ({ text: '{"supported":false,"correctAnswer":"Brahmaputra"}' }) }
  );
  assert.equal(result.verdict, "needs manual edit");
  assert.equal(result.proposed, null);
  assert.equal(result.evidence.correctAnswer, "Brahmaputra");
});
