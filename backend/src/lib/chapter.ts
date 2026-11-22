// Chapter headings carry the book's own number ("CH. 11: …", "পরিচ্ছেদ ১০: …",
// "অধ্যায় ৩: …"). The app also stores that number in `chapters.number`, and the
// UI prints both, so a mismatched or duplicated prefix confuses students
// ("Ch. 1 — CH. 11: …"). This helper is the single place that reads a heading:
// it returns the number to store and the title with the prefix removed.

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const BN_ZERO = BN_DIGITS.charCodeAt(0);

/** The book's own word for a chapter. */
export type ChapterPart = "oddhay" | "poricched" | "godyo" | "podyo";

const PART_WORDS: Record<string, ChapterPart> = {
  "অধ্যায়": "oddhay",
  "পরিচ্ছেদ": "poricched",
  "গদ্য": "godyo",
  "পদ্য": "podyo",
};

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
  /**
   * The book's own word for the chapter, when the heading carries one. Bangla
   * 2nd Paper uses পরিচ্ছেদ, Bangla 1st Paper uses গদ্য / পদ্য, and other books
   * use অধ্যায় or the English "Chapter"/"CH." (which maps to null).
   */
  part: ChapterPart | null;
}

// A Bangla part word, or English "CH." / "Ch" / "Chapter", then one number. A
// range or multi suffix (৩৯-৪৩, ১০ ও ১১, 3 & 4) is read as one unit, with or
// without spaces around its separator. The number must end at a word boundary
// so titles such as "CH. 21st Century" or "পরিচ্ছেদ ১ম" are not mistaken for a
// heading.
const PREFIX =
  /^(?:(অধ্যায়|পরিচ্ছেদ|গদ্য|পদ্য)|ch(?:apter)?\.?|chap\.?)\s*([০-৯0-9]+)((?:\s*[-–—,&/]\s*[০-৯0-9]+|\s+(?:ও|এবং|and|to)\s+[০-৯0-9]+)+)?(?![\p{L}\p{N}\p{M}])\s*[:：.\-–—|]?\s*/iu;

// A part word with no number at all: "গদ্য: সুভা", "পদ্য — বোশেখ". The word
// must not run into a longer word ("পদ্যাংশ"): combining marks count too.
const BARE_PART =
  /^(অধ্যায়|পরিচ্ছেদ|গদ্য|পদ্য)(?![\p{L}\p{N}\p{M}])\s*[:：.\-–—|]?\s*/iu;

const partOf = (word: string | undefined): ChapterPart | null =>
  word ? PART_WORDS[word] ?? null : null;

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
  if (!text) return { number: null, title: text, kind: "none", part: null };

  const match = text.match(PREFIX);
  if (match) {
    const part = partOf(match[1]);
    if (match[3]) return { number: null, title: text, kind: "range", part };

    const number = Number(toAsciiDigits(match[2]));
    if (!Number.isFinite(number) || number <= 0) {
      return { number: null, title: text, kind: "none", part };
    }
    const rest = text.slice(match[0].length).trim();
    // A heading that was only the prefix ("CH. 5") keeps its text as the title.
    return { number, title: rest || text.trim(), kind: "single", part };
  }

  // "গদ্য: সুভা" has a part but no number. Strip the word so the stored title is
  // just the piece name; the UI prints the part itself in front of the number.
  const bare = text.match(BARE_PART);
  if (bare) {
    const part = partOf(bare[1]);
    const rest = text.slice(bare[0].length).trim();
    // "পরিচ্ছেদ ১ম: প্রথম" is an ordinal, not a chapter number — keep it whole.
    if (!rest || /^[০-৯0-9]/.test(rest)) {
      return { number: null, title: text, kind: "none", part };
    }
    return { number: null, title: rest, kind: "none", part };
  }

  return { number: null, title: text, kind: "none", part: null };
}
