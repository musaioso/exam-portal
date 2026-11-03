/**
 * Pure helpers for finding which chapter page a question is about.
 *
 * The audit uses them when a question has no page number (NotebookLM imports)
 * or when the teacher asks for a whole-chapter search. Replacement generation
 * uses the same ranking to pick source pages.
 */

export interface SearchablePage {
  pageNumber: number;
  text: string;
}

const STOP = new Set(
  "the a an of in on at to for from by with and or is are was were be been being this that these those which what who whom whose when where why how did does do has have had as it its into than then there their they them we our you your he she his her not no if about approximately".split(" ")
);

export function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function toks(s: string): string[] {
  return norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t));
}

/** Higher means the page is more likely to contain this question's facts. */
export function scorePage(page: SearchablePage, question: any): number {
  const text = norm(page.text);
  if (!text) return 0;
  const answer = norm(question.answer);
  const answerTokens = toks(question.answer);
  const numbers = [...String(question.answer || "").matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((m) => m[0].replace(",", ""));
  const promptTokens = toks(question.prompt).filter((t) => t.length > 3);

  let score = 0;
  if (answer && text.includes(answer)) score += 100;
  for (const token of answerTokens) if (text.includes(token)) score += 8;
  for (const number of numbers) if (text.includes(number)) score += 15;
  for (const token of promptTokens) if (text.includes(token)) score += 1;
  return score;
}

/**
 * Rank candidate pages for one question.
 *
 * The explicitly proposed page and the claimed page always come first; the
 * remaining slots go to the best text matches in the chapter. This is a
 * shortlist, not proof: the caller still verifies each page with the model.
 */
export function pickPages<T extends SearchablePage>(
  question: any,
  pages: T[],
  opts: {
    proposedPage?: number | null;
    claimedPage?: number | null;
    maxPages?: number;
    includeFirstWhenEmpty?: boolean;
  } = {}
): T[] {
  const byNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  const chosen: T[] = [];
  const add = (page: T | undefined) => {
    if (page && !chosen.some((p) => p.pageNumber === page.pageNumber)) chosen.push(page);
  };

  if (opts.proposedPage != null) add(byNumber.get(Number(opts.proposedPage)));
  if (opts.claimedPage != null) add(byNumber.get(Number(opts.claimedPage)));

  const max = Math.max(1, opts.maxPages ?? 6);
  const scored = pages
    .map((page) => ({ page, score: scorePage(page, question) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const entry of scored) {
    if (chosen.length >= max) break;
    add(entry.page);
  }

  if (chosen.length === 0 && opts.includeFirstWhenEmpty !== false && pages.length > 0) {
    chosen.push(pages[0]);
  }
  return chosen.slice(0, max);
}
