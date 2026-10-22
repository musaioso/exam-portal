import { z } from "zod";
import { chatComplete } from "./chat";
import { normalizeText } from "../../lib/text";
import { ChatMessage, ChatResult, ProviderConfig } from "./types";

/**
 * Builds the generation prompt, validates what comes back, and — critically —
 * enforces the no-duplicates rule at three layers:
 *   1. the prompt tells the model which questions already exist (AVOID list),
 *   2. the batch is deduped against itself right after parsing,
 *   3. callers flag results against the bank with flagAgainstBank() before the
 *      review UI ever shows them, and bulk-import re-checks at save time.
 * Nothing here writes to the database — saving stays a human decision.
 */

export type QuestionType = "mcq" | "short" | "long";
export type Difficulty = "easy" | "medium" | "hard";
export type RequestedDifficulty = Difficulty | "mixed";

export interface GenerateParams {
  subject?: string;
  chapter?: string;
  text: string;
  count: number;
  difficulty: RequestedDifficulty;
  types: QuestionType[];
  language: "auto" | "english" | "bangla";
  /** Prompts already in the bank — sent as the AVOID list (capped) */
  avoidPrompts?: string[];
  /**
   * Source page numbers present in `text` (which carries "[Page N]" markers).
   * When set, each question is tagged with the page its answer came from.
   * Only meaningful for a single multi-page source — see resolveSource().
   */
  pages?: number[];
}

export interface GeneratedQuestion {
  type: QuestionType;
  difficulty: Difficulty;
  prompt: string;
  options: string[] | null;
  answer: string;
  explanation: string | null;
  marks: number;
  /** 1-based page in the source the answer is found on, or null when unknown */
  page: number | null;
  /** true when an identical (normalized) prompt already exists in the bank */
  isDuplicate?: boolean;
}

export interface DroppedItem {
  index: number;
  reason: string;
}

export interface GenerateOutcome {
  questions: GeneratedQuestion[];
  dropped: DroppedItem[];
  usage?: { inputTokens?: number; outputTokens?: number };
  /** true when the source had to be cut to fit the prompt */
  truncated: boolean;
}

/** ~15k tokens of source — safe for the smallest provider context windows (128k+ everywhere we support). */
const MAX_SOURCE_CHARS = 60_000;
/** AVOID lists bigger than this cost more tokens than they save. */
const MAX_AVOID = 300;
const MAX_AVOID_LEN = 200;

const SYSTEM_PROMPT = `You are an expert exam item writer who creates high-quality questions from textbook source material.

Rules:
1. Base every question STRICTLY on the source material provided. Never invent facts the source does not state.
2. Write questions in the same language as the source material (Bangla source → Bangla questions, English source → English questions). Keep technical terms as written in the source.
3. The answer must be unambiguously correct according to the source.
4. For MCQs: give exactly 4 options with exactly one correct answer. The correct "answer" field must be the option text copied verbatim from "options". Distractors must be plausible, similar in length and style, and drawn from the source's subject matter.
5. Never repeat any question from the AVOID list, and never produce two questions that ask the same thing.
6. Include a short explanation stating why the answer is correct, referencing the source.
7. When the source material carries "[Page N]" headers, add "page": N to every question — the page where its answer is stated. Omit "page" when the source has no such markers.
8. Output ONLY a JSON array. No markdown fences, no commentary before or after.

Each array item must match:
{"type": "mcq" | "short" | "long", "difficulty": "easy" | "medium" | "hard", "prompt": "<question>", "options": ["<choice>", ...] (mcq only), "answer": "<for mcq: exactly one of options>", "explanation": "<why>", "marks": <positive integer>, "page": <source page number, only when the source is page-marked>}`;

function buildUserMessage(params: GenerateParams): string {
  const types = params.types.join(", ");
  const difficulty = params.difficulty === "mixed" ? "a mix of easy, medium and hard" : params.difficulty;
  const language =
    params.language === "auto" ? "Match the source language automatically." :
    params.language === "bangla" ? "Write the questions in Bangla." :
    "Write the questions in English.";

  let text = params.text;
  let truncated = false;
  if (text.length > MAX_SOURCE_CHARS) {
    text = text.slice(0, MAX_SOURCE_CHARS);
    truncated = true;
  }

  const parts = [
    `Create ${params.count} question${params.count === 1 ? "" : "s"} of type: ${types}.`,
    `Difficulty: ${difficulty}.`,
    language,
  ];
  if (params.subject) parts.push(`Subject: ${params.subject}${params.chapter ? ` | Chapter: ${params.chapter}` : ""}`);
  parts.push(`Source material (book excerpt):\n"""\n${text}\n"""`);
  if (truncated) parts.push('(Note: the source excerpt above was cut off — only write questions answerable from the portion shown.)');

  const avoid = (params.avoidPrompts || []).slice(0, MAX_AVOID);
  if (avoid.length > 0) {
    parts.push(
      `Existing questions in the bank that you MUST NOT repeat or rephrase:\n` +
        avoid.map((p) => `- ${p.slice(0, MAX_AVOID_LEN)}`).join("\n")
    );
  }
  if (params.pages && params.pages.length > 0) {
    parts.push(
      `The source is split into pages labelled [Page N]. Set "page" on every question to the page whose text states its answer.`
    );
  }
  return parts.join("\n\n");
}

/**
 * Pages whose "[Page N]" marker survived truncation. Stops the model citing a
 * page that exists in the document but was cut out of the prompt.
 */
function pagesInText(text: string, pages: number[]): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(/\[Page (\d+)\]/g)) seen.add(Number(m[1]));
  return pages.filter((p) => seen.has(p));
}

/* --------------------------------------------------------------- validation */

const itemSchema = z.object({
  type: z.string(),
  difficulty: z.string().optional(),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  answer: z.string().optional(),
  explanation: z.string().optional(),
  marks: z.union([z.number(), z.string()]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
});

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * Accept only pages that actually exist in the source. The model is told to
 * report them, but a hallucinated number would silently point the printed
 * answer key at the wrong book page — better to store no page than a wrong one.
 */
function coercePage(raw: unknown, valid?: Set<number>): number | null {
  if (!valid || valid.size === 0) return null;
  const s = String(raw ?? "").replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return null;
  return valid.has(n) ? n : null;
}

function coerceType(raw: string): QuestionType | null {
  const t = raw.trim().toLowerCase();
  if (["mcq", "mcqs", "multiple choice", "multiple_choice", "multiple-choice", "objective", "choice"].includes(t)) return "mcq";
  if (["short", "short answer", "short_answer", "short-answer", "sqa"].includes(t)) return "short";
  if (["long", "long answer", "long_answer", "long-answer", "essay", "descriptive"].includes(t)) return "long";
  return null;
}

function coerceDifficulty(raw: string | undefined): Difficulty {
  const d = (raw || "").trim().toLowerCase();
  if (d === "easy" || d === "hard") return d;
  return "medium";
}

/** Pull a JSON array out of a model reply that may be fenced, chatty, or wrapped. */
function extractArray(text: string): unknown[] {
  const candidates: string[] = [];
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  candidates.push(stripped);
  const s = stripped.indexOf("[");
  const e = stripped.lastIndexOf("]");
  if (s >= 0 && e > s) candidates.push(stripped.slice(s, e + 1));
  const os = stripped.indexOf("{");
  const oe = stripped.lastIndexOf("}");
  if (os >= 0 && oe > os) candidates.push(stripped.slice(os, oe + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as any).questions)) return (parsed as any).questions;
      if (parsed && Array.isArray((parsed as any).items)) return (parsed as any).items;
    } catch { /* try next candidate */ }
  }
  throw new Error("The reply was not a JSON array of questions.");
}

/**
 * Validate + normalize one raw item. Returns the question, or a reason it was
 * dropped. MCQ answers are matched to their option with the same normalization
 * used by the duplicate scanner, so "১. A option" still matches option "A option".
 */
function coerceItem(raw: unknown, validPages?: Set<number>): { ok: true; question: GeneratedQuestion } | { ok: false; reason: string } {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "Missing required fields (type/prompt/answer)" };
  const item = parsed.data;

  const type = coerceType(item.type || "");
  if (!type) return { ok: false, reason: `Unknown type "${item.type}"` };
  const prompt = String(item.prompt || "").trim();
  if (!prompt) return { ok: false, reason: "Empty prompt" };
  const answer = String(item.answer || "").trim();
  if (!answer) return { ok: false, reason: "Empty answer" };
  const page = coercePage(item.page, validPages);

  let options: string[] | null = null;
  if (type === "mcq") {
    options = (item.options || []).map((o) => String(o).trim()).filter((o) => o !== "");
    // dedupe identical options
    options = [...new Set(options)];
    if (options.length < 2) return { ok: false, reason: "MCQ needs at least 2 options" };
    const match = options.find((o) => normalizeText(o) === normalizeText(answer));
    if (!match) return { ok: false, reason: "MCQ answer is not one of the options" };
    return {
      ok: true,
      question: {
        type,
        difficulty: coerceDifficulty(item.difficulty),
        prompt,
        options,
        answer: match, // canonical option text, not the model's phrasing
        explanation: item.explanation ? String(item.explanation).trim() : null,
        marks: Number(item.marks) > 0 ? Math.floor(Number(item.marks)) : 1,
        page,
      },
    };
  }
  return {
    ok: true,
    question: {
      type,
      difficulty: coerceDifficulty(item.difficulty),
      prompt,
      options: null,
      answer,
      explanation: item.explanation ? String(item.explanation).trim() : null,
      marks: Number(item.marks) > 0 ? Math.floor(Number(item.marks)) : 1,
      page,
    },
  };
}

/** Non-throwing extractArray — empty array signals unparseable output. */
function tryExtract(text: string): unknown[] {
  try {
    return extractArray(text);
  } catch {
    return [];
  }
}

/** Layer 2+3 of the duplicate guarantee: within-batch, then against the bank. */
export function dedupeBatch(questions: GeneratedQuestion[], dropped: DroppedItem[], rawCount: number): number {
  const seen = new Set<string>();
  let removed = 0;
  const keep = questions.filter((q) => {
    const key = normalizeText(q.prompt);
    if (seen.has(key)) {
      removed++;
      dropped.push({ index: rawCount + removed, reason: "Duplicate of another question in this batch" });
      return false;
    }
    seen.add(key);
    return true;
  });
  questions.length = 0;
  questions.push(...keep);
  return removed;
}

/** Flags questions whose normalized prompt already exists in the bank. */
export function flagAgainstBank(questions: GeneratedQuestion[], existingKeys: Set<string>): number {
  let n = 0;
  for (const q of questions) {
    q.isDuplicate = existingKeys.has(normalizeText(q.prompt));
    if (q.isDuplicate) n++;
  }
  return n;
}

/* -------------------------------------------------------------- generation */

/**
 * Generate + parse, with one repair round-trip: if the model's reply is not
 * valid JSON or fails validation, the exact errors are sent back once and the
 * model is asked for the corrected array.
 */
export async function generateQuestions(
  cfg: ProviderConfig,
  model: string,
  params: GenerateParams
): Promise<GenerateOutcome> {
  const userMessage = buildUserMessage(params);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  let result: ChatResult = await chatComplete(cfg, model, messages);
  let raw = tryExtract(result.text);
  let questions: GeneratedQuestion[] = [];
  let dropped: DroppedItem[] = [];
  const visiblePages = params.pages && params.pages.length
    ? pagesInText(params.text.slice(0, MAX_SOURCE_CHARS), params.pages)
    : undefined;
  const validPages = visiblePages && visiblePages.length ? new Set(visiblePages) : undefined;

  const coerceAll = (items: unknown[]) => {
    questions = [];
    dropped = [];
    items.forEach((item, index) => {
      const coerced = coerceItem(item, validPages);
      if (coerced.ok) questions.push(coerced.question);
      else dropped.push({ index, reason: coerced.reason });
    });
    return items.length;
  };

  const rawCount = coerceAll(raw);

  // Nothing usable came back — send the exact failure back once and try again.
  // (A second failure propagates to the route as a 502 with the provider text.)
  if (questions.length === 0) {
    const why =
      raw.length === 0
        ? "The reply was not a valid JSON array of questions."
        : `Every item failed validation:\n${dropped.map((d) => `- item ${d.index}: ${d.reason}`).join("\n")}`;
    result = await chatComplete(cfg, model, [
      ...messages,
      { role: "user", content: `Your previous reply was rejected because:\n${why}\n\nReturn ONLY the corrected JSON array, nothing else.` },
    ]);
    coerceAll(tryExtract(result.text));
  }
  dedupeBatch(questions, dropped, rawCount);

  return {
    questions,
    dropped,
    usage: result.usage,
    truncated: params.text.length > MAX_SOURCE_CHARS,
  };
}
