import { z } from "zod";
import { chatComplete } from "../ai/chat";
import type { ChatMessage, ProviderConfig } from "../ai/types";

export interface GenerationMeta {
  pageNumber: number;
  chapterTitle: string;
  maxQuestions: number;
}

export interface Candidate {
  type: "mcq";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string | null;
  sourceQuote: string;
  marks: number;
}

const SYSTEM_PROMPT = `You write exam questions from a single scanned textbook page. Use ONLY the attached page. Never use outside knowledge, older-book terms, or anything not visible on the page. If the page does not state a fact, do not write a question about it.

Return a JSON array. Each item must be:
{"difficulty":"easy|medium|hard","prompt":"...","options":["...","...","...","..."],"answer":"exact option text","explanation":"one sentence","sourceQuote":"verbatim sentence from the page","marks":1}

Rules:
- Exactly 4 unique options. The answer must be copied character-for-character from one option.
- sourceQuote must be an exact sentence from the page that supports the answer.
- Do not return a page number; the system assigns it.
- Never write "according to page", "on page", "as stated in", "according to the textbook/Table/Figure", or an exercise reference.
- Write at most the requested number of questions. Fewer is fine; never invent to fill the count.`;

const BANNED = /according to page|on page \d|as stated in|according to the textbook|according to table|according to figure|পাঠ্যবই অনুযায়ী/i;

export function buildStrictMessages(meta: GenerationMeta): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Chapter: ${meta.chapterTitle}\n` +
        `Book page: ${meta.pageNumber}\n` +
        `Write at most ${meta.maxQuestions} questions from the attached page image.`,
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
    const marks = Number(itemData.marks) > 0 ? Math.floor(Number(itemData.marks)) : 1;
    out.push({
      type: "mcq",
      difficulty: itemData.difficulty,
      prompt,
      options,
      answer,
      explanation: itemData.explanation ? String(itemData.explanation).trim() : null,
      sourceQuote,
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
  const result = await chat(cfg, model, messages);
  const items = parseStrictReply(result.text);
  if (items.length === 0) {
    throw new Error("The model returned no valid questions for this page.");
  }
  return items;
}
