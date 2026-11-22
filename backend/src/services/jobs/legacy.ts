/**
 * CQ rows made before passage columns existed are four `long` rows whose prompt
 * begins `উদ্দীপক: <stem> (<part>) <question>`. That shape is read, never
 * rewritten: the stem is what duplicate checks, the avoid list and progress
 * need, and it can be recovered from the prompt alone.
 */
const LEGACY = /^উদ্দীপক\s*:\s*([\s\S]*?)\s*[\(（]\s*(?:ক|খ|গ|ঘ|[1-4])\s*[\)）]\s*/;

export function deriveLegacyStem(prompt: string): string | null {
  const m = LEGACY.exec(String(prompt || "").trim());
  return m ? m[1].trim() || null : null;
}
