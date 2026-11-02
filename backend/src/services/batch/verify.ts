import { chatComplete } from "../ai/chat";
import type { ChatMessage, ProviderConfig } from "../ai/types";
import type { Candidate } from "./generate";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normalizeEvidence(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function editDistance(a: string, b: string): number {
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = temp;
    }
  }
  return prev[b.length];
}

export function quoteCoverage(pageText: string, quote: string): number {
  const page = normalizeEvidence(pageText);
  const q = normalizeEvidence(quote);
  if (!page || !q) return 0;
  if (page.includes(q)) return 1;
  const pageTokens = page.split(" ").filter(Boolean);
  const quoteTokens = q.split(" ").filter((t) => t.length > 2);
  if (quoteTokens.length < 4) return 0;
  let found = 0;
  for (const token of quoteTokens) {
    if (pageTokens.includes(token)) {
      found++;
      continue;
    }
    if (
      token.length >= 5 &&
      pageTokens.some(
        (p) => p.length >= 5 && Math.abs(p.length - token.length) <= 2 && editDistance(p, token) <= 2
      )
    ) {
      found++;
    }
  }
  return found / quoteTokens.length;
}

export function isQuoteOnPage(pageText: string, quote: string, threshold = 0.9): boolean {
  return quoteCoverage(pageText, quote) >= threshold;
}

export function numericTokens(text: string): string[] {
  const ascii = String(text || "").replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  return [...ascii.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
}

export function missingNumbers(pageText: string, text: string): string[] {
  const page = normalizeEvidence(pageText);
  const missing = new Set<string>();
  for (const token of numericTokens(text)) {
    const variants = [token, token.replace(/[.,]/g, " "), token.replace(/[.,].*$/, "")];
    if (!variants.some((v) => page.includes(normalizeEvidence(v)))) missing.add(token);
  }
  return [...missing];
}

type Verdict = { index: number; valid: boolean; reason?: string; method?: "ocr" | "vision" };

function extractVerdicts(text: string): any[] {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const s = stripped.indexOf("[");
  const e = stripped.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try {
      const parsed = JSON.parse(stripped.slice(s, e + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return [];
}

export async function verifyCandidates(args: {
  pageText: string | null;
  image: Buffer;
  mimeType: string;
  candidates: Candidate[];
  cfg: ProviderConfig;
  model: string;
  allowVisionFallback?: boolean;
  deps?: { chat?: typeof chatComplete };
}): Promise<Verdict[]> {
  const { pageText, image, mimeType, candidates, cfg, model } = args;
  const visionMode = !pageText && !!args.allowVisionFallback;
  const rejected: Verdict[] = [];
  const passed: Array<{ index: number; candidate: Candidate }> = [];

  if (!pageText && !args.allowVisionFallback) {
    return candidates.map((_, index) => ({
      index,
      valid: false,
      reason: "no OCR text",
      method: "ocr" as const,
    }));
  }

  candidates.forEach((candidate, index) => {
    if (pageText) {
      if (!isQuoteOnPage(pageText, candidate.sourceQuote)) {
        rejected.push({ index, valid: false, reason: "quote not found on page", method: "ocr" });
        return;
      }
      if (missingNumbers(pageText, [candidate.prompt, ...candidate.options, candidate.answer].join(" ")).length > 0) {
        rejected.push({ index, valid: false, reason: "number not found on page", method: "ocr" });
        return;
      }
    }
    passed.push({ index, candidate });
  });

  if (passed.length === 0) return rejected.sort((a, b) => a.index - b.index);

  const items = passed.map(({ index, candidate }) => ({
    index,
    prompt: candidate.prompt,
    options: candidate.options,
    answer: candidate.answer,
    sourceQuote: candidate.sourceQuote,
  }));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Use only the attached textbook page. For each item return a JSON array of " +
        '{"index":number,"valid":boolean,"reason":"..."}. Valid only if the quote is on the page, ' +
        "supports the answer, and no term or number in the question, options, or answer is absent from the page.",
    },
    {
      role: "user",
      content: `Verify these items against the attached page:\n${JSON.stringify(items)}`,
      images: [{ mimeType, data: image.toString("base64") }],
    },
  ];

  const chat = args.deps?.chat ?? chatComplete;
  const result = await chat(cfg, model, messages);
  const verdicts = extractVerdicts(result.text);
  const byIndex = new Map<number, any>();
  for (const v of verdicts) {
    if (v && typeof v.index === "number") byIndex.set(v.index, v);
  }

  const verified: Verdict[] = passed.map(({ index }) => {
    const v = byIndex.get(index);
    if (!v) return { index, valid: false, reason: "no verifier verdict", method: visionMode ? "vision" : "ocr" };
    return {
      index,
      valid: v.valid === true,
      reason: v.reason ? String(v.reason) : undefined,
      method: visionMode ? "vision" : "ocr",
    };
  });

  return [...rejected, ...verified].sort((a, b) => a.index - b.index);
}
