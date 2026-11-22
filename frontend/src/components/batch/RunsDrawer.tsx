import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { errorMessage } from "../../lib/api";
import { formatBatchTime } from "../../lib/batch-labels";
import {
  JOB_KIND_LABEL,
  listRuns,
  undoRun,
  type GenerationRun,
  type Job,
} from "../../lib/jobs";
import { confirmDialog } from "../Dialog";
import { useToast } from "../Toast";
import { Badge, Button } from "../ui";

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-2.5 py-1.5">
      <div className="text-sm font-bold text-slate-100">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

export default function RunsDrawer({
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [undoing, setUndoing] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    try {
      const { runs: rows } = await listRuns(job.id);
      setRuns(rows);
      setError("");
    } catch (e: any) {
      setError(errorMessage(e, "Could not load the runs."));
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyPrompt = async (run: GenerationRun) => {
    if (!run.prompt_text) {
      toast.error("This run has no stored prompt.");
      return;
    }
    try {
      await navigator.clipboard.writeText(run.prompt_text);
      toast.success("The stored prompt was copied again.");
    } catch {
      toast.error("The browser blocked clipboard access.");
    }
  };

  const undo = async (run: GenerationRun) => {
    if (run.undone_at || undoing) return;
    const rows = run.imported_rows;
    const ok = await confirmDialog({
      title: "Undo this run?",
      message: `This deletes exactly the ${rows} row${rows === 1 ? "" : "s"} this run imported and removes them from any exam. The run stays in the list as undone.`,
      confirmLabel: "Undo run",
      tone: "danger",
    });
    if (!ok) return;
    setUndoing(run.id);
    setError("");
    try {
      const result = await undoRun(job.id, run.id);
      toast.success(`Run undone — ${result.deleted} row${result.deleted === 1 ? "" : "s"} removed.`);
      await load();
      onChanged();
    } catch (e: any) {
      setError(errorMessage(e, "Could not undo the run."));
    } finally {
      setUndoing("");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onMouseDown={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Runs"
        className="glass relative h-full w-full max-w-md overflow-y-auto border-l border-slate-600/60 p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Runs</h2>
            <p className="mt-1 text-xs text-slate-400">
              Every copied work order is kept with its exact prompt. Counts are units; rows are separate.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-ink/10 hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
        )}

        {loading && <p className="text-sm text-slate-400">Loading runs…</p>}

        {!loading && runs.length === 0 && !error && (
          <p className="rounded-2xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
            No runs yet. Copy a prompt to start one.
          </p>
        )}

        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="space-y-2 rounded-2xl border border-slate-700/50 bg-slate-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold text-slate-100">{JOB_KIND_LABEL[run.kind]}</span>
                  <span className="ml-2 text-xs text-slate-500">{formatBatchTime(run.created_at)}</span>
                </div>
                {run.undone_at ? (
                  <Badge className="border-rose-500/40 bg-rose-500/15 text-rose-200">
                    undone · {formatBatchTime(run.undone_at)}
                  </Badge>
                ) : (
                  <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">active</Badge>
                )}
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                <Count label="asked" value={run.requested} />
                <Count label="imported" value={run.imported} />
                <Count label="rows" value={run.imported_rows} />
                <Count label="skipped" value={run.skipped} />
                <Count label="failed" value={run.failed} />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { void copyPrompt(run); }}
                  disabled={!run.prompt_text}
                >
                  Copy this prompt again
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => { void undo(run); }}
                  disabled={!!run.undone_at || !!undoing}
                  className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-400/60"
                >
                  {undoing === run.id ? "Undoing…" : "Undo this run"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
