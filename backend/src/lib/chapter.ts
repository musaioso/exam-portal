// Chapter headings carry the book's own number ("CH. 11: …", "পরিচ্ছেদ ১০: …").
// The app also stores that number in `chapters.number`, and the UI prints both,
// so a mismatched or duplicated prefix confuses students ("Ch. 1 — CH. 11: …").
// This helper is the single place that reads a heading: it returns the number to
// store and the title with the prefix removed.

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const BN_ZERO = BN_DIGITS.charCodeAt(0);

/** Convert Bengali digits to ASCII without touching the rest of the string. */
export function toAsciiDigits(value: string): string {
  return String(value ?? "").replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - BN_ZERO));
}

export type ChapterHeadingKind = "single" | "range" | "none";

export interface ChapterHeading {
  /** Number found in the heading, or null when the heading is a range/absent. */
  number: number | null;
  /** Heading with its number prefix removed; unchanged when no prefix is read. */
  title: string;
  /**
   * `single` is one chapter number, `range` is a composite/multi heading
   * (৩৯-৪৩, ১০ ও ১১, 3 & 4), and `none` has no heading prefix at all.
   */
  kind: ChapterHeadingKind;
}

// "পরিচ্ছেদ" or English "CH." / "Ch" / "Chapter", then one number. A range or
// multi suffix (৩৯-৪৩, ১০ ও ১১, 3 & 4) is read as one unit, with or without
// spaces around its separator. The number must end at a word boundary so titles
// such as "CH. 21st Century" or "পরিচ্ছেদ ১ম" are not mistaken for a heading.
const PREFIX =
  /^(?:পরিচ্ছেদ|ch(?:apter)?\.?|chap\.?)\s*([০-৯0-9]+)((?:\s*[-–—,&/]\s*[০-৯0-9]+|\s+(?:ও|এবং|and|to)\s+[০-৯0-9]+)+)?(?![\p{L}\p{N}])\s*[:：.\-–—|]?\s*/iu;

/**
 * Read a chapter heading.
 *
 * A heading with exactly one number yields that number and a clean title. A
 * range or multi-chapter heading yields `number: null` and the title unchanged,
 * because no single number can represent it and merging it into one chapter
 * would hide part of the syllabus. A heading with no prefix is returned as-is.
 */
export function parseChapterHeading(raw: string): ChapterHeading {
  const text = String(raw ?? "");
  if (!text) return { number: null, title: text, kind: "none" };
  const match = text.match(PREFIX);
  if (!match) return { number: null, title: text, kind: "none" };
  if (match[2]) return { number: null, title: text, kind: "range" };

  const number = Number(toAsciiDigits(match[1]));
  if (!Number.isFinite(number) || number <= 0) return { number: null, title: text, kind: "none" };

  const rest = text.slice(match[0].length).trim();
  // A heading that was only the prefix ("CH. 5") keeps its text as the title.
  return { number, title: rest || text.trim(), kind: "single" };
}
