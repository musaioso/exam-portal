import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ocrImage } from "../ai/ocr";
import type { PageAudit, SourcePage } from "./types";

export function parsePageNumberFromFilename(name: string): number | null {
  const conv = name.match(/conv[\s_-]*(\d{1,4})/i);
  if (conv) return Number(conv[1]);
  const last = name.match(/(\d{1,4})(?=\D*$)/);
  return last ? Number(last[1]) : null;
}

export function inferOpenerPage(
  filenameNumber: number | null,
  previous: number | null,
  next: number | null
): { number: number | null; reason: "agreed" | "next" | "previous" | "filename" | "none" } {
  const values = [
    filenameNumber,
    next != null ? next - 1 : null,
    previous != null ? previous + 1 : null,
  ].filter((n): n is number => n != null);
  if (values.length === 0) return { number: null, reason: "none" };
  const counts = new Map<number, number>();
  for (const n of values) counts.set(n, (counts.get(n) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best[1] >= 2) return { number: best[0], reason: "agreed" };
  if (next != null) return { number: next - 1, reason: "next" };
  if (previous != null) return { number: previous + 1, reason: "previous" };
  return { number: filenameNumber, reason: "filename" };
}

export async function readPrintedNumbers(image: Buffer): Promise<number[]> {
  try {
    const img = await loadImage(image);
    const w = img.width;
    const h = img.height;
    const regions = [
      { x: 0, y: 0, w, h: Math.max(1, Math.floor(h * 0.16)) },
      { x: 0, y: Math.floor(h * 0.84), w, h: Math.max(1, Math.floor(h * 0.16)) },
    ];
    const found: number[] = [];
    for (const r of regions) {
      const canvas = createCanvas(r.w, r.h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const text = await ocrImage(canvas.toBuffer("image/png"), ["eng"]);
      for (const m of text.matchAll(/\b(\d{1,4})\b/g)) found.push(Number(m[1]));
    }
    return [...new Set(found)];
  } catch {
    // A corrupt or unreadable image is "unnumbered", never a crash.
    return [];
  }
}

export async function auditPages(
  pages: SourcePage[],
  deps: { readNumbers?: (image: Buffer) => Promise<number[]> } = {}
): Promise<PageAudit[]> {
  const read = deps.readNumbers ?? readPrintedNumbers;
  const sorted = [...pages].sort(
    (a, b) => (a.filenameNumber ?? Number.MAX_SAFE_INTEGER) - (b.filenameNumber ?? Number.MAX_SAFE_INTEGER)
  );
  const audits: PageAudit[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i];
    const numbers = page.image.length ? await read(page.image).catch(() => []) : [];
    const printedNumber = numbers.length
      ? numbers.reduce((best, n) =>
          page.filenameNumber != null && Math.abs(n - page.filenameNumber) < Math.abs(best - page.filenameNumber) ? n : best
        )
      : null;
    if (page.filenameNumber == null) {
      const previous = sorted[i - 1]?.filenameNumber ?? null;
      const next = sorted[i + 1]?.filenameNumber ?? null;
      const inferred = inferOpenerPage(null, previous, next);
      audits.push({
        sourceFile: page.sourceFile,
        filenameNumber: null,
        printedNumber,
        auditStatus: "unnumbered",
        resolvedPageNumber: null,
        proposedNumber: inferred.number,
        reason: inferred.reason,
      });
      continue;
    }
    if (printedNumber == null) {
      audits.push({
        sourceFile: page.sourceFile,
        filenameNumber: page.filenameNumber,
        printedNumber: null,
        auditStatus: "unnumbered",
        resolvedPageNumber: null,
        proposedNumber: page.filenameNumber,
        reason: "no printed number",
      });
      continue;
    }
    const match = printedNumber === page.filenameNumber;
    audits.push({
      sourceFile: page.sourceFile,
      filenameNumber: page.filenameNumber,
      printedNumber,
      auditStatus: match ? "match" : "mismatch",
      resolvedPageNumber: match ? page.filenameNumber : null,
      proposedNumber: page.filenameNumber,
      reason: match ? "printed number matches filename" : `printed ${printedNumber}, filename ${page.filenameNumber}`,
    });
  }
  return audits;
}
