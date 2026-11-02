import { useEffect, useRef, useState } from "react";
import {
  getBatch,
  stepBatch,
  pauseBatch,
  resumeBatch,
  retryFailed,
  type Batch,
  type StepResult,
} from "../../lib/batch";
import EvidenceTable from "./EvidenceTable";

export default function RunPanel({ batchId }: { batchId: string | null }) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [last, setLast] = useState<StepResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  const load = async () => {
    if (!batchId) { setBatch(null); return; }
    try {
      const data = await getBatch(batchId);
      setBatch(data.batch);
    } catch {
      setBatch(null);
    }
  };

  useEffect(() => {
    cancelled.current = false;
    void load();
    return () => { cancelled.current = true; };
  }, [batchId]);

  const run = async () => {
    if (!batchId || busy) return;
    setBusy(true);
    setError("");
    cancelled.current = false;
    try {
      for (let guard = 0; guard < 500 && !cancelled.current; guard++) {
        const result = await stepBatch(batchId);
        setLast(result);
        await load();
        if (result.status !== "running") break;
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "The batch could not continue.");
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    if (!batchId) return;
    cancelled.current = true;
    await pauseBatch(batchId);
    await load();
    setBusy(false);
  };

  const resume = async () => {
    if (!batchId) return;
    await resumeBatch(batchId);
    await load();
    await run();
  };

  const retry = async () => {
    if (!batchId) return;
    await retryFailed(batchId);
    await load();
    await run();
  };

  if (!batchId) return null;

  const status = batch?.status || "draft";
  const saved = batch?.saved ?? 0;
  const target = batch?.target_count ?? 0;
  const percent = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  const running = busy || status === "running";

  return (
    <div className="space-y-4">
      <section className="glass p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">3 · Run</h2>
            <p className="text-sm text-slate-400">One page at a time. Failed pages never stop the rest of the batch.</p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${
            status === "done"
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
              : status === "paused"
                ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                : "border-indigo-500/40 bg-indigo-500/15 text-indigo-200"
          }`}>
            {status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["generated", batch?.generated ?? 0],
            ["quote ok", batch?.quote_ok ?? 0],
            ["answer ok", batch?.answer_ok ?? 0],
            ["rejected", batch?.rejected ?? 0],
            ["saved", saved],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2">
              <div className="text-lg font-bold text-slate-100">{value}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>{saved} of {target} saved</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {last?.page && (
          <p className="text-xs text-slate-400">
            Last page: <span className="font-semibold text-slate-200">{last.page.source_file}</span>
            {" · "}page {last.page.resolved_page_number ?? "—"}
            {last.reason ? ` · ${last.reason}` : ""}
          </p>
        )}

        {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {status === "draft" && (
            <button type="button" onClick={run} disabled={busy}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">
              {busy ? "Running…" : "Start batch"}
            </button>
          )}
          {status === "running" && (
            <button type="button" onClick={pause} disabled={!busy}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 disabled:opacity-50">
              Pause
            </button>
          )}
          {status === "paused" && (
            <button type="button" onClick={resume} disabled={busy}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Resume
            </button>
          )}
          <button type="button" onClick={retry} disabled={busy}
            className="rounded-xl border border-slate-700/60 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800/60 disabled:opacity-50">
            Retry failed pages
          </button>
        </div>

        {running && <p className="text-xs text-slate-500">Keep this tab open while the batch runs. Each page is saved as it passes.</p>}
      </section>

      <EvidenceTable batchId={batchId} />
    </div>
  );
}
