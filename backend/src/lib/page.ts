/**
 * The two stored forms of a question's book reference: the free-text `page`
 * ("42-43" survives as typed) and the whole-number `page_number` used where
 * only a single page makes sense.
 *
 * Importers and vision/AI pipelines sometimes put the scanned-page *filename*
 * in the page field ("BGS conv 55.png"). That is not a page label, so the
 * trailing number is taken as the page instead — otherwise students see the
 * filename in results. Anything that is not a filename is kept verbatim.
 */
const FILE_EXT = /\.(?:png|jpe?g|webp|gif|bmp|tiff?|pdf)$/i;
const TRAILING_RANGE = /(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*$/;

export interface SourcePage {
  page: string | null;
  page_number: number | null;
}

export function parseSourcePage(raw: unknown): SourcePage {
  if (raw === null || raw === undefined) return { page: null, page_number: null };
  const text = String(raw).trim();
  if (text === "") return { page: null, page_number: null };

  const n = Number(text);
  if (Number.isFinite(n) && n > 0) {
    return { page: text, page_number: Math.floor(n) };
  }

  if (FILE_EXT.test(text)) {
    const stem = text.replace(FILE_EXT, "");
    const m = stem.match(TRAILING_RANGE);
    if (m) {
      const from = Number(m[1]);
      if (from > 0) {
        const page = m[2] ? `${m[1]}-${m[2]}` : m[1];
        return { page, page_number: from };
      }
    }
    // No usable number in the name ("scan.png") — a filename is never a page.
    return { page: null, page_number: null };
  }

  return { page: text, page_number: null };
}
