import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { pickPages } from "../src/services/batch/page-search";

test("the exact answer phrase outranks pages that only share prompt words", () => {
  const pages = [
    { pageNumber: 10, text: "The Jamuna is a river. East Pakistan and West Pakistan are discussed." },
    { pageNumber: 20, text: "The Padma is the main river of Bangladesh." },
    { pageNumber: 30, text: "Rivers of East Pakistan." },
  ];
  const question = { prompt: "What is the main river of Bangladesh?", answer: "Padma" };

  const withClaimed = pickPages(question, pages, { claimedPage: 10, maxPages: 3 });
  assert.equal(withClaimed[0].pageNumber, 10);
  assert.equal(withClaimed[1].pageNumber, 20);

  const ranked = pickPages(question, pages, { maxPages: 1 });
  assert.equal(ranked[0].pageNumber, 20);
});
