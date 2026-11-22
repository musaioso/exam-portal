// Option labels for MCQ questions. Bangla questions (prompt contains Bangla
// script) use ক খ গ ঘ …; English questions use A B C D … . Matches the logic
// already used in the print preview (src/lib/printTemplate.ts).
const BN = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ"];
const EN = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function isBangla(text: string | null | undefined): boolean {
  return /[\u0980-\u09FF]/.test(String(text || ""));
}

export function optionLabels(prompt: string | null | undefined): string[] {
  return isBangla(prompt) ? BN : EN;
}

export function optionLabel(prompt: string | null | undefined, index: number): string {
  const letters = isBangla(prompt) ? BN : EN;
  return letters[index] || String(index + 1);
}

/**
 * The book's own word for a chapter. Bangla 2nd Paper uses পরিচ্ছেদ, Bangla 1st
 * Paper uses গদ্য / পদ্য for its prose and poetry pieces, and the other books
 * fall back to "Ch." The value is stored on the chapter so a label never has to
 * guess from the title.
 */
export type ChapterPart = "oddhay" | "poricched" | "godyo" | "podyo";

const CHAPTER_WORDS: Record<ChapterPart, string> = {
  oddhay: "অধ্যায়",
  poricched: "পরিচ্ছেদ",
  godyo: "গদ্য",
  podyo: "পদ্য",
};

export function chapterWord(part?: string | null): string {
  return part && Object.prototype.hasOwnProperty.call(CHAPTER_WORDS, part)
    ? CHAPTER_WORDS[part as ChapterPart]
    : "Ch.";
}

type ChapterLike = { number?: number | null; title?: string | null; part?: string | null } | null | undefined;

/** "Ch.3 Title" for English books, "পরিচ্ছেদ ৩ — শিরোনাম" for Bangla ones. */
export function chapterLabel(chapter: ChapterLike): string {
  if (!chapter) return "";
  const word = chapterWord(chapter.part);
  const title = chapter.title ? String(chapter.title) : "";
  // Bangla 1st Paper does not number its prose and poems, so its label carries
  // only the section word and the piece name.
  const noNumber = chapter.part === "godyo" || chapter.part === "podyo";
  if (noNumber) return `${word}${title ? ` — ${title}` : ""}`.trim();
  const number = chapter.number != null
    ? (word === "Ch." ? String(chapter.number) : toBnDigits(chapter.number))
    : "";
  if (word === "Ch.") return `Ch.${number}${title ? ` ${title}` : ""}`.trim();
  return `${word} ${number}${title ? ` — ${title}` : ""}`.trim();
}

/** Prefix and number only, for tight chips: "Ch.3", "গদ্য". */
export function chapterShort(chapter: ChapterLike): string {
  if (!chapter) return "";
  const word = chapterWord(chapter.part);
  if (chapter.part === "godyo" || chapter.part === "podyo") return word;
  const number = chapter.number != null
    ? (word === "Ch." ? String(chapter.number) : toBnDigits(chapter.number))
    : "";
  return word === "Ch." ? `Ch.${number}` : `${word} ${number}`.trim();
}

/** Always show a Bengali number for the Bangla part words (৩, ১০, …). */
export function toBnDigits(value: string | number): string {
  return String(value ?? "").replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

/**
 * The book/source page stored with a question. Prefers the free-text form so a
 * range like "42-43" survives; falls back to the numeric importer value.
 *
 * Older imports sometimes stored the scanned-page filename ("BGS conv 55.png")
 * instead of a page. Showing that to a student is meaningless, so the trailing
 * number in the name is used (or nothing when the name has no number).
 */
const FILE_EXT = /\.(?:png|jpe?g|webp|gif|bmp|tiff?|pdf)$/i;
const TRAILING_RANGE = /(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*$/;

export function sourcePage(q: { page?: unknown; page_number?: unknown } | null | undefined): string {
  if (!q) return "";
  const text = q.page != null && String(q.page).trim() !== ""
    ? String(q.page)
    : q.page_number != null
      ? String(q.page_number)
      : "";
  const trimmed = text.trim();
  if (FILE_EXT.test(trimmed)) {
    const m = trimmed.replace(FILE_EXT, "").match(TRAILING_RANGE);
    return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : "";
  }
  return trimmed;
}