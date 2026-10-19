import { Router, Request, Response } from "express";
import multer from "multer";
import { randomUUID as uuid } from "node:crypto";
import { getDb, run, get, all } from "../db/database";
import { requireAuth, requireRole } from "../middleware/auth";
import { extractPdfPages } from "../services/ai/extract";
import { ocrImage, ocrPdf, parseOcrLangs } from "../services/ai/ocr";

/**
 * Source uploads for the AI generator (teacher/admin only).
 *
 * Multiple files per request: PDFs, PNGs and JPEGs. Everything is parsed in
 * memory and only the extracted TEXT is stored (in ai_documents) — no files
 * on disk, so this behaves the same on local SQLite and on Vercel/Turso.
 *
 * Text comes from three places:
 *   1. PDFs with a text layer   → unpdf extraction (fast, exact per page)
 *   2. Images                   → tesseract.js OCR
 *   3. Scanned/image-only PDFs  → page rasterization + OCR (path 2 on pages)
 *
 * Page text is kept as a JSON array per document for exact page-range
 * generation. "kind" ("pdf" | "image") is kept for the UI's file list.
 *
 * Note: Vercel caps request bodies at ~4.5 MB and functions time out, so OCR
 * of big scanned books is a local/deployed-server feature.
 */

const router = Router();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 12;

const OK_PDF = "application/pdf";
const OK_PNG = "image/png";
const OK_JPEG = "image/jpeg";

const isPdf = (f: { mimetype?: string; originalname?: string }) =>
  f.mimetype === OK_PDF || /\.pdf$/i.test(f.originalname || "");
const isImage = (f: { mimetype?: string; originalname?: string }) =>
  f.mimetype === OK_PNG || f.mimetype === OK_JPEG || /\.(png|jpe?g)$/i.test(f.originalname || "");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if (isPdf(file) || isImage(file)) cb(null, true);
    else cb(new Error("Only PDF, PNG and JPEG files are supported"));
  },
});

router.use(requireAuth, requireRole("admin", "teacher"));

/** multer errors (size/count/type) deserve a 400 with a readable message, not a bare 500. */
function receiveFiles(req: Request, res: Response, next: (err?: any) => void) {
  upload.any()(req, res, (err: any) => {
    if (!err) return next();
    const msg =
      err?.code === "LIMIT_FILE_SIZE"
        ? `A file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
        : err?.code === "LIMIT_FILE_COUNT"
          ? `You can upload at most ${MAX_FILES_PER_REQUEST} files at once.`
          : err?.message || "Upload failed.";
    res.status(400).json({ error: msg });
  });
}

/**
 * One uploaded file → a stored ai_documents row (pages as a JSON array).
 * Returns the row plus an optional warning (e.g. OCR cap hit).
 */
async function ingest(file: Express.Multer.File, ocrLangs: string[]): Promise<{ doc: any; warning?: string }> {
  const name = String(file.originalname || "source")
    .replace(/\.(pdf|png|jpe?g)$/i, "")
    .slice(0, 200) || "source";

  if (isImage(file)) {
    // Images never have a text layer — OCR them directly.
    const text = await ocrImage(file.buffer, ocrLangs);
    if (text.trim().length < 3) {
      throw new Error(`No readable text was found in "${file.originalname}". Is the image sharp enough and big enough?`);
    }
    return {
      doc: { name, pages: 1, char_count: text.length, content: JSON.stringify([text]), kind: "image" },
    };
  }

  const { pages, totalPages } = await extractPdfPages(file.buffer);
  let textPages = pages;
  let charCount = pages.reduce((n, p) => n + p.length, 0);
  let warning: string | undefined;

  // A real text layer holds at least a few chars per page. Below that the
  // PDF is scanned — rasterize and OCR instead.
  const sparseThreshold = Math.max(30, totalPages * 12);
  if (charCount < sparseThreshold) {
    try {
      const ocr = await ocrPdf(file.buffer, ocrLangs);
      if (ocr.charCount > charCount) {
        textPages = ocr.pages;
        charCount = ocr.charCount;
        if (ocr.capped) {
          warning = `OCR stopped at page ${ocr.pages.length} of ${ocr.totalPages} (server OCR_MAX_PAGES limit).`;
        }
      } else if (charCount === 0) {
        throw new Error(`OCR found no text in "${file.originalname}" either — the pages may be too low-quality.`);
      }
      // else: the text layer beat OCR — keep it.
    } catch (err: any) {
      // No usable OCR result. Fail only when there is no text layer at all.
      if (charCount === 0) throw err;
      warning = `OCR was skipped for this PDF (${String(err?.message || err).slice(0, 160)}) — its text layer was used instead.`;
    }
  }

  if (charCount < 1) throw new Error(`No text could be extracted from "${file.originalname}".`);
  return {
    doc: { name, pages: totalPages, char_count: charCount, content: JSON.stringify(textPages), kind: "pdf" },
    warning,
  };
}

/**
 * POST /api/documents — one or many files in a single request.
 * Field name doesn't matter (multer .any()); the frontend sends "file".
 * ocr_lang: "eng" | "ben" | "eng+ben" (which tesseract languages to use).
 */
router.post("/", receiveFiles, async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded (expected multipart field "file").' });
  }
  const ocrLangs = parseOcrLangs((req.body as any)?.ocr_lang);

  const db = await getDb();
  const documents: any[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const file of files) {
    try {
      const { doc, warning } = await ingest(file, ocrLangs);
      const id = uuid();
      await run(
        db,
        "INSERT INTO ai_documents (id,name,pages,char_count,content,uploaded_by,created_at,kind) VALUES (?,?,?,?,?,?,?,?)",
        [id, doc.name, doc.pages, doc.char_count, doc.content, req.user!.id, Date.now(), doc.kind]
      );
      documents.push({
        id,
        name: doc.name,
        pages: doc.pages,
        char_count: doc.char_count,
        kind: doc.kind,
        created_at: Date.now(),
        ...(warning ? { warning } : {}),
      });
    } catch (err: any) {
      errors.push({ name: String(file.originalname || "file"), error: String(err?.message || err) });
    }
  }

  // Everything failed → one readable error (the first file's message).
  if (documents.length === 0) {
    return res.status(400).json({ error: errors[0]?.error || "No file could be processed." });
  }
  res.json({ documents, ...(errors.length ? { errors } : {}) });
});

/** Metadata only — the extracted text can be megabytes; it is read server-side at generation. */
router.get("/", async (_req: Request, res: Response) => {
  const db = await getDb();
  const rows = (await all(
    db,
    "SELECT id,name,pages,char_count,kind,uploaded_by,created_at FROM ai_documents ORDER BY created_at DESC"
  )) as any[];
  res.json({ documents: rows });
});

router.get("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  const row = (await get(
    db,
    "SELECT id,name,pages,char_count,kind,uploaded_by,created_at FROM ai_documents WHERE id=?",
    [req.params.id]
  )) as any;
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ document: row });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const db = await getDb();
  await run(db, "DELETE FROM ai_documents WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

export default router;
