import { AIError } from "./types";

/**
 * OCR for source material that has no selectable text: uploaded PNG/JPG
 * images and scanned (image-only) PDFs.
 *
 * - Images go straight through tesseract.js.
 * - Scanned PDFs are rasterized page-by-page with pdf-to-img (pdf.js + the
 *   prebuilt @napi-rs/canvas binary) and each page image is OCR'd.
 *
 * Tesseract downloads its language data (~4 MB eng, ~15 MB ben) from the
 * CDN on first use and caches it on disk; from then on OCR works offline.
 */

/** Languages the OCR endpoint accepts — keep in sync with the UI pills. */
export const OCR_LANGS = ["eng", "ben"];

/** Max pages to OCR for one scanned PDF (OCR_MAX_PAGES, default 150). */
function maxOcrPages(): number {
  const n = Number(process.env.OCR_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 150;
}

/** Parse the request's ocr_lang ("eng", "ben", "eng+ben") into a safe list. */
export function parseOcrLangs(raw: unknown): string[] {
  const parts = String(raw || "eng").split(/[+,\s]+/).filter(Boolean);
  const langs = [...new Set(parts.filter((p) => OCR_LANGS.includes(p)))];
  return langs.length ? langs : ["eng"];
}

async function withWorker<T>(langs: string[], fn: (worker: any) => Promise<T>): Promise<T> {
  const { createWorker } = await import("tesseract.js");
  let worker: any;
  try {
    // v5+ takes the languages up front and downloads/validates the data here —
    // a CDN failure surfaces as a readable 502 instead of a hung request.
    worker = await createWorker(langs);
  } catch (err: any) {
    throw new AIError(
      "OCR could not start — the language data could not be downloaded (the server needs internet on first use).",
      502,
      String(err?.message || err).slice(0, 200)
    );
  }
  try {
    return await fn(worker);
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/** OCR a list of image buffers with one shared worker. Returns text per image. */
export async function ocrImages(images: Buffer[], langs: string[]): Promise<string[]> {
  if (images.length === 0) return [];
  return withWorker(langs, async (worker) => {
    const out: string[] = [];
    for (const image of images) {
      const { data } = await worker.recognize(image);
      out.push(String(data?.text || ""));
    }
    return out;
  });
}

/** OCR a single image (PNG/JPEG upload). */
export async function ocrImage(image: Buffer, langs: string[]): Promise<string> {
  const [text] = await ocrImages([image], langs);
  return text;
}

export interface OcrPdfResult {
  /** One OCR'd string per page, in page order */
  pages: string[];
  charCount: number;
  /** True when OCR stopped early at OCR_MAX_PAGES */
  capped: boolean;
  totalPages: number;
}

/** Render a scanned PDF to page images and OCR each one. */
export async function ocrPdf(buffer: Buffer, langs: string[]): Promise<OcrPdfResult> {
  const { pdf } = await import("pdf-to-img");
  const cap = maxOcrPages();

  let document: any;
  try {
    // JPEG pages are smaller and faster to OCR than PNG.
    document = await pdf(buffer, { scale: 2, format: "jpg" });
  } catch (err: any) {
    throw new AIError("This PDF could not be rendered for OCR.", 400, String(err?.message || err).slice(0, 200));
  }

  const totalPages = Number(document.length) || 0;

  // One worker for the whole document; recognize as pages come off the
  // renderer so only a single page image is held in memory at a time.
  const pages = await withWorker(langs, async (worker) => {
    const out: string[] = [];
    let done = false;
    try {
      for await (const image of document) {
        if (out.length >= cap) {
          done = true;
          break;
        }
        const { data } = await worker.recognize(image as Buffer);
        out.push(String(data?.text || ""));
      }
    } finally {
      await document.destroy?.().catch(() => {});
    }
    return { pages: out, capped: done };
  });

  const charCount = pages.pages.reduce((n, p) => n + p.length, 0);
  return { pages: pages.pages, charCount, capped: pages.capped, totalPages };
}
