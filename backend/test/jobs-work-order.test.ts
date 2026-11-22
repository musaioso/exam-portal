import test from "node:test";
import assert from "node:assert/strict";
import { renderWorkOrder } from "../src/services/jobs/work-order";

const base = {
  job: { exam_label: "SSC 2027" } as any,
  subject: { code: "BGS", name: "Bangladesh and Global Studies" },
  chapter: { number: 3, title: "The Political Movement" },
  pattern: { id: "p", name: "SSC CQ (default)", subject_id: null, chapter_match: null, is_default: 1,
    parts: [
      { kind: "mcq", marks: 1 },
      { kind: "passage", parts: [{ kind: "long", marks: 1 }, { kind: "long", marks: 2 }, { kind: "long", marks: 3 }, { kind: "long", marks: 4 }] },
      { kind: "short", marks: 2 },
    ] } as any,
};

test("renders an MCQ work order with the avoid list and no fences", () => {
  const text = renderWorkOrder({ ...base, kind: "mcq", count: 20, remaining: 40, avoid: ["Old question one", "Old question two"] });
  assert.match(text, /SSC 2027/);
  assert.match(text, /class 9–10/);
  assert.match(text, /BGS/);
  assert.match(text, /Chapter 3: The Political Movement/);
  assert.match(text, /"options"/);
  assert.match(text, /exactly 4/);
  assert.match(text, /Old question one/);
  assert.match(text, /Write 20/);
  assert.match(text, /fewer rather than invent/);
  assert.doesNotMatch(text, /```/);
});

test("renders a passage work order with part marks but never part text", () => {
  const text = renderWorkOrder({ ...base, kind: "passage", count: 6, remaining: 12,
    avoid: ["রহিম গ্রামে থাকে।"] });
  assert.match(text, /"passages"/);
  assert.match(text, /"stem"/);
  assert.match(text, /"parts"/);
  assert.match(text, /1 mark/);
  assert.match(text, /4 marks/);
  assert.match(text, /রহিম গ্রামে থাকে।/);
});

test("omits options for a short work order", () => {
  const text = renderWorkOrder({ ...base, kind: "short", count: 10, remaining: 10, avoid: [] });
  assert.doesNotMatch(text, /"options"/);
  assert.match(text, /2 marks/);
});
