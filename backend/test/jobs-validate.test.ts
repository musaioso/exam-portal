import test from "node:test";
import assert from "node:assert/strict";
import { validateMcq, validatePassage, validateWritten } from "../src/services/jobs/validate";

test("maps an A/B/C/D answer to the option text", () => {
  const row = validateMcq({ prompt: "Q", options: ["Alpha", "Beta", "Gamma", "Delta"], answer: "B" });
  assert.equal(row.answer, "Beta");
});

test("rejects wrong option counts and duplicate options", () => {
  assert.throws(() => validateMcq({ prompt: "Q", options: ["A", "B", "C"], answer: "A" }), /exactly 4 unique options/);
  assert.throws(() => validateMcq({ prompt: "Q", options: ["A", "A", "B", "C"], answer: "A" }), /exactly 4 unique options/);
});

test("rejects an answer that is not one of the options", () => {
  assert.throws(() => validateMcq({ prompt: "Q", options: ["A", "B", "C", "D"], answer: "Z" }), /must be one of the 4 options/);
});

test("rejects options on a written question", () => {
  assert.throws(() => validateWritten({ prompt: "Q", options: ["A", "B"] }), /must not have options/);
});

test("accepts a passage with the pattern's part count and rejects a mismatch", () => {
  const parts = [{ question: "Q1", answer: "A1", scheme: "S1" }, { question: "Q2", answer: "A2", scheme: "S2" }];
  const row = validatePassage({ stem: "Stem", parts }, [3, 7]);
  assert.equal(row.parts.length, 2);
  assert.throws(() => validatePassage({ stem: "Stem", parts: [parts[0]] }, [3, 7]), /expected 2 parts/);
  assert.throws(
    () => validatePassage({ stem: "Stem", parts: [{ ...parts[0], marks: 5 }, parts[1]] }, [3, 7]),
    /marks do not match the pattern/
  );
  assert.throws(() => validatePassage({ stem: "", parts }, [3, 7]), /stem is required/);
});
