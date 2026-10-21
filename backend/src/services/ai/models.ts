import { ModelInfo, ProviderModels } from "./types";
import { modelFetchers, providerSummaries } from "./providers";

/**
 * Live model catalog with a per-instance TTL cache.
 *
 * GET /api/ai/models calls this; each enabled provider's native models
 * endpoint is hit once per hour, so new releases show up on their own and a
 * vendor outage degrades to a flagged provider instead of a broken page.
 */

const TTL_MS = 60 * 60 * 1000;

interface Entry {
  at: number;
  models: ModelInfo[];
  error?: string;
}
const cache = new Map<string, Entry>();

export async function listModels(opts: { refresh?: boolean } = {}): Promise<ProviderModels[]> {
  const now = Date.now();
  const summaries = await providerSummaries();

  await Promise.all(
    (await modelFetchers()).map(async ({ id, fetch: fetchModels }) => {
      const hit = cache.get(id);
      if (!opts.refresh && hit && now - hit.at < TTL_MS) return;
      try {
        const models = await fetchModels();
        // Server-callable models first (app-only ones — OpenCode's free tier —
        // cannot be used by this backend, so they sink to the bottom and are
        // never the default), then newest, then A→Z — deterministic across vendors.
        models.sort(
          (a, b) =>
            Number(!!a.appOnly) - Number(!!b.appOnly) ||
            (b.created || 0) - (a.created || 0) ||
            (a.name || a.id).localeCompare(b.name || b.id)
        );
        cache.set(id, { at: now, models });
      } catch (err: any) {
        // Keep stale data if we had some; otherwise surface the error on the provider entry.
        if (!hit) cache.set(id, { at: now, models: [], error: String(err?.message || err) });
        else hit.at = now - TTL_MS + 60_000; // retry in a minute, not instantly
      }
    })
  );

  return summaries.map((s) => {
    const entry = cache.get(s.id);
    return {
      ...s,
      models: s.enabled ? entry?.models || [] : [],
      ...(s.enabled && entry?.error ? { error: entry.error } : {}),
    };
  });
}

/**
 * Drop cached model lists — called after a key is saved or removed through
 * the UI so a newly enabled provider appears (and a stripped one disappears)
 * without waiting out the one-hour TTL.
 */
export function invalidateModels(id?: string) {
  if (id) cache.delete(id);
  else cache.clear();
}

/** One enabled provider's cached model ids, reusing the TTL cache above. */
export async function listModelIds(providerId: string): Promise<string[]> {
  await listModels();
  return (cache.get(providerId)?.models || []).map((m) => m.id);
}

/**
 * Model ids that clearly cannot read an image. Vendors do not publish a
 * "vision" flag, so this is a deny-list of the families that are text-only
 * (embeddings, TTS, image *generation*, audio, moderation, rerankers,
 * transcription). Anything not matched is assumed capable — the classification
 * only decides what the UI offers, and a wrong guess fails loudly at request
 * time with a readable provider error.
 */
const NON_VISION = [
  "embedding",
  "embed-",
  "text-embedding",
  "tts",
  "text-to-speech",
  "speech",
  "transcribe",
  "whisper",
  "audio",
  "moderation",
  "rerank",
  "dall-e",
  "dalle",
  "gpt-image",
  "image-generation",
  "stable-diffusion",
  "flux",
  "sdxl",
  "lerobot",
  "robotics",
  "computer-use",
  "guard",
  "safeguard",
  "classifier",
  "deprecated",
  // Gemini's image-GENERATION and TTS models live in the same namespace.
  "-tts",
  "-image-preview",
  "-image",
  "-imagen",
  "-veo",
  "nanobanana",
  "nano-banana",
  "lyria",
  "imagen",
];

/** Heuristic: could this model read a page image? */
export function supportsVision(modelId: string): boolean {
  const id = String(modelId || "").toLowerCase();
  if (!id) return false;
  return !NON_VISION.some((needle) => id.includes(needle));
}
