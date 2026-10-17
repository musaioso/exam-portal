/**
 * Tiny in-memory attempt limiter for the student PIN.
 *
 * Serverless instances each keep their own map, so this is a speed bump rather
 * than a wall — but it is more than enough to stop somebody guessing a 4-digit
 * PIN by hand (or with a small script) inside one class period.
 */
const failures = new Map<string, number[]>();

/** How many failures before we start refusing, and for how long we remember them. */
export const PIN_MAX_FAILURES = 8;
export const PIN_WINDOW_MS = 10 * 60 * 1000;

function prune(now: number) {
  for (const [key, times] of failures) {
    const recent = times.filter((t) => now - t < PIN_WINDOW_MS);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
  }
}

function recentFor(key: string, now: number) {
  return (failures.get(key) || []).filter((t) => now - t < PIN_WINDOW_MS);
}

/** True once this key has burned through its attempts. */
export function isBlocked(key: string) {
  const now = Date.now();
  const recent = recentFor(key, now);
  if (recent.length) failures.set(key, recent);
  else failures.delete(key);
  return recent.length >= PIN_MAX_FAILURES;
}

/** Seconds until the oldest failure falls out of the window. */
export function retryAfterSeconds(key: string) {
  const now = Date.now();
  const recent = recentFor(key, now);
  if (!recent.length) return 0;
  const oldest = Math.min(...recent);
  return Math.max(1, Math.ceil((PIN_WINDOW_MS - (now - oldest)) / 1000));
}

export function recordFailure(key: string) {
  const now = Date.now();
  failures.set(key, [...recentFor(key, now), now]);
  if (failures.size > 5000) prune(now);
}

/** Called after a good PIN so a forgetful student gets a fresh set of tries. */
export function clearFailures(key: string) {
  failures.delete(key);
}
