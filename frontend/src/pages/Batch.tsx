import { useState } from "react";
import SetupPanel from "../components/batch/SetupPanel";
import AuditSheet from "../components/batch/AuditSheet";
import RunPanel from "../components/batch/RunPanel";
import CorrectionPanel from "../components/batch/CorrectionPanel";

function GenerateTab() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);

  return (
    <div className="space-y-4">
      <SetupPanel onCreated={(id) => { setBatchId(id); refresh(); }} />
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
