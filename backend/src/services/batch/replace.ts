import { getDb, get, all, run } from "../../db/database";
import { getProviderConfig } from "../ai/providers";
import { generatePage as realGeneratePage } from "./generate";
import { verifyCandidates as realVerifyCandidates, normalizeEvidence, numericTokens } from "./verify";
import { withRetry } from "./retry";
import { loadPages } from "./correct";
import { pickPages, norm, toks } from "./page-search";
import type { Candidate } from "./generate";

type Page = Awaited<ReturnType<typeof loadPages>>[number];

export interface ReplaceOptions {
  maxPages?: number;
  attemptsPerPage?: number;
}

export interface ReplaceResult {
  replaced: number;
  failed: number;
  items: any[];
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthsIn(text: string): string[] {
  const value = norm(text);
  return MONTHS.filter((month) => value.includes(month));
}

function jaccard(a: string, b: string): number {
  const left = new Set(toks(a));
  const right = new Set(toks(b));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function sectionOnPage(section: string | null | undefined, pageText: string): string | null {
  const value = section ? String(section).trim() : "";
  if (!value) return null;
  return normalizeEvidence(pageText).includes(normalizeEvidence(value)) ? value : null;
}

/**
 * Generate a fresh, grounded question for each selected correction item and
 * store it in `proposed_json`. Applying is still a separate, explicit step;
 * this function never changes the question row.
 */
export async function replaceItems(
  runId: string,
  itemIds: string[],
  opts: ReplaceOptions = {},
  deps: {
    generatePage?: typeof realGeneratePage;
    verifyCandidates?: typeof realVerifyCandidates;
    chat?: any;
  } = {}
): Promise<ReplaceResult> {
  if (itemIds.length === 0) return { replaced: 0, failed: 0, items: [] };

  const db = await getDb();
  const runRow = await get(db, "SELECT * FROM correction_runs WHERE id=?", [runId]);
  if (!runRow) throw new Error("Correction run not found");
  if (!runRow.source_batch_id) throw new Error("A source page-image batch is required");

  const batch = await get(db, "SELECT * FROM batch_runs WHERE id=?", [runRow.source_batch_id]);
  if (!batch) throw new Error("The source page-image batch was not found");
  const cfg = await getProviderConfig(String(batch.provider));
  if (!cfg) throw new Error(`The ${batch.provider} provider is not configured`);

  const pages = await loadPages(String(runRow.source_batch_id));
  if (pages.length === 0) throw new Error("The source batch has no confirmed pages");

  const chapter = runRow.chapter_id
    ? await get(db, "SELECT title FROM chapters WHERE id=?", [runRow.chapter_id])
    : null;
  const chapterTitle = String(chapter?.title || "Chapter");
  const maxPages = Math.max(1, Math.min(5, opts.maxPages ?? 2));
  const attemptsPerPage = Math.max(1, Math.min(5, opts.attemptsPerPage ?? 2));

  const generate = deps.generatePage ?? realGeneratePage;
  const verify = deps.verifyCandidates ?? realVerifyCandidates;

  let replaced = 0;
  let failed = 0;
  const generated: Array<{ prompt: string; answer: string; quote: string; nums: string[] }> = [];
  const META_ANSWER = /information not provided|not provided|not mentioned|not stated|does not mention|does not state|page does not|none of the above|cannot be determined|not available/i;

  for (const itemId of itemIds) {
    const item = await get(db, "SELECT * FROM correction_items WHERE run_id=? AND id=?", [runId, itemId]);
    if (!item) {
      failed++;
      continue;
    }
    const question = await get(db, "SELECT * FROM questions WHERE id=?", [item.question_id]);
    if (!question) {
      failed++;
      continue;
    }

    let proposed: any = {};
    try { proposed = JSON.parse(item.proposed_json || "{}") || {}; } catch { proposed = {}; }
    const candidatesPages = pickPages(question, pages, {
      proposedPage: proposed?.page_number,
      claimedPage: question.page_number,
      maxPages,
    });
    if (candidatesPages.length === 0) {
      await recordFailure(db, item, "No chapter page could be anchored to this question.");
      failed++;
      continue;
    }

    const avoid = await all(
      db,
      `SELECT prompt,answer,source_quote FROM questions
       WHERE subject_id=? AND COALESCE(chapter_id,'')=COALESCE(?,'') AND id<>?
       ORDER BY created_at DESC LIMIT 300`,
      [question.subject_id, question.chapter_id ?? null, question.id]
    );
    const existing = avoid.map((row: any) => ({
      prompt: String(row.prompt || ""),
      answer: norm(row.answer),
      quote: norm(row.source_quote || ""),
      nums: numericTokens(row.answer),
    }));
    // Other replacements already generated in this run must not be repeated.
    const siblingRows = await all(
      db,
      "SELECT proposed_json FROM correction_items WHERE run_id=? AND id<>?",
      [runId, item.id]
    );
    for (const row of siblingRows) {
      try {
        const sibling = JSON.parse(row.proposed_json || "{}");
        if (sibling.replace === true && sibling.prompt) {
          existing.push({
            prompt: String(sibling.prompt),
            answer: norm(sibling.answer),
            quote: norm(sibling.source_quote || ""),
            nums: numericTokens(sibling.answer),
          });
        }
      } catch { /* ignore malformed legacy rows */ }
    }

    const reasons: string[] = [];
    let replacement: any = null;

    for (const page of candidatesPages) {
      for (let attempt = 1; attempt <= attemptsPerPage && !replacement; attempt++) {
        try {
          const candidates: Candidate[] = await withRetry(
            () => generate(
              cfg,
              String(batch.model),
              page.image,
              page.mimeType || "image/png",
              {
                pageNumber: page.pageNumber,
                chapterTitle,
                maxQuestions: 1,
                avoidPrompts: avoid.map((row: any) => String(row.prompt)),
                topicHint: String(question.prompt || ""),
              },
              { chat: deps.chat }
            ),
            { attempts: 3, delaysMs: [2000, 8000, 20000] }
          );

          const verdicts = await withRetry(
            () => verify({
              pageText: page.text || null,
              image: page.image,
              mimeType: page.mimeType || "image/png",
              candidates,
              cfg,
              model: String(batch.model),
              allowVisionFallback: true,
              deps: { chat: deps.chat },
            }),
            { attempts: 3, delaysMs: [2000, 8000, 20000] }
          );

          const accepted = verdicts.find((v: any) => v.valid === true);
          if (!accepted) {
            const why = verdicts.map((v: any) => v.reason).filter(Boolean).join("; ");
            reasons.push(`page ${page.pageNumber}: ${why || "no candidate passed verification"}`);
            continue;
          }

          const candidate = candidates[accepted.index];
          if (!candidate) {
            reasons.push(`page ${page.pageNumber}: verifier accepted a missing candidate`);
            continue;
          }
          const options = [...new Set(candidate.options.map((o) => String(o).trim()).filter(Boolean))];
          if (options.length !== 4) {
            reasons.push(`page ${page.pageNumber}: replacement does not have 4 unique options`);
            continue;
          }
          if (!options.includes(candidate.answer)) {
            reasons.push(`page ${page.pageNumber}: replacement answer is not one of its options`);
            continue;
          }

          if (String(candidate.answer || "").length > 120) {
            reasons.push(`page ${page.pageNumber}: replacement answer is too long for an option`);
            continue;
          }
          const stemMonths = monthsIn(candidate.prompt);
          const answerMonths = monthsIn(candidate.answer);
          if (stemMonths.length && answerMonths.length &&
            !answerMonths.some((month) => stemMonths.includes(month))) {
            reasons.push(`page ${page.pageNumber}: stem and answer name different months`);
            continue;
          }
          if (META_ANSWER.test(String(candidate.answer || ""))) {
            reasons.push(`page ${page.pageNumber}: replacement answer is a non-answer (${candidate.answer})`);
            continue;
          }

          const quote = norm(candidate.sourceQuote);
          const candidateNums = numericTokens(candidate.answer);
          const duplicate = [...existing, ...generated].find((row: any) => {
            if (quote && row.quote && quote === row.quote) return true;
            const similarity = jaccard(candidate.prompt, row.prompt);
            if (similarity >= 0.75) return true;
            if (candidateNums.length && row.nums?.length &&
              candidateNums.every((n) => row.nums.includes(n)) && similarity >= 0.2) return true;
            return !!row.answer && row.answer === norm(candidate.answer) && similarity >= 0.3;
          });
          if (duplicate) {
            reasons.push(`page ${page.pageNumber}: replacement duplicates an existing question`);
            continue;
          }

          const explanation = candidate.derivation
            ? [candidate.explanation, `Derived: ${candidate.derivation}.`].filter(Boolean).join(" ")
            : candidate.explanation;
          replacement = {
            prompt: candidate.prompt,
            options,
            answer: candidate.answer,
            explanation,
            derivation: candidate.derivation || null,
            difficulty: question.difficulty || candidate.difficulty,
            page: String(page.pageNumber),
            page_number: page.pageNumber,
            section: sectionOnPage(candidate.section, page.text),
            source_quote: candidate.sourceQuote,
            replace: true,
          };
          generated.push({ prompt: candidate.prompt, answer: norm(candidate.answer), quote, nums: candidateNums });
        } catch (error: any) {
          reasons.push(`page ${page.pageNumber}: ${String(error?.message || error)}`);
        }
      }
      if (replacement) break;
    }

    if (!replacement) {
      await recordFailure(db, item, reasons.slice(0, 4).join(" | "));
      failed++;
      continue;
    }

    let evidence: any = {};
    try { evidence = JSON.parse(item.evidence_json || "{}") || {}; } catch { evidence = {}; }
    await run(
      db,
      "UPDATE correction_items SET proposed_json=?, evidence_json=?, status='proposed' WHERE id=?",
      [
        JSON.stringify(replacement),
        JSON.stringify({
          ...evidence,
          quote: replacement.source_quote,
          pageNumber: replacement.page_number,
          method: "replace",
          replaceError: null,
        }),
        item.id,
      ]
    );
    replaced++;
  }

  const items = await all(
    db,
    "SELECT * FROM correction_items WHERE run_id=? AND id IN (" + itemIds.map(() => "?").join(",") + ")",
    [runId, ...itemIds]
  );
  return { replaced, failed, items };
}

async function recordFailure(db: any, item: any, reason: string) {
  let evidence: any = {};
  try { evidence = JSON.parse(item.evidence_json || "{}") || {}; } catch { evidence = {}; }
  await run(
    db,
    "UPDATE correction_items SET proposed_json=NULL, evidence_json=?, status='proposed' WHERE id=?",
    [
      JSON.stringify({
        ...evidence,
        replaceError: reason || "No replacement passed verification.",
        replaceFailedAt: Date.now(),
      }),
      item.id,
    ]
  );
}
