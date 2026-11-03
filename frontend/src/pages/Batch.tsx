import { useEffect, useState } from "react";
import SetupPanel from "../components/batch/SetupPanel";
import AuditSheet from "../components/batch/AuditSheet";
import RunPanel from "../components/batch/RunPanel";
import CorrectionPanel from "../components/batch/CorrectionPanel";
import { listBatches, type Batch as BatchRun } from "../lib/batch";

function GenerateTab() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [recent, setRecent] = useState<BatchRun[]>([]);
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    listBatches().then((r) => setRecent(r.batches.slice(0, 8))).catch(() => setRecent([]));
  }, [revision]);

  return (
    <div className="space-y-4">
      <SetupPanel onCreated={(id) => { setBatchId(id); refresh(); }} />

      {recent.length > 0 && (
        <section className="glass p-5 space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Recent batches</h2>
            <p className="text-sm text-slate-400">Reopen a batch to resume, inspect evidence, or undo it.</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {recent.map((batch) => (
              <button
                key={batch.id}
                type="button"
                onClick={() => { setBatchId(batch.id); refresh(); }}
                className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-900/40 px-3 py-2 text-left text-sm hover:bg-slate-800/60"
              >
                <span>
                  <span className="font-semibold text-slate-100">{batch.id.slice(0, 8)}</span>
                  <span className="ml-2 text-xs text-slate-400">{batch.status} · {batch.saved} saved</span>
                </span>
                <span className="text-xs font-semibold text-indigo-300">Open</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <AuditSheet batchId={batchId} onChanged={refresh} />
      <RunPanel key={`${batchId || "none"}-${revision}`} batchId={batchId} />
    </div>
  );
}

export default function Batch() {
  const [tab, setTab] = useState<"generate" | "correct">("generate");
  const tabClass = (active: boolean) =>
    `rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
        : "border border-slate-700/60 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
    }`;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-300">Batch Studio</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Generate a large pool, with proof</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Every saved question must carry a verbatim source quote on the exact page image.
          Existing questions are never touched by generation.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabClass(tab === "generate")} onClick={() => setTab("generate")}>
          Generate
        </button>
        <button type="button" className={tabClass(tab === "correct")} onClick={() => setTab("correct")}>
          Correct existing
        </button>
      </div>

      {tab === "generate" ? <GenerateTab /> : <CorrectionPanel />}
    </div>
  );
}
