/**
 * PDF text extraction via unpdf (pdf.js running without a browser — works
 * under tsx locally and in Vercel serverless, unlike pdf-parse).
 *
 * Pages are returned as separate strings so generation can target a page
 * range of a big book without shipping the whole text into the prompt.
 */

export interface ExtractedPdf {
  pages: string[];
  totalPages: number;
}

export async function extractPdfPages(buffer: Buffer): Promise<ExtractedPdf> {
  // Dynamic import: unpdf ships ESM only; importing at call time keeps the
  // CommonJS backend entry working on every Node version.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [String(text ?? "")]).map((p) => String(p ?? ""));
  return { pages, totalPages: totalPages || pages.length };
}
