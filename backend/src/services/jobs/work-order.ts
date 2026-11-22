import type { PatternPart, PatternRecord } from "./patterns";
import type { JobRecord } from "./store";

export interface WorkOrderInput {
  job: JobRecord;
  subject: { code: string | null; name: string };
  chapter: { number: number; title: string };
  pattern: PatternRecord;
  kind: "mcq" | "short" | "passage";
  count: number;
  avoid: string[];
  remaining: number;
}

const KIND_LABEL: Record<string, string> = {
  mcq: "MCQ",
  short: "Short",
  long: "Long",
  passage: "Passage",
};

const PLURAL: Record<WorkOrderInput["kind"], string> = {
  mcq: "MCQs",
  short: "questions",
  passage: "passages",
};

function markLabel(marks: number): string {
  return `${marks} ${marks === 1 ? "mark" : "marks"}`;
}

function describePattern(parts: PatternPart[]): string[] {
  return parts.map((part) => {
    if (part.kind === "passage" && part.parts && part.parts.length > 0) {
      const detail = part.parts
        .map((child, index) => `part ${index + 1} (${child.kind}) — ${markLabel(child.marks ?? 0)}`)
        .join(", ");
      return `- Passage — one stem, ${part.parts.length} parts: ${detail}`;
    }
    return `- ${KIND_LABEL[part.kind] ?? part.kind} — ${markLabel(part.marks ?? 0)}`;
  });
}

function kindRules(input: WorkOrderInput): string[] {
  const { pattern, kind } = input;

  if (kind === "mcq") {
    return [
      'Output exactly one JSON object: {"questions":[{"prompt":"...","options":["...","...","...","..."],"answer":"...","explanation":"...","page_number":null,"section":"...","source_quote":"...","difficulty":"medium"}]}',
      "Every MCQ has exactly 4 unique options. The answer is one of those four options, copied verbatim (A, B, C or D is also accepted).",
    ];
  }

  if (kind === "short") {
    const part = pattern.parts.find((entry) => entry.kind === "short");
    const marks = part?.marks ?? 2;
    return [
      'Output exactly one JSON object: {"questions":[{"prompt":"...","answer":"...","explanation":"...","page_number":null,"section":"...","source_quote":"...","difficulty":"medium"}]}',
      `Each question is worth ${markLabel(marks)}. Questions are standalone: no stem and no choices.`,
    ];
  }

  const passagePart = pattern.parts.find((entry) => entry.kind === "passage" && entry.parts?.length);
  const children = passagePart?.parts ?? [];
  const order = children
    .map((child, index) => `part ${index + 1} — ${markLabel(child.marks ?? 0)}`)
    .join("; ");
  return [
    'Output exactly one JSON object: {"passages":[{"stem":"...","parts":[{"question":"...","answer":"...","scheme":"..."}]}]}',
    `Each passage has one stem and exactly ${children.length} parts, in this order: ${order}.`,
    "Write only the question text in each part. Do not repeat the stem inside a part and do not add part letters — the import adds them.",
  ];
}

function avoidBlock(avoid: string[]): string[] {
  if (avoid.length === 0) {
    return ["Do not repeat these — they already exist in this chapter:", "None yet — this is the first run."];
  }
  return [
    "Do not repeat these — they already exist in this chapter:",
    ...avoid.map((entry, index) => `${index + 1}. ${entry}`),
  ];
}

function targetsLine(input: WorkOrderInput): string {
  const targets = input.job.targets ?? {};
  return `Targets for this job: ${targets.mcq ?? 0} MCQ, ${targets.short ?? 0} short, ${targets.passage ?? 0} passages.`;
}

/**
 * The teacher's work order, rendered from the stored pattern so a format is one
 * row edit rather than a prompt retyped per chapter. Seven sections: role and
 * exam, chapter identity, output contract, kind rules from the pattern, the
 * chapter's avoid list, the count, and the page-number claim.
 */
export function renderWorkOrder(input: WorkOrderInput): string {
  const { job, subject, chapter, pattern, kind, count, remaining, avoid } = input;
  const label = job.exam_label || "SSC 2027";
  const subjectLine = subject.code ? `${subject.code} — ${subject.name}` : subject.name;

  const sections: string[][] = [
    [
      `You are a question setter for ${label} (class 9–10). Write in the language of the source chapter.`,
    ],
    [
      `Subject: ${subjectLine}`,
      `Chapter ${chapter.number}: ${chapter.title}`,
    ],
    [
      "Return one JSON object only. No Markdown fences, no citation markers such as [1], no prose before or after, and keep the key names exactly as shown.",
    ],
    [
      `This job's pattern (${pattern.name}):`,
      ...describePattern(pattern.parts),
      ...kindRules(input),
    ],
    avoidBlock(avoid),
    [
      targetsLine(input),
      `Before this run, ${remaining} ${PLURAL[kind]} remain.`,
      `Write ${count} ${PLURAL[kind]} now. If the source cannot support that many, return fewer rather than invent.`,
    ],
    [
      "Page numbers: give the printed page as page_number for each question or passage. If you are not sure of the printed page, write null. A guess is worse than null.",
    ],
  ];

  return sections.map((lines) => lines.join("\n")).join("\n\n");
}
