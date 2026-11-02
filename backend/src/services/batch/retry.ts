import { AIError } from "../ai/types";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function isRetryableAIError(err: unknown): boolean {
  if (err instanceof AIError) {
    if (/quota|billing|plan/i.test(err.message)) return false;
    return RETRYABLE.has(err.status);
  }
  return true; // network errors and unknown transport failures
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    delaysMs?: number[];
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, err: unknown) => void;
  } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [2000, 8000, 30000];
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryableAIError(err) || i === attempts - 1) throw err;
      opts.onRetry?.(i + 1, err);
      await sleep(delays[Math.min(i, delays.length - 1)]);
    }
  }
  throw last;
}

export function modelChain<T>(primary: T, fallbacks: T[]): T[] {
  return [primary, ...fallbacks];
}
