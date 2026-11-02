import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { AIError } from "../src/services/ai/types";
import { isRetryableAIError, withRetry } from "../src/services/batch/retry";

test("503 and rate-limit 429 are retryable; quota 429 is not", () => {
  assert.equal(isRetryableAIError(new AIError("busy", 503)), true);
  assert.equal(isRetryableAIError(new AIError("slow down", 429)), true);
  assert.equal(isRetryableAIError(new AIError("outside your plan quota", 429)), false);
  assert.equal(isRetryableAIError(new AIError("bad request", 400)), false);
});

test("withRetry succeeds on the third attempt and records delays", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await withRetry(
    async () => { calls++; if (calls < 3) throw new AIError("overloaded", 503); return "ok"; },
    { attempts: 3, delaysMs: [2, 8], sleep: async (ms) => { delays.push(ms); } }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2, 8]);
});

test("withRetry stops immediately on a quota error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new AIError("billing quota", 429); }, { sleep: async () => {} }),
    /billing quota/
  );
  assert.equal(calls, 1);
});

test("modelChain puts the primary first", async () => {
  const { modelChain } = await import("../src/services/batch/retry");
  assert.deepEqual(modelChain({ id: "a" }, [{ id: "b" }, { id: "c" }]).map((m) => m.id), ["a", "b", "c"]);
});
