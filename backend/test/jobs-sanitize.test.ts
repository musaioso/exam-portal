import test from "node:test";
import assert from "node:assert/strict";
import { parseReply, sanitizeReply } from "../src/services/jobs/sanitize";

test("strips fences, prose and citation markers", () => {
  const raw = 'Here are your questions:\n```json\n{"questions":[{"prompt":"What is the Padma [1]?","options":["A","B","C","D"],"answer":"A"}]}\n```\nHope this helps.';
  const value = parseReply(raw) as any;
  assert.equal(value.questions.length, 1);
  assert.equal(value.questions[0].prompt, "What is the Padma?");
});

test("repairs trailing commas and curly quotes", () => {
  const raw = '{“questions”:[{“prompt”:“Q”,“options”:[“A”,“B”,“C”,“D”,],“answer”:“A”,},]}';
  const value = parseReply(raw) as any;
  assert.deepEqual(value.questions[0].options.slice(0, 2), ["A", "B"]);
});

test("throws a readable error for garbage", () => {
  assert.throws(() => parseReply("no json here"), /does not contain valid JSON/);
});

test("leaves valid JSON untouched", () => {
  const valid = '{"questions":[]}';
  assert.equal(sanitizeReply(valid), valid);
});
