import { AIError, ChatImage, ProviderConfig } from "./types";
import { chatComplete } from "./chat";
import { getProviderConfig, providerSummaries } from "./providers";
import { listModelIds, supportsVision } from "./models";

/**
 * Vision-model OCR — the high-accuracy path for scanned Bangla pages.
 *
 * Tesseract (see ocr.ts) is free and fast but turns small or low-contrast
 * Bangla print into Latin garbage while still reporting a healthy character
 * count. A vision model reads those same pages correctly, so this module is
 * offered as an explicit "read with AI" choice rather than a replacement:
 * Tesseract stays the default, vision is used when the teacher asks for it.
 *
 * The provider and model are never hard-coded. The caller passes whichever
 * provider/model the user already picked for generation, and only providers
 * that are enabled AND report a vision-capable model are offered at all.
 */

/** Page image handed to the model. */
export interface VisionPage {
  /** image/png or image/jpeg */
  mimeType: string;
  /** raw base64, no data: prefix */
  data: string;
}

export interface VisionOcrResult {
  pages: string[];
  charCount: number;
  /** provider/model actually used — surfaced so the UI can say what read it */
  provider: string;
  model: string;
  /** True when the provider ran out of quota and we fell back to another */
  fellBack?: boolean;
}

/**
 * How many page images to send in one request. Models accept several images
 * per call, but accuracy drops and the timeout risk grows, so pages are
 * batched: each batch is one request.
 */
const BATCH = 3;

/** Cap on pages per call, matching the tesseract path's spirit. */
function maxVisionPages(): number {
  const n = Number(process.env.OCR_VISION_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 60;
}

/** Models a teacher's provider offers that can read images. */
export async function visionCapableProviders(): Promise<
  Array<{ id: string; label: string; models: string[] }>
> {
  const summaries = await providerSummaries();
  const out: Array<{ id: string; label: string; models: string[] }> = [];
  for (const s of summaries) {
    if (!s.enabled) continue;
    let models: string[] = [];
    try {
      models = (await listModelIds(s.id)).filter(supportsVision);
    } catch {
      // A vendor outage must not break the page — this provider just isn't
      // offered as a vision option.
      continue;
    }
    if (models.length > 0) out.push({ id: s.id, label: s.label, models });
  }
  return out;
}

/**
 * Pick the model to run vision OCR with, as an ordered candidate list.
 *
 * Prefers the model the teacher chose when it can read images, then other
 * vision models of the same provider. Several candidates are returned because
 * providers routinely answer 503 ("high demand") or simply hang on one model
 * while another works fine — `visionOcr` walks the list on those failures.
 */
export async function resolveVisionModels(
  providerId: string,
  preferredModel?: string
): Promise<{ models: string[]; cfg: ProviderConfig }> {
  const cfg = await getProviderConfig(providerId);
  if (!cfg) {
    const known = await providerSummaries();
    if (!known.some((p) => p.id === providerId)) {
      throw new AIError(`Unknown AI provider "${providerId}".`, 400);
    }
    const label = known.find((p) => p.id === providerId)?.label || providerId;
    throw new AIError(
      `The ${label} provider isn't configured — add its API key on the Generate page first.`,
      400
    );
  }

  let available: string[] = [];
  try {
    available = (await listModelIds(providerId)).filter(supportsVision);
  } catch (err: any) {
    throw new AIError(
      `Could not list ${cfg.label} models to find one that reads images.`,
      502,
      String(err?.message || err).slice(0, 200)
    );
  }
  if (available.length === 0) {
    throw new AIError(
      `${cfg.label} has no image-reading model available on this key. Pick another provider or use the built-in OCR.`,
      400
    );
  }

  // Preferred first, then the rest. Catalog order is newest-first, which is
  // NOT the same as most-likely-to-read-images: preview/experimental entries
  // (antigravity, deep-research) accept generateContent but reject image
  // input, so well-known general vision families are tried ahead of them.
  const rest = available.filter((m) => m !== preferredModel);
  rest.sort((a, b) => visionRank(b) - visionRank(a));
  const ordered = preferredModel && supportsVision(preferredModel)
    ? [preferredModel, ...rest]
    : rest;
  return { models: ordered, cfg };
}

/**
 * Rough "will this actually read an image" score, higher is better. Only used
 * to order candidates; a wrong guess costs one failed attempt that falls
 * through to the next model.
 */
function visionRank(modelId: string): number {
  const id = modelId.toLowerCase();
  if (id.includes("deep-research") || id.includes("preview")) return 0;
  // Prefer the newest numeric version of each family. Version-aware scoring
  // matters because vendors keep retired ids in the catalog: 2.5-flash-lite
  // answers 404 "no longer available" while 3.5-flash-lite works.
  const ver = Number((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const versionBoost = Math.min(ver, 9);
  const family = (base: number) => base + versionBoost;
  if (/gemini-[\d.]+-flash-lite/.test(id)) return family(5);
  if (/gemini-[\d.]+-flash/.test(id)) return family(4);
  if (/gemini-[\d.]+-pro/.test(id)) return family(3);
  if (id.includes("flash") || id.includes("vision")) return family(3);
  if (id.includes("claude") || id.includes("gpt-") || id.includes("grok")) return 3;
  if (id.includes("gemma")) return 1;
  return 2;
}

/** Kept for callers that want a single model (the UI's "which model" hint). */
export async function resolveVisionModel(
  providerId: string,
  preferredModel?: string
): Promise<{ model: string; cfg: ProviderConfig }> {
  const { models, cfg } = await resolveVisionModels(providerId, preferredModel);
  return { model: models[0], cfg };
}

/** The instruction that makes a vision model behave like an OCR engine. */
function transcriptionPrompt(pageCount: number): string {
  const lines = [
    "You are an OCR engine. Transcribe every piece of text on these page images.",
    "",
    "Rules:",
    "- Output ONLY the transcribed text. No commentary, no explanation, no markdown fences.",
    "- Preserve the original language and script exactly (Bangla stays in Bangla script).",
    "- Keep the reading order: top to bottom, left to right.",
    "- Keep line breaks that reflect the page layout.",
    "- Keep question numbering and option labels exactly as printed ((ক), (খ), A), B), 1., etc.).",
    "- Keep mathematical and numerical expressions exactly, including Bangla digits.",
    "- If a word is genuinely unreadable, write [?] for it — never guess silently.",
    "- Do not translate, correct spelling, reformat or summarise anything.",
  ];
  if (pageCount > 1) {
    lines.push(
      "",
      `There are ${pageCount} page images, in reading order. Separate the pages with a line containing exactly:`,
      "----- PAGE BREAK -----"
    );
  }
  return lines.join("\n");
}

/**
 * Failures that mean "try another model", not "give up": the provider is over
 * capacity, the model hung, we were rate-limited, or the model accepts text
 * but not images (vendors list a model under generateContent while its image
 * modality is disabled — a sibling model reads the same page fine).
 *
 * Auth failures and exhausted quota are NOT retried on a sibling model — they
 * would fail identically and only waste the teacher's time.
 */
function isTransient(err: any): boolean {
  if (!(err instanceof AIError)) return false;
  const detail = `${err.message} ${err.detail || ""}`.toLowerCase();
  // "Image input modality is not enabled for models/…" and friends: this model
  // cannot read images at all, but another one on the same key can.
  if (
    detail.includes("modality") ||
    detail.includes("does not support image") ||
    detail.includes("image input") ||
    detail.includes("unsupported image") ||
    detail.includes("does not support vision")
  ) {
    return true;
  }
  if (err.status === 503 || err.status === 504 || err.status === 429) return true;
  // A retired/gated model id: the catalog can list models the key cannot
  // actually call, so move on rather than failing the upload.
  if (err.status === 404) return true;
  return (
    detail.includes("high demand") ||
    detail.includes("unavailable") ||
    detail.includes("overloaded") ||
    detail.includes("timed out") ||
    detail.includes("rate-limit") ||
    detail.includes("no longer available")
  );
}

/**
 * OCR page images with a vision model. Pages are sent in small batches; each
 * batch is one provider request.
 *
 * Models are tried in order: a transient failure (provider over capacity, a
 * model that hangs, rate limiting) moves on to the next vision model instead
 * of failing the whole upload — Google answers 503 for one model while a
 * sibling model serves the same image in two seconds.
 */
export async function visionOcr(
  pages: VisionPage[],
  providerId: string,
  preferredModel?: string
): Promise<VisionOcrResult> {
  if (pages.length === 0) {
    throw new AIError("No page images were supplied for AI reading.", 400);
  }
  const cap = maxVisionPages();
  const use = pages.slice(0, cap);
  const { models, cfg } = await resolveVisionModels(providerId, preferredModel);

  const out: string[] = [];
  let model = models[0];
  let modelIdx = 0;
  let lastErr: any = null;

  for (let i = 0; i < use.length; i += BATCH) {
    const batch = use.slice(i, i + BATCH);
    const images: ChatImage[] = batch.map((p) => ({ mimeType: p.mimeType, data: p.data }));

    let text: string | null = null;
    // Try the current model, then each remaining candidate, for this batch.
    while (modelIdx < models.length) {
      const candidate = models[modelIdx];
      try {
        const result = await chatComplete(
          cfg,
          candidate,
          [{ role: "user", content: transcriptionPrompt(batch.length), images }],
          // A vision read runs longer than a chat turn; keep it under the
          // platform's function cap.
          { timeoutMs: 180_000 }
        );
        const cleaned = stripFences(result.text);
        if (cleaned.trim()) {
          text = cleaned;
          model = candidate;
          lastErr = null;
          break;
        }
        // Empty output is treated as transient — try the next model.
        lastErr = new AIError(`${cfg.label} returned no text.`, 502);
        modelIdx += 1;
      } catch (err: any) {
        lastErr = err;
        if (!isTransient(err)) throw err;
        console.warn(
          `[vision] model ${candidate} failed transiently (${err?.status || "?"}): ${String(err?.message || err).slice(0, 120)} — trying next model`
        );
        modelIdx += 1;
      }
    }

    if (text === null) {
      const detail = String(lastErr?.message || lastErr || "").slice(0, 200);
      throw new AIError(
        `No ${cfg.label} vision model could read pages ${i + 1}-${i + batch.length} right now. ${detail ? `(${detail}) ` : ""}Try again shortly or use the built-in OCR.`,
        lastErr?.status || 502
      );
    }

    // A batch of >1 pages comes back with an explicit separator; split on it so
    // page ranges still work. A single page is one entry.
    if (batch.length > 1) {
      out.push(...splitPages(text, batch.length));
    } else {
      out.push(text);
    }
  }

  // Pad if the model merged pages, so length always matches the input.
  while (out.length < use.length) out.push("");

  const charCount = out.reduce((n, p) => n + p.length, 0);
  return { pages: out, charCount, provider: cfg.id, model };
}

/** Models often wrap output in ``` fences despite being told not to. */
function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n?```$/);
  return (m ? m[1] : t).trim();
}

/**
 * Split a multi-page answer on the requested separator. Falls back to
 * returning the whole text as the first page when the model ignored the
 * separator, so no text is ever lost.
 */
function splitPages(text: string, expected: number): string[] {
  const parts = text
    .split(/^\s*-{3,}\s*PAGE BREAK\s*-{3,}\s*$/gim)
    .map((p) => p.trim());
  if (parts.length === expected) return parts;
  if (parts.length > 1) return parts;
  return [text, ...Array(Math.max(0, expected - 1)).fill("")];
}
