import type { Batch, CorrectionRun } from "./batch";

/** Compact, local-time label used anywhere a batch or correction run is listed. */
export function formatBatchTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A UUID slice is not a useful identity. Lead with a small ordinal, then the
 * facts that actually distinguish two batches: when it ran, what it saved,
 * and the short id as a fallback.
 */
export function batchSummary(batch: Batch, index: number, chapterLabel = ""): string {
  const chapter = chapterLabel ? `${chapterLabel} · ` : "";
  return `${chapter}Batch ${index + 1} · ${batch.saved}/${batch.target_count} saved · ${batch.status} · ${formatBatchTime(batch.created_at)} · #${batch.id.slice(0, 8)}`;
}

export function correctionRunSummary(run: CorrectionRun, index: number): string {
  return `Run ${index + 1} · ${run.status} · ${run.checked} checked · ${formatBatchTime(run.created_at)} · #${run.id.slice(0, 8)}`;
}
