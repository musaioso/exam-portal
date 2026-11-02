import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb, run, get, all } from "../../db/database";
import { chatComplete } from "../ai/chat";
import type { ChatMessage, ProviderConfig } from "../ai/types";
import { getProviderConfig } from "../ai/providers";
import { ocrImage } from "../ai/ocr";
import { isQuoteOnPage } from "./verify";

export type CorrectionVerdict =
  | "ok"
  | "wrong_page"
  | "wrong_answer"
  | "not_found"
  | "bad_options"
  | "outside_book"
  | "needs manual edit";

export interface CorrectionAudit {
  verdict: CorrectionVerdict;
  proposed: any | null;
  evidence: any;
}

interface CorrectionPage {
  pageNumber: number;
  text: string;
  image: Buffer;
}

function parseOptions(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((o) => String(o).trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map((o) => String(o).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function extractObject(text: string): any {
  const stripped = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return {};
    }
  }
  return {};
}

export async function auditQuestion(
  question: any,
  page: CorrectionPage,
  cfg: ProviderConfig,
  model: string,
  deps: { chat?: typeof chatComplete } = {}
): Promise<CorrectionAudit> {
  const options = parseOptions(question.options);
  const answer = String(question.answer || "").trim();
  if (options.length !== 4 || new Set(options).size !== 4 || !options.includes(answer)) {
    return {
      verdict: "bad_options",
      proposed: null,
      evidence: { reason: "options/answer are not a valid 4-option MCQ", options, answer, pageNumber: page.pageNumber },
    };
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Use only the attached textbook page. Check the question and keyed answer against that page. " +
        'Return JSON only: {"supported":boolean,"quote":"verbatim sentence from the page",' +
        '"correctAnswer":"optional exact option text","outsideTerm":"optional term not on the page","reason":"optional"}',
    },
    {
      role: "user",
      content:
        `Question: ${question.prompt}\n` +
        `Options: ${JSON.stringify(options)}\n` +
        `Keyed answer: ${answer}`,
      images: [{ mimeType: "image/png", data: page.image.toString("base64") }],
    },
  ];

  const chat = deps.chat ?? chatComplete;
  const result = await chat(cfg, model, messages);
  const parsed = extractObject(result.text);
  const quote = String(parsed.quote || "").trim();
  const evidence = { quote, pageNumber: page.pageNumber, method: "vision" as const, reason: parsed.reason || null };

  if (parsed.outsideTerm) {
    return { verdict: "outside_book", proposed: null, evidence: { ...evidence, outsideTerm: String(parsed.outsideTerm) } };
  }
  if (parsed.supported === true) {
    if (!quote) {
      return { verdict: "not_found", proposed: null, evidence: { ...evidence, reason: "no supporting quote" } };
    }
    if (page.text && !isQuoteOnPage(page.text, quote)) {
      return { verdict: "wrong_page", proposed: null, evidence: { ...evidence, reason: "quote not on claimed page" } };
    }
    return { verdict: "ok", proposed: null, evidence };
  }

  const correct = String(parsed.correctAnswer || "").trim();
  if (correct && options.includes(correct)) {
    return {
      verdict: "wrong_answer",
      proposed: { answer: correct },
      evidence: { ...evidence, reason: parsed.reason || "keyed answer not supported" },
    };
  }
  if (correct) {
    return {
      verdict: "needs manual edit",
      proposed: { answer: correct },
      evidence: { ...evidence, reason: "proposed answer is not one of the existing options" },
    };
  }
  return { verdict: "not_found", proposed: null, evidence: { ...evidence, reason: parsed.reason || "not supported by the page" } };
}

async function loadPages(batchId: string): Promise<CorrectionPage[]> {
  const db = await getDb();
  const rows = await all(
    db,
    "SELECT page_number,resolved_page_number,page_text,image_path FROM batch_pages WHERE batch_id=? AND resolved_page_number IS NOT NULL ORDER BY resolved_page_number",
    [batchId]
  );
  const pages: CorrectionPage[] = [];
  for (const row of rows) {
    let text = String(row.page_text || "");
    let image = Buffer.alloc(0);
    try {
      if (row.image_path && fs.existsSync(row.image_path)) image = fs.readFileSync(row.image_path);
    } catch {
      image = Buffer.alloc(0);
    }
    if (!text && image.length) {
      try {
        text = await ocrImage(image, ["eng", "ben"]);
        if (text) await run(db, "UPDATE batch_pages SET page_text=? WHERE batch_id=? AND resolved_page_number=?", [text, batchId, row.resolved_page_number]);
      } catch {
        text = "";
      }
    }
    pages.push({ pageNumber: Number(row.resolved_page_number), text, image });
  }
  return pages;
}

export async function runCorrectionStep(runId: string): Promise<{ checked: number; items: any[] }> {
  const db = await getDb();
  const correctionRun = await get(db, "SELECT * FROM correction_runs WHERE id=?", [runId]);
  if (!correctionRun) throw new Error("Correction run not found");
  if (!correctionRun.source_batch_id) throw new Error("A source page-image batch is required");

  const sourceBatch = await get(db, "SELECT provider,model FROM batch_runs WHERE id=?", [correctionRun.source_batch_id]);
  if (!sourceBatch) throw new Error("The source page-image batch was not found");
  const cfg = await getProviderConfig(String(sourceBatch.provider));
  if (!cfg) throw new Error(`The ${sourceBatch.provider} provider is not configured`);

  const pages = await loadPages(String(correctionRun.source_batch_id));
  if (pages.length === 0) throw new Error("The source batch has no confirmed pages");

  let pending = await all(
    db,
    `SELECT ci.*, q.* FROM correction_items ci JOIN questions q ON q.id=ci.question_id
     WHERE ci.run_id=? AND ci.status='pending' ORDER BY ci.created_at LIMIT 10`,
    [runId]
  );

  if (pending.length === 0) {
    const scope = correctionRun.chapter_id
      ? "q.subject_id=? AND q.chapter_id=?"
      : "q.subject_id=?";
    const params = correctionRun.chapter_id
      ? [correctionRun.subject_id, correctionRun.chapter_id, runId]
      : [correctionRun.subject_id, runId];
    const questions = await all(
      db,
      `SELECT q.* FROM questions q
       WHERE ${scope}
         AND NOT EXISTS (SELECT 1 FROM correction_items ci WHERE ci.run_id=? AND ci.question_id=q.id)
       ORDER BY q.created_at LIMIT 10`,
      params
    );
    for (const question of questions) {
      await run(db, `INSERT INTO correction_items
        (id,run_id,question_id,verdict,current_json,proposed_json,evidence_json,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), runId, question.id, "pending", JSON.stringify(question), null, null, "pending", Date.now()]);
    }
    pending = await all(
      db,
      `SELECT ci.*, q.* FROM correction_items ci JOIN questions q ON q.id=ci.question_id
       WHERE ci.run_id=? AND ci.status='pending' ORDER BY ci.created_at LIMIT 10`,
      [runId]
    );
  }

  for (const item of pending) {
    const question = item;
    const claimedNumber = Number(question.page_number);
    const claimed = pages.find((p) => p.pageNumber === claimedNumber) || pages[0];
    let audit = await auditQuestion(question, claimed, cfg, String(sourceBatch.model));

    if ((audit.verdict === "wrong_page" || audit.verdict === "not_found") && pages.length > 1) {
      const others = pages
        .filter((p) => p.pageNumber !== claimed.pageNumber)
        .sort((a, b) => Math.abs(a.pageNumber - claimed.pageNumber) - Math.abs(b.pageNumber - claimed.pageNumber))
        .slice(0, 5);
      for (const page of others) {
        const second = await auditQuestion(question, page, cfg, String(sourceBatch.model));
        if (second.verdict === "ok") {
          audit = {
            verdict: "wrong_page",
            proposed: { page_number: page.pageNumber },
            evidence: { ...second.evidence, correctedFrom: claimed.pageNumber },
          };
          break;
        }
      }
    }

    await run(db, `UPDATE correction_items
      SET verdict=?, current_json=?, proposed_json=?, evidence_json=?, status='proposed'
      WHERE run_id=? AND question_id=?`,
      [audit.verdict, JSON.stringify(question), audit.proposed ? JSON.stringify(audit.proposed) : null,
        JSON.stringify(audit.evidence), runId, question.id]);
  }

  const counts = await all(
    db,
    "SELECT verdict, COUNT(*) AS n FROM correction_items WHERE run_id=? GROUP BY verdict",
    [runId]
  );
  const count = (v: string) => Number(counts.find((r: any) => r.verdict === v)?.n || 0);
  await run(db, `UPDATE correction_runs SET
    checked=(SELECT COUNT(*) FROM correction_items WHERE run_id=?),
    ok=?, wrong_page=?, wrong_answer=?, not_found=?, bad_options=?, outside_book=?
    WHERE id=?`,
    [runId, count("ok"), count("wrong_page"), count("wrong_answer"), count("not_found"),
      count("bad_options"), count("outside_book"), runId]);

  const pendingLeft = await get(db, "SELECT COUNT(*) AS n FROM correction_items WHERE run_id=? AND status='pending'", [runId]);
  const scope = correctionRun.chapter_id ? "q.subject_id=? AND q.chapter_id=?" : "q.subject_id=?";
  const params = correctionRun.chapter_id ? [correctionRun.subject_id, correctionRun.chapter_id, runId] : [correctionRun.subject_id, runId];
  const unanswered = await get(
    db,
    `SELECT COUNT(*) AS n FROM questions q
     WHERE ${scope} AND NOT EXISTS (SELECT 1 FROM correction_items ci WHERE ci.run_id=? AND ci.question_id=q.id)`,
    params
  );
  if (Number(pendingLeft?.n ?? 0) === 0 && Number(unanswered?.n ?? 0) === 0) {
    await run(db, "UPDATE correction_runs SET status='review', completed_at=? WHERE id=?", [Date.now(), runId]);
  } else {
    await run(db, "UPDATE correction_runs SET status='auditing' WHERE id=?", [runId]);
  }

  const items = await all(db, "SELECT * FROM correction_items WHERE run_id=? ORDER BY created_at DESC LIMIT 500", [runId]);
  return { checked: pending.length, items };
}

export async function usageIndex(): Promise<{ exams: Map<string, number>; attempts: Map<string, number> }> {
  const db = await getDb();
  const exams = await all(db, "SELECT question_ids FROM exams");
  const attempts = await all(db, "SELECT answers FROM exam_attempts");
  const examCount = new Map<string, number>();
  const attemptCount = new Map<string, number>();
  for (const row of exams) {
    try {
      const ids = JSON.parse(row.question_ids || "[]");
      if (Array.isArray(ids)) for (const id of ids) examCount.set(String(id), (examCount.get(String(id)) || 0) + 1);
    } catch { /* ignore malformed legacy rows */ }
  }
  for (const row of attempts) {
    try {
      const answers = JSON.parse(row.answers || "{}");
      if (answers && typeof answers === "object") {
        for (const id of Object.keys(answers)) attemptCount.set(String(id), (attemptCount.get(String(id)) || 0) + 1);
      }
    } catch { /* ignore malformed legacy rows */ }
  }
  return { exams: examCount, attempts: attemptCount };
}
