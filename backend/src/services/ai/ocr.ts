import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIError } from "./types";

/**
 * OCR for source material that has no selectable text: uploaded PNG/JPG
 * images and scanned (image-only) PDFs.
 *
 * - Images go straight through tesseract.js.
 * - Scanned PDFs are rasterized page-by-page with pdf-to-img (pdf.js + the
 *   prebuilt @napi-rs/canvas binary) and each page image is OCR'd.
 *
 * Language data ships with the app (see langDataPath) instead of being
 * downloaded from a CDN at run time: serverless bundles are read-only and
 * their network is unreliable, and a hung CDN fetch used to stall the whole
 * request until the platform killed it.
 */

/** Languages the OCR endpoint accepts — keep in sync with the UI pills. */
export const OCR_LANGS = ["eng", "ben"];

/**
 * Bundled tesseract language data. `src/services/ai` sits three levels below
 * the backend root in dev and one level in the built bundle, so both spots are
 * tried. Returns the folder holding `eng.traineddata`/`ben.traineddata`, or
 * null when the files are missing (tesseract then falls back to the CDN, which
 * is slow and can hang, see `withWorker`).
 */
function langDataPath(): string | null {
  const candidates = [
    join(__dirname, "..", "..", "..", "tessdata"),
    join(__dirname, "..", "..", "tessdata"),
    join(process.cwd(), "tessdata"),
    join(process.cwd(), "backend", "tessdata"),
  ];
  for (const dir of candidates) {
    try {
      if (existsSync(join(dir, "eng.traineddata"))) return dir;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Absolute path to the tesseract wasm core that the *worker thread* can load.
 *
 * tesseract.js loads its core inside a `worker_threads` worker, and on Vercel
 * the worker's module resolution does not see the bundled `node_modules`
 * (workers resolve from `/var/task/[worker eval]`, while the package lives at
 * `/var/task/backend/node_modules`). `createWorker`'s `corePath` is passed
 * straight to `require` inside the worker, so handing it an absolute path is
 * what makes the engine start on serverless hosts at all.
 */
function corePath(): string | null {
  try {
    // The .wasm.js twin embeds the wasm; either entry point works.
    return require.resolve("tesseract.js-core/tesseract-core-simd-lstm");
  } catch {
    try {
      return join(require.resolve("tesseract.js-core/package.json"), "..");
    } catch {
      return null;
    }
  }
}

/** Max pages to OCR for one scanned PDF (OCR_MAX_PAGES, default 150). */
function maxOcrPages(): number {
  const n = Number(process.env.OCR_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 150;
}

/** Read a positive millisecond budget from the environment, capped at `max`. */
function envMs(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/**
 * Tesseract caches downloaded language data next to the process cwd by
 * default. On serverless hosts (Vercel) the bundle is read-only, so writes
 * fail and every cold start re-downloads. /tmp is writable and survives for
 * the lifetime of a warm instance.
 */
function cacheDir(): string {
  const dir = process.env.OCR_CACHE_DIR || join(tmpdir(), "mcq-ocr");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return ".";
  }
  return dir;
}

/** Parse the request's ocr_lang ("eng", "ben", "eng+ben") into a safe list. */
export function parseOcrLangs(raw: unknown): string[] {
  const parts = String(raw || "eng").split(/[+,\s]+/).filter(Boolean);
  const langs = [...new Set(parts.filter((p) => OCR_LANGS.includes(p)))];
  return langs.length ? langs : ["eng"];
}

async function withWorker<T>(langs: string[], fn: (worker: any) => Promise<T>): Promise<T> {
  const { createWorker } = await import("tesseract.js");
  // Engine startup only reads local files now, so this is a plain guard.
  const startTimeout = envMs("OCR_START_TIMEOUT_MS", 60_000, 240_000);
  // One upload's worth of recognition; stays under the platform's 300s cap.
  const jobTimeout = envMs("OCR_JOB_TIMEOUT_MS", 240_000, 290_000);

  let worker: any;
  let stage = "starting the OCR engine";
  const logger = (m: any) => {
    if (m?.status && m.status !== stage) {
      stage = m.status;
      console.log(`[ocr] ${m.status}${typeof m.progress === "number" ? ` ${Math.round(m.progress * 100)}%` : ""}`);
    }
  };
  // tesseract.js swallows worker-side errors (its promise chain ends in a
  // bare .catch), so a failed init would hang the request until the host
  // kills it. Log the real error and let the timeout below surface it.
  const errorHandler = (e: any) => {
    console.error("[ocr] worker error:", String(e).slice(0, 500));
  };

  const timed = <V,>(p: Promise<V>, ms: number, what: string) =>
    new Promise<V>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new AIError(
            `OCR timed out while ${what} after ${Math.round(ms / 1000)}s (last stage: ${stage}).`,
            504,
            "Serverless hosts cap how long a request may run. Try a smaller image or a PDF that already has a text layer."
          )
        );
      }, ms);
      p.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });

  const dir = langDataPath();
  const oem = 1; // LSTM_ONLY
  try {
    // Two serverless traps make this setup fussy, and both end in a request
    // that hangs until the host kills it, so the arrangement below is load
    // bearing:
    //
    //   1. The wasm core is loaded inside a `worker_threads` worker. On Vercel
    //      the worker's module resolution does not see the bundled
    //      `node_modules` (workers resolve from `/var/task/[worker eval]`,
    //      while the package sits at `/var/task/backend/node_modules`), so
    //      `require("tesseract.js-core/...")` throws there. An absolute
    //      `corePath` is the only form the worker can resolve.
    //   2. Without `langPath` tesseract downloads the language data from its
    //      CDN on every cold start. Serverless egress to that host stalls, and
    //      because tesseract swallows its own init errors the request just
    //      sits there. Pointing `langPath` at the bundled `tessdata` folder
    //      makes startup a local file read (~0.6s) and needs no cache.
    worker = await timed(
      createWorker(langs, oem, {
        logger,
        errorHandler,
        ...(dir ? { langPath: dir, gzip: false, cacheMethod: "none" } : { cacheMethod: "write", cachePath: cacheDir() }),
        ...(corePath() ? { corePath: corePath() as string } : {}),
      }),
      startTimeout,
      "starting the OCR engine"
    );
  } catch (err: any) {
    if (err instanceof AIError) throw err;
    throw new AIError(
      "OCR could not start — the language data could not be loaded (the server needs internet on first use).",
      502,
      String(err?.message || err).slice(0, 200)
    );
  }
  try {
    return await timed(fn(worker), jobTimeout, "reading the text");
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
  // `pdf-to-img` locates pdf.js with
  //   createRequire(import.meta.url).resolve("pdfjs-dist/package.json")
  // so that file has to exist at run time. Vercel's bundler prunes it (it is
  // data, not code), and because the call inside the dependency is dynamic the
  // tracer never sees it. Resolving it here — statically, from our own code —
  // is what makes the bundler ship it.
  require.resolve("pdfjs-dist/package.json");
  // pdf.js rasterizes through the optional native `@napi-rs/canvas` binding,
  // which it loads dynamically for the current platform. Same story as above:
  // without a static reference the bundler drops it. Resolving the binding
  // itself (not just the wrapper) pulls in the platform binary too.
  try {
    require.resolve("@napi-rs/canvas");
    const { platform, arch } = process;
    const suffix = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
    const libc = platform === "linux" ? "-gnu" : "";
    require.resolve(`@napi-rs/canvas-${suffix}-${arch}${libc}`);
  } catch {
    /* optional: pdf-to-img falls back to a canvas-free path on some hosts */
  }
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
