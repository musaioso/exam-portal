import { useEffect, useState } from "react";
import { getBatch, auditBatch, confirmPage, type BatchPage } from "../../lib/batch";

function badge(status: string) {
  if (status === "match" || status === "confirmed") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (status === "mismatch") return "border-rose-500/40 bg-rose-500/15 text-rose-200";
  return "border-amber-500/40 bg-amber-500/15 text-amber-200";
}

function PageRow({ page, onConfirm }: { page: BatchPage; onConfirm: (file: string, pageNumber: number) => void }) {
  const [value, setValue] = useState(String(page.resolved_page_number ?? page.page_number ?? page.proposed_number ?? ""));
  const resolved = page.resolved_page_number;

  return (
    <tr className="border-t border-slate-700/50">
      <td className="px-3 py-2 text-xs text-slate-300">{page.source_file}</td>
      <td className="px-3 py-2 text-xs text-slate-300">{page.page_number ?? "—"}</td>
      <td className="px-3 py-2 text-xs text-slate-300">{page.printed_number ?? "—"}</td>
      <td className="px-3 py-2 text-xs font-semibold text-slate-100">{resolved ?? "—"}</td>
      <td className="px-3 py-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge(page.audit_status)}`}>
          {page.audit_status}
        </span>
      </td>
      <td className="px-3 py-2">
        {resolved ? (
          <span className="text-xs text-emerald-300">Ready</span>
        ) : page.audit_status === "mismatch" && page.printed_number ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              onClick={() => onConfirm(page.source_file, page.page_number ?? page.printed_number!)}
            >
              Use filename {page.page_number ?? "—"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              onClick={() => onConfirm(page.source_file, page.printed_number!)}
            >
              Use printed {page.printed_number}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-20 rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={!value}
              className="rounded-lg bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              onClick={() => onConfirm(page.source_file, Number(value))}
            >
              Confirm
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function AuditSheet({ batchId, onChanged }: { batchId: string | null; onChanged: () => void }) {
  const [pages, setPages] = useState<BatchPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!batchId) { setPages([]); return; }
    try {
      const data = await getBatch(batchId);
      setPages(data.pages);
    } catch {
      setPages([]);
    }
  };

  useEffect(() => { void load(); }, [batchId]);

  const runAudit = async () => {
    if (!batchId) return;
    setBusy(true);
    setError("");
    try {
      const data = await auditBatch(batchId);
      setPages(data.pages);
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "The page audit could not run.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (sourceFile: string, pageNumber: number) => {
    if (!batchId) return;
    setBusy(true);
    setError("");
    try {
      await confirmPage(batchId, sourceFile, pageNumber);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.error || "The page could not be confirmed.");
    } finally {
      setBusy(false);
    }
  };

  if (!batchId) return null;

  const ready = pages.length > 0 && pages.every((p) => p.resolved_page_number != null);

  return (
    <section className="glass p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">2 · Page audit</h2>
          <p className="text-sm text-slate-400">The filename is the anchor. Confirm the opener once; fixes are stamped on every question.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${ready ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" : "border-amber-500/40 bg-amber-500/15 text-amber-200"}`}>
            {ready ? "Ready to generate" : "Needs confirmation"}
          </span>
          <button
            type="button"
            onClick={runAudit}
            disabled={busy}
            className="rounded-xl border border-slate-700/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800/60 disabled:opacity-50"
          >
            {busy ? "Working…" : "Run page audit"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-700/50">
        <table className="min-w-full text-left">
          <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Source file</th>
              <th className="px-3 py-2">Filename</th>
              <th className="px-3 py-2">Printed</th>
              <th className="px-3 py-2">Resolved</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => <PageRow key={page.id} page={page} onConfirm={confirm} />)}
            {pages.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">No pages uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
