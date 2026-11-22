/**
 * NotebookLM replies arrive wrapped in ``` fences, with a sentence of prose
 * before or after the JSON and `[1]` citation markers inside the text. The
 * sanitiser is a pure string function so the paste preview (Phase 4) can run
 * the exact same cleanup before the reply is POSTed.
 */
const CURLY: Array<[RegExp, string]> = [
  [/[\u201C\u201D]/g, '"'],
  [/[\u2018\u2019\u201B]/g, "'"],
];
const FENCE = /```[A-Za-z0-9_-]*[ \t]*\r?\n?/g;
// A citation is removed with the space in front of it, so "Padma [1]?" becomes
// "Padma?" rather than "Padma ?". Newlines are left alone.
const CITATION = /[ \t]*\[\d+\]/g;

/** The JSON value from the first `{`/`[` through its matching close bracket. */
function outerValue(text: string): string {
  const start = text.search(/[[{]/);
  if (start < 0) return text;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

export function sanitizeReply(raw: string): string {
  let text = String(raw ?? "");
  for (const [pattern, replacement] of CURLY) text = text.replace(pattern, replacement);
  text = text.replace(FENCE, "");
  text = text.replace(CITATION, "");
  text = outerValue(text);
  // A trailing comma is the other thing a chat model reliably gets wrong.
  text = text.replace(/,\s*([}\]])/g, "$1");
  return text.trim();
}

export function parseReply(raw: string): unknown {
  const text = sanitizeReply(raw);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The reply does not contain valid JSON");
  }
}
