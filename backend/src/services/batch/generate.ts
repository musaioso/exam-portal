import { z } from "zod";
import { chatComplete } from "../ai/chat";
import type { ChatMessage, ProviderConfig } from "../ai/types";

export interface GenerationMeta {
  pageNumber: number;
  chapterTitle: string;
  maxQuestions: number;
  /** Questions already in the bank; the model must not repeat them. */
  avoidPrompts?: string[];
  /** Old question being replaced; prefer the same topic when the page supports it. */
  topicHint?: string;
}

export interface Candidate {
  type: "mcq";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string | null;
  sourceQuote: string;
  /** Visible section heading on the cited page, when one is present. */
  section?: string | null;
  /** One-step arithmetic from numbers explicitly on the page, when used. */
  derivation?: string | null;
  marks: number;
}

const SYSTEM_PROMPT = `You write exam questions from a single scanned textbook page. Use ONLY the attached page. Never use outside knowledge, older-book terms, or anything not visible on the page. If the page does not state a fact, do not write a question about it.

Return a JSON array. Each item must be:
{"difficulty":"easy|medium|hard","prompt":"...","options":["...","...","...","..."],"answer":"exact option text","explanation":"one sentence","sourceQuote":"verbatim sentence from the page","section":"visible section heading on the page, or empty","derivation":"optional one-step calculation, or empty","marks":1}

Rules:
- Exactly 4 unique options. The answer must be copied character-for-character from one option.
- sourceQuote must be an exact sentence from the page that supports the answer.
- A question may ask for a result obtained by ONE simple arithmetic step from numbers explicitly on the page: sum, difference, half, double, or percentage. Include derivation, for example "80000 / 2 = 40000". The page must state every input number.
- Never derive a name, date, label, classification, or term. Those must be explicitly stated.
- Do not return a page number; the system assigns it.
- Never write "according to", "on page", "as stated in", a section/point reference, or an exercise reference.
- Write up to the requested number of distinct questions. If the page supports that many different facts, produce that many. Never repeat an existing question and never invent facts to fill the count.`;

const BANNED = /according to|on page \d|as stated in|section \d|as mentioned in the (text|section)|পাঠ্যবই অনুযায়ী/i;

export function buildStrictMessages(meta: GenerationMeta): ChatMessage[] {
  const avoid = (meta.avoidPrompts || [])
    .slice(0, 300)
    .map((prompt) => `- ${String(prompt).slice(0, 200)}`)
    .join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Chapter: ${meta.chapterTitle}\n` +
        `Book page: ${meta.pageNumber}\n` +
        `Write up to ${meta.maxQuestions} distinct questions from the attached page image.` +
        (meta.topicHint
          ? `\n\nThe question being replaced covered: "${String(meta.topicHint).slice(0, 300)}". ` +
            "Prefer a question about the same topic if the page clearly supports it; otherwise use another clear fact from the page. " +
            "Do not use the old question's answer unless the page states it."
          : "") +
        (avoid ? `\n\nDo not repeat or rephrase any of these existing questions:\n${avoid}` : ""),
    },
  ];
}

const itemSchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard"]).catch("medium"),
  prompt: z.string(),
  options: z.array(z.string()),
  answer: z.string(),
  explanation: z.string().optional(),
  sourceQuote: z.string(),
  section: z.string().optional(),
  derivation: z.string().optional(),
  marks: z.number().optional(),
});

function extractArray(text: string): unknown[] {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates: string[] = [stripped];
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
    } catch {
      /* try next candidate */
    }
  }
  return [];
}

export function parseStrictReply(text: string): Candidate[] {
  const raw = extractArray(text);
  const out: Candidate[] = [];
  for (const item of raw) {
    const parsed = itemSchema.safeParse(item);
    if (!parsed.success) continue;
    const itemData = parsed.data;
    const prompt = itemData.prompt.trim();
    if (!prompt || BANNED.test(prompt)) continue;
    const options = [...new Set(itemData.options.map((o) => String(o).trim()).filter(Boolean))];
    if (options.length !== 4) continue;
    const answer = itemData.answer.trim();
    if (!options.includes(answer)) continue;
    const sourceQuote = itemData.sourceQuote.trim();
    if (!sourceQuote) continue;
    const section = itemData.section ? String(itemData.section).trim() : null;
    const derivation = itemData.derivation ? String(itemData.derivation).trim() : null;
    const marks = Number(itemData.marks) > 0 ? Math.floor(Number(itemData.marks)) : 1;
    out.push({
      type: "mcq",
      difficulty: itemData.difficulty,
      prompt,
      options,
      answer,
      explanation: itemData.explanation ? String(itemData.explanation).trim() : null,
      sourceQuote,
      section: section || null,
      derivation: derivation || null,
      marks,
    });
  }
  return out;
}

export async function generatePage(
  cfg: ProviderConfig,
  model: string,
  image: Buffer,
  mimeType: string,
  meta: GenerationMeta,
  deps: { chat?: typeof chatComplete } = {}
): Promise<Candidate[]> {
  const messages = buildStrictMessages(meta);
  const user = messages.find((m) => m.role === "user");
  if (user) user.images = [{ mimeType, data: image.toString("base64") }];
  const chat = deps.chat ?? chatComplete;
  const result = await chat(cfg, model, messages, { maxTokens: 1200 });
  const items = parseStrictReply(result.text);
  if (items.length === 0) {
    throw new Error("The model returned no valid questions for this page.");
  }
  return items;
}
