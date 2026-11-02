import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { parsePageNumberFromFilename, inferOpenerPage, auditPages } from "../src/services/batch/pages";

test("parses the page number from a conv filename", () => {
  assert.equal(parsePageNumberFromFilename("BGS conv 55.png"), 55);
  assert.equal(parsePageNumberFromFilename("BGS-conv-166.jpg"), 166);
  assert.equal(parsePageNumberFromFilename("random.png"), null);
});

test("infers an unnumbered opener from its neighbour", () => {
  assert.deepEqual(inferOpenerPage(55, null, 56), { number: 55, reason: "agreed" });
  assert.deepEqual(inferOpenerPage(null, null, 56), { number: 55, reason: "next" });
  assert.deepEqual(inferOpenerPage(null, 54, null), { number: 55, reason: "previous" });
  assert.deepEqual(inferOpenerPage(null, null, null), { number: null, reason: "none" });
});

test("audit marks match, mismatch, and unnumbered", async () => {
  const pages = [
    { sourceFile: "BGS conv 55.png", image: Buffer.from("55"), mimeType: "image/png", filenameNumber: 55 },
    { sourceFile: "BGS conv 56.png", image: Buffer.from("56"), mimeType: "image/png", filenameNumber: 56 },
    { sourceFile: "BGS conv 57.png", image: Buffer.from("57"), mimeType: "image/png", filenameNumber: 57 },
  ];
  const result = await auditPages(pages, {
    readNumbers: async (image) => image === pages[0].image ? [55] : image === pages[1].image ? [57] : [],
  });
  assert.equal(result[0].auditStatus, "match");
  assert.equal(result[1].auditStatus, "mismatch");
  assert.equal(result[1].printedNumber, 57);
  assert.equal(result[2].auditStatus, "unnumbered");
  assert.equal(result[2].proposedNumber, 57);
});
