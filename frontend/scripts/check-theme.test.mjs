import test from "node:test";
import assert from "node:assert/strict";
import {
  extractColourVars,
  findColourTokens,
  findHardcodedColours,
  findRawSelects,
  maskComments,
} from "./check-theme.mjs";

test("matches side, axis, and offset colour utilities", () => {
  const tokens = findColourTokens(
    'className="border-t-sky-500/40 divide-x-slate-700 ring-offset-slate-900"',
  ).map((item) => item.token);
  assert.deepEqual(tokens.sort(), [
    "border-t-sky-500",
    "divide-x-slate-700",
    "ring-offset-slate-900",
  ]);
});

test("keeps the utility prefix and strips the character before it", () => {
  const [token] = findColourTokens('className="bg-slate-900"');
  assert.equal(token.token, "bg-slate-900");
  assert.equal(token.pair, "slate-900");
});

test("finds colour tokens inside static template text", () => {
  const tokens = findColourTokens("const c = `bg-slate-900 ${x}`;").map((item) => item.pair);
  assert.deepEqual(tokens, ["slate-900"]);
});

test("ignores colour tokens and raw selects in comments", () => {
  const source = "// do not use <select> or bg-fuchsia-900 here\n/* #fff and hsl(0 0% 0%) */\nconst x = 1;";
  assert.deepEqual(findColourTokens(source), []);
  assert.deepEqual(findRawSelects(source), []);
  assert.deepEqual(findHardcodedColours(source), []);
});

test("ignores raw selects inside strings", () => {
  assert.deepEqual(findRawSelects('const label = "<select> is banned";'), []);
});

test("finds a real JSX raw select", () => {
  assert.equal(findRawSelects('return (<select className="x">hello</select>);').length, 1);
});

test("catches hex, rgb, hsl, and oklch literals", () => {
  const values = findHardcodedColours(
    'const a = "#fff"; const b = "rgb(0 0 0)"; const c = "hsl(0 0% 0%)"; const d = "oklch(0.5 0 0)";',
  ).map((item) => item.value);
  assert.deepEqual(values, ["#fff", "rgb(", "hsl(", "oklch("]);
});

test("does not treat commented-out theme variables as defined", () => {
  assert.equal(extractColourVars(maskComments("/* --color-sky-200: #99f6e4; */")).size, 0);
  assert.ok(extractColourVars(maskComments("--color-sky-200: #99f6e4;")).has("sky-200"));
});
