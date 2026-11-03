import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getBatchItems, undoBatch, type BatchItem } from "../../lib/batch";
import { confirmDialog } from "../Dialog";
import { Button } from "../ui";

function parseQuestion(item: BatchItem): any {
  try {
    return JSON.parse(item.question_json || "{}");
  } catch {
    return {};
  }
}

function parseVerdict(item: BatchItem): any {
  try {
    return JSON.parse(item.verifier_json || "{}");
  } catch {
    return {};
  }
}

export default function EvidenceTable({ batchId }: { batchId: string }) {
  const nav = useNavigate();
  const [items, setItems] = useState<BatchItem[]>([]);
  const [filter, setFilter] = useState<"all" | "accepted" | "rejected">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const data = await getBatchItems(batchId);
      setItems(data.items);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => { void load(); }, [batchId]);

  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );

  const accepted = items.filter((i) => i.status === "accepted").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const undo = async () => {
    const ok = await confirmDialog({
      title: "Undo this batch?",
      message: "Every question created by this batch is deleted. Existing questions are not touched.",
      confirmLabel: "Undo batch",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await undoBatch(batchId);
      nav("/questions");
    } catch (e: any) {
      setError(e?.response?.data?.error || "The batch could not be undone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Evidence</h2>
          <p className="text-sm text-slate-400">Every saved question keeps its page, file, and exact quote.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-200">
            {accepted} accepted
          </span>
          <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-xs font-semibold text-rose-200">
            {rejected} rejected
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={undo}
            disabled={busy}
            className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-400/60"
          >
            Undo batch
          </Button>
        </div>
      </div>

      {error && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

      <div className="flex gap-2">
        {(["all", "accepted", "rejected"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition ${
              filter === value ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/20" : "border border-slate-700/60 text-slate-300 hover:bg-ink/5"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-700/50">
        <table className="min-w-full text-left">
          <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Question</th>
              <th className="px-3 py-2">Answer</th>
              <th className="px-3 py-2">Page</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Quote</th>
              <th className="px-3 py-2">Gate</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const q = parseQuestion(item);
              const verdict = parseVerdict(item);
              const acceptedRow = item.status === "accepted";
              return (
                <tr key={item.id} className="border-t border-slate-700/50 align-top">
                  <td className="max-w-[260px] px-3 py-2 text-xs font-semibold text-slate-100">{q.prompt || "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">{q.answer || "—"}</td>
                  <td className="px-3 py-2 text-xs font-semibold text-slate-100">{item.page_number ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{item.source_file || "—"}</td>
                  <td className="max-w-[320px] px-3 py-2 text-xs italic text-slate-300">{item.source_quote || "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">
                    {acceptedRow ? (
                      <span className="text-emerald-300">{item.verification_method || "ocr"} ✓</span>
                    ) : (
                      <span className="text-rose-300">{verdict.reason || item.reason || "rejected"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      acceptedRow
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                        : "border-rose-500/40 bg-rose-500/15 text-rose-200"
                    }`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500">No items yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
