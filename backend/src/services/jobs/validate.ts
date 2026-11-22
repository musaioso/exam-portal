/**
 * Row validation for a pasted NotebookLM reply. Each function returns the
 * normalised row or throws with the per-row reason the teacher sees; nothing
 * here touches the database.
 */
export type Difficulty = "easy" | "medium" | "hard";

export interface McqRow {
  prompt: string;
  options: string[];
  answer: string;
  explanation: string | null;
  page_number: unknown;
  section: string | null;
  source_quote: string | null;
  difficulty: Difficulty;
}

export interface WrittenRow {
  prompt: string;
  answer: string | null;
  explanation: string | null;
  page_number: unknown;
  section: string | null;
  source_quote: string | null;
  difficulty: Difficulty;
  /** Present when the reply supplies it; the importer falls back to the pattern. */
  marks?: number;
}

export interface PassagePart {
  question: string;
  answer: string;
  scheme: string;
  marks?: number;
}

export interface PassageRow {
  stem: string;
  parts: PassagePart[];
  page_number: unknown;
  section: string | null;
  source_quote: string | null;
  difficulty: Difficulty;
}

function object(value: unknown, label = "row"): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, any>;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function optionalText(value: unknown): string | null {
  const value2 = text(value);
  return value2 === "" ? null : value2;
}

function difficulty(value: unknown): Difficulty {
  return value === "easy" || value === "medium" || value === "hard" ? value : "medium";
}

function sourcePage(item: Record<string, any>): unknown {
  return item.page ?? item.page_number ?? null;
}

export function validateMcq(item: unknown): McqRow {
  const row = object(item);
  const prompt = text(row.prompt);
  if (!prompt) throw new Error("prompt is required");

  const options = Array.isArray(row.options) ? row.options.map(text) : [];
  if (options.length !== 4 || options.some((option) => option === "") || new Set(options).size !== 4) {
    throw new Error("mcq needs exactly 4 unique options");
  }

  // NotebookLM often writes the key as A/B/C/D rather than repeating the text.
  let answer = text(row.answer);
  if (/^[A-D]$/i.test(answer)) answer = options["ABCD".indexOf(answer.toUpperCase())];
  if (!answer || !options.includes(answer)) throw new Error("answer must be one of the 4 options");

  return {
    prompt,
    options,
    answer,
    explanation: optionalText(row.explanation),
    page_number: sourcePage(row),
    section: optionalText(row.section),
    source_quote: optionalText(row.source_quote),
    difficulty: difficulty(row.difficulty),
  };
}

export function validateWritten(item: unknown): WrittenRow {
  const row = object(item);
  const prompt = text(row.prompt);
  if (!prompt) throw new Error("prompt is required");

  const options = row.options;
  const hasOptions = Array.isArray(options) ? options.length > 0 : text(options) !== "";
  if (hasOptions) throw new Error("a written question must not have options");

  const marks = Number(row.marks);
  return {
    prompt,
    answer: optionalText(row.answer),
    explanation: optionalText(row.explanation),
    page_number: sourcePage(row),
    section: optionalText(row.section),
    source_quote: optionalText(row.source_quote),
    difficulty: difficulty(row.difficulty),
    ...(Number.isFinite(marks) && marks > 0 ? { marks: Math.floor(marks) } : {}),
  };
}

export function validatePassage(item: unknown, partMarks: number[]): PassageRow {
  const row = object(item);
  const stem = text(row.stem);
  if (!stem) throw new Error("stem is required");
  if (!Array.isArray(row.parts)) throw new Error("parts must be an array");
  if (row.parts.length !== partMarks.length) {
    throw new Error(`expected ${partMarks.length} parts, got ${row.parts.length}`);
  }

  const parts = row.parts.map((raw: unknown, index: number) => {
    const part = object(raw, `part ${index + 1}`);
    if (part.marks != null && Number(part.marks) !== partMarks[index]) {
      throw new Error("part marks do not match the pattern");
    }
    const question = text(part.question);
    const answer = text(part.answer);
    const scheme = text(part.scheme);
    if (!question) throw new Error(`part ${index + 1} needs a question`);
    if (!answer) throw new Error(`part ${index + 1} needs an answer`);
    if (!scheme) throw new Error(`part ${index + 1} needs a scheme`);
    return { question, answer, scheme };
  });

  return {
    stem,
    parts,
    page_number: sourcePage(row),
    section: optionalText(row.section),
    source_quote: optionalText(row.source_quote),
    difficulty: difficulty(row.difficulty),
  };
}
