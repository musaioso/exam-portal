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
