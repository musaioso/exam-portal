import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import {
  listBatches,
  createCorrection,
  stepCorrection,
  getCorrection,
  applyCorrections,
  rejectCorrections,
  undoCorrections,
  type Batch,
  type CorrectionItem,
  type CorrectionRun,
} from "../../lib/batch";
import { confirmDialog } from "../Dialog";

function parseJson(value: string | null | undefined): any {
  if (!value) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

function verdictClass(verdict: string) {
  if (verdict === "ok") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (verdict === "wrong_page" || verdict === "wrong_answer" || verdict === "needs manual edit") {
    return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  }
  return "border-rose-500/40 bg-rose-500/15 text-rose-200";
}

export default function CorrectionPanel() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [sourceBatchId, setSourceBatchId] = useState("");
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [run, setRun] = useState<CorrectionRun | null>(null);
  const [items, setItems] = useState<CorrectionItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/subjects").then((r) => setSubjects(r.data.subjects || [])).catch(() => setSubjects([]));
    listBatches().then((r) => setBatches(r.batches)).catch(() => setBatches([]));
  }, []);

  useEffect(() => {
    setChapterId("");
    setSourceBatchId("");
    setQuestionCount(null);
    if (!subjectId) { setChapters([]); return; }
    api.get(`/subjects/${subjectId}/chapters`)
      .then((r) => setChapters(r.data.chapters || []))
      .catch(() => setChapters([]));
  }, [subjectId]);

  useEffect(() => {
    setSourceBatchId("");
    setQuestionCount(null);
    if (!subjectId) return;
    const params: any = { subject_id: subjectId, pageSize: 1 };
    if (chapterId) params.chapter_id = chapterId;
    api.get("/questions", { params })
      .then((r) => setQuestionCount(Number(r.data.total ?? 0)))
      .catch(() => setQuestionCount(null));
  }, [subjectId, chapterId]);

  const sourceBatches = useMemo(
    () => batches.filter((b) => b.subject_id === subjectId && (!chapterId || b.chapter_id === chapterId)),
    [batches, subjectId, chapterId]
  );

  const loadCorrection = async (runId: string) => {
    const data = await getCorrection(runId);
    setRun(data.run);
    setItems(data.items);
    return data;
  };

  const startAudit = async () => {
    if (!subjectId || !sourceBatchId || busy) return;
    setBusy(true);
    setError("");
    setSelected(new Set());
    try {
      const created = await createCorrection({
        subject_id: subjectId,
        chapter_id: chapterId || undefined,
        source_batch_id: sourceBatchId,
      });
      await loadCorrection(created.id);
      for (let guard = 0; guard < 300; guard++) {
        await stepCorrection(created.id);
        const data = await loadCorrection(created.id);
        if (data.run.status !== "auditing") break;
      }
    } catch (e: any) {
      setError(errorMessage(e, "The correction audit could not start."));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const applySelected = async () => {
    if (!run || selected.size === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      await applyCorrections(run.id, [...selected]);
      setSelected(new Set());
      await loadCorrection(run.id);
    } catch (e: any) {
      setError(errorMessage(e, "The selected corrections could not be applied."));
    } finally {
      setBusy(false);
    }
  };

  const rejectSelected = async () => {
    if (!run || selected.size === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      await rejectCorrections(run.id, [...selected]);
      setSelected(new Set());
      await loadCorrection(run.id);
    } catch (e: any) {
      setError(errorMessage(e, "The selected corrections could not be rejected."));
    } finally {
      setBusy(false);
    }
  };

  const undoRun = async () => {
    if (!run || busy) return;
    const ok = await confirmDialog({
      title: "Undo this correction run?",
      message: "Every applied change from this run is restored to its before value. Question ids are unchanged.",
      confirmLabel: "Undo corrections",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await undoCorrections(run.id);
      await loadCorrection(run.id);
    } catch (e: any) {
      setError(errorMessage(e, "The corrections could not be undone."));
    } finally {
      setBusy(false);
    }
  };

  const selectedProposed = items.filter((i) => selected.has(i.id) && i.status === "proposed").length;

  return (
    <section className="glass p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Correct existing</h2>
        <p className="text-sm text-slate-400">
          Audit the existing bank against the same page images. Changes are proposals until you apply them;
          questions are updated in place and keep their ids.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-slate-300">Subject</span>
          <select className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2"
            value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Pick a subject…</option>
            {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-300">Chapter</span>
          <select className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2"
            value={chapterId} onChange={(e) => setChapterId(e.target.value)} disabled={!subjectId}>
            <option value="">Whole subject</option>
            {chapters.map((c: any) => <option key={c.id} value={c.id}>Ch {c.number} — {c.title}</option>)}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-slate-300">Page-image batch</span>
          <select className="w-full rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2"
            value={sourceBatchId} onChange={(e) => setSourceBatchId(e.target.value)} disabled={!subjectId}>
            <option value="">Pick the source batch…</option>
            {sourceBatches.map((b) => (
              <option key={b.id} value={b.id}>{b.id.slice(0, 8)} · {b.status} · {b.saved} saved</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
        {questionCount != null && <span>{questionCount} existing question{questionCount === 1 ? "" : "s"} in scope</span>}
        {sourceBatches.length === 0 && <span className="text-amber-300">Run a Generate batch for this chapter first to store its page images.</span>}
      </div>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={startAudit} disabled={!subjectId || !sourceBatchId || busy}
          className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50">
          {busy && !run ? "Auditing…" : "Start audit"}
        </button>
        <button type="button" onClick={applySelected} disabled={selectedProposed === 0 || busy}
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-50">
          Apply selected ({selectedProposed})
        </button>
        <button type="button" onClick={rejectSelected} disabled={selectedProposed === 0 || busy}
          className="rounded-xl border border-slate-700/60 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-50">
          Reject selected
        </button>
        <button type="button" onClick={undoRun} disabled={!run || busy}
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 disabled:opacity-50">
          Undo run
        </button>
      </div>

      {run && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-400">
          <span className="rounded-full border border-slate-700/60 px-2 py-1">{run.status}</span>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-200">{run.ok} ok</span>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">{run.wrong_page} wrong page</span>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">{run.wrong_answer} wrong answer</span>
          <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200">{run.not_found} not found</span>
          <span className="rounded-full border border-slate-700/60 px-2 py-1">{run.applied} applied</span>
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-700/50">
          <table className="min-w-full text-left">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">Current</th>
                <th className="px-3 py-2">Verdict</th>
                <th className="px-3 py-2">Proposed</th>
                <th className="px-3 py-2">Evidence</th>
                <th className="px-3 py-2">Usage</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const q = parseJson(item.current_json);
                const proposed = parseJson(item.proposed_json);
                const evidence = parseJson(item.evidence_json);
                const usage = item.usage || { exams: 0, attempts: 0 };
                return (
                  <tr key={item.id} className="border-t border-slate-700/50 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        disabled={item.status !== "proposed"}
                        onChange={() => toggle(item.id)}
                      />
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-xs font-semibold text-slate-100">
                      {q.prompt || "—"}
                      <div className="text-[10px] font-normal text-slate-500">id {String(item.question_id).slice(0, 8)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      page {q.page_number ?? "—"}<br />answer {q.answer ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${verdictClass(item.verdict)}`}>
                        {item.verdict}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {proposed.page_number != null && <div>page {proposed.page_number}</div>}
                      {proposed.answer != null && <div>answer {proposed.answer}</div>}
                      {proposed.page_number == null && proposed.answer == null && "—"}
                    </td>
                    <td className="max-w-[300px] px-3 py-2 text-xs italic text-slate-400">
                      {evidence.quote || evidence.reason || "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-400">
                      {usage.exams > 0 || usage.attempts > 0
                        ? <span className="text-amber-300">{usage.exams} exam{usage.exams === 1 ? "" : "s"} · {usage.attempts} attempt{usage.attempts === 1 ? "" : "s"}</span>
                        : "unused"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
