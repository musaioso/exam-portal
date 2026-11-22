import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { errorMessage } from "../../lib/api";
import { formatBatchTime } from "../../lib/batch-labels";
import {
  importReply,
  JOB_KIND_LABEL,
  jobUnitLabel,
  listRuns,
  type GenerationRun,
  type ImportResult,
  type Job,
} from "../../lib/jobs";
import { useToast } from "../Toast";
import { Button, Field, Select, Textarea } from "../ui";

const PREVIEW_DELAY_MS = 550;

function firstReason(result: ImportResult, run: GenerationRun | undefined): string {
  if (result.failed > 0 && result.errors[0]) return result.errors[0].error;
  if (result.skipped > 0 && result.skips?.[0]) return result.skips[0].reason;
  if (result.imported === 0 && result.failed === 0 && result.skipped === 0) {
    return `No ${run ? jobUnitLabel(run.kind) : "rows"} found in that reply.`;
  }
  return "";
}

export default function PasteReplyDialog({
  job,
  onClose,
  onChanged,
}: {
  job: Job;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [runs, setRuns] = useState<GenerationRun[]>([]);
  const [runId, setRunId] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const selectedRun = useMemo(() => runs.find((run) => run.id === runId), [runs, runId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    listRuns(job.id)
      .then(({ runs: rows }) => {
        const open = rows.filter((run) => !run.undone_at);
        setRuns(open);
        setRunId(open[0]?.id ?? "");
      })
      .catch((e: any) => setError(errorMessage(e, "Could not load this job's runs.")));
  }, [job.id]);

  useEffect(() => {
    if (!runId || !text.trim()) {
      setPreview(null);
      setPreviewError("");
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setPreviewError("");
    const timer = window.setTimeout(async () => {
      try {
        const checked = await importReply(job.id, runId, text, true);
        if (!cancelled) setPreview(checked);
      } catch (e: any) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(errorMessage(e, "Could not check the reply."));
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [job.id, runId, text]);

  const importNow = async () => {
    if (!runId || !text.trim() || importing) return;
    setImporting(true);
    setError("");
    try {
      const imported = await importReply(job.id, runId, text, false);
      setResult(imported);
      setPreview(imported);
      onChanged();
      const refreshed = await listRuns(job.id);
      const open = refreshed.runs.filter((run) => !run.undone_at);
      setRuns(open);
      if (imported.failed > 0 && imported.imported === 0 && imported.skipped === 0) {
        toast.error("Nothing was imported. Check the row errors below.");
      } else if (imported.imported > 0) {
        toast.success(`Imported ${imported.imported} ${jobUnitLabel(selectedRun?.kind ?? "passage", imported.imported)} (${imported.importedRows} rows).`);
      } else if (imported.skipped > 0) {
        toast.info(`Nothing new to import — ${imported.skipped} ${jobUnitLabel(selectedRun?.kind ?? "passage", imported.skipped)} already in the bank.`);
      }
    } catch (e: any) {
      setError(errorMessage(e, "Could not import the reply."));
    } finally {
      setImporting(false);
    }
  };

  const previewReason = preview ? firstReason(preview, selectedRun) : "";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paste reply"
        className="glass relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-600/60 p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-xl p-1.5 text-slate-400 transition hover:bg-ink/10 hover:text-slate-200"
        >
          <X size={16} />
        </button>

        <div className="mb-4 pr-8">
          <h2 className="text-lg font-semibold text-slate-100">Paste reply</h2>
          <p className="mt-1 text-sm text-slate-400">
            Fences, citation markers and stray prose are cleaned before parsing. A passage imports as one group.
          </p>
        </div>

        {runs.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Copy a prompt first. A reply is imported into the work order it answers, so the run carries its stored prompt.
          </p>
        ) : (
          <div className="space-y-4">
            <Field label="Answering work order">
              <Select value={runId} onChange={(event) => setRunId(event.target.value)}>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {JOB_KIND_LABEL[run.kind]} · asked {run.requested} · {formatBatchTime(run.created_at)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="NotebookLM reply">
              <Textarea
                rows={12}
                value={text}
                placeholder={'Paste the reply here — an object, an array, or {"questions":[…]}.'}
                onChange={(event) => {
                  setText(event.target.value);
                  setPreview(null);
                  setPreviewError("");
                  setResult(null);
                  setError("");
                }}
              />
            </Field>

            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-sm">
              {checking && <p className="text-slate-400">Checking the reply…</p>}
              {!checking && previewError && <p className="text-rose-300">{previewError}</p>}
              {!checking && !previewError && preview && (
                <div className="space-y-1">
                  <p className="font-semibold text-slate-100">
                    {preview.imported} {jobUnitLabel(selectedRun?.kind ?? "passage", preview.imported)} → {preview.importedRows} rows
                  </p>
                  {preview.skipped > 0 && (
                    <p className="text-amber-300">
                      {preview.skipped} will be skipped: {preview.skippedInChapter} already in this chapter,{" "}
                      {preview.skippedInSubject} elsewhere in the subject.
                    </p>
                  )}
                  {preview.failed > 0 && (
                    <p className="text-rose-300">
                      {preview.failed} will fail{previewReason ? ` · ${previewReason}` : ""}
                    </p>
                  )}
                  {preview.imported > 0 && preview.skipped === 0 && preview.failed === 0 && (
                    <p className="text-emerald-300">Ready to import.</p>
                  )}
                </div>
              )}
              {!checking && !previewError && !preview && (
                <p className="text-slate-500">The preview appears once there is a reply to check.</p>
              )}
            </div>

            {result && (
              <div className="space-y-2 rounded-2xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-sm">
                <p className="font-semibold text-slate-100">
                  Imported {result.imported} {jobUnitLabel(selectedRun?.kind ?? "passage", result.imported)} ({result.importedRows} rows)
                </p>
                <p className="text-slate-400">
                  Skipped {result.skipped}: {result.skippedInChapter} already in this chapter,{" "}
                  {result.skippedInSubject} elsewhere in the subject. Failed {result.failed}.
                </p>
                {result.errors.slice(0, 8).map((row) => (
                  <p key={`error-${row.index}`} className="text-xs text-rose-300">
                    Row {row.index + 1}: {row.error}
                  </p>
                ))}
                {(result.skips ?? []).slice(0, 8).map((row) => (
                  <p key={`skip-${row.index}`} className="text-xs text-amber-300">
                    Row {row.index + 1} skipped: {row.reason}
                  </p>
                ))}
                {result.errors.length > 8 && (
                  <p className="text-xs text-slate-500">…and {result.errors.length - 8} more failed rows.</p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={importing}>
                {result ? "Done" : "Cancel"}
              </Button>
              <Button
                type="button"
                onClick={importNow}
                disabled={
                  importing || checking || !text.trim() || !runId || !preview ||
                  preview.imported + preview.skipped + preview.failed === 0 ||
                  result !== null
                }
              >
                {importing ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
