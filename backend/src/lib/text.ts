/**
 * Two questions count as the same question when their prompts match once the
 * cosmetic differences are ignored: letter case, spacing, punctuation (English
 * and the Bangla danda "।") and Bangla vs ASCII digits. Punctuation becomes a
 * space rather than disappearing so "১.৫" never collapses into "১৫".
 *
 * Shared by the question routes (create/import/duplicate scans) and the AI
 * generator (flagging generated questions that already exist), so every path
 * into the question bank agrees on what "duplicate" means.
 */
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const PUNCTUATION = /[?!.,;:"'`।॥\-_/\\()[\]{}*#+=~|@$%^&<>]/g;

export function normalizeText(input: unknown): string {
  return String(input ?? "")
    .normalize("NFC")  // merge composed/decomposed Bangla forms (য় vs য+়)
    .replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
