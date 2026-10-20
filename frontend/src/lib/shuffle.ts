// Seeded shuffling so an exam's question/option order is identical everywhere
// (take-exam, print preview, answer key) instead of re-randomising each time.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr];
  const rng = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A per-question seed derived from the exam seed + question id. */
export function questionSeed(baseSeed: number, questionId: string): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < questionId.length; i++) {
    h = (Math.imul(h, 31) + questionId.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}