import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { createBatch, uploadPages, auditBatch } from "../../lib/batch";
import { Button, Field, FileInput, NumberInput, Select } from "../ui";

export default function SetupPanel({ onCreated }: { onCreated: (batchId: string) => void }) {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [targetCount, setTargetCount] = useState(50);
  const [maxPerPage, setMaxPerPage] = useState(5);
  const [allowVisionFallback, setAllowVisionFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/subjects").then((r) => setSubjects(r.data.subjects || [])).catch(() => setSubjects([]));
    api.get("/ai/models").then((r) => {
      const enabled = (r.data.providers || []).filter((p: any) => p.enabled && (p.models || []).length > 0);
      setProviders(enabled);
      if (enabled[0]) {
        setProviderId(enabled[0].id);
        setModelId(enabled[0].models[0]?.id || "");
      }
    }).catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    setChapterId("");
    if (!subjectId) { setChapters([]); return; }
    api.get(`/subjects/${subjectId}/chapters`)
      .then((r) => setChapters(r.data.chapters || []))
      .catch(() => setChapters([]));
  }, [subjectId]);

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  );

  useEffect(() => {
    if (!currentProvider) return;
    if (!currentProvider.models.some((m: any) => m.id === modelId)) {
      setModelId(currentProvider.models[0]?.id || "");
    }
  }, [currentProvider, modelId]);

  const canStart = !!subjectId && !!chapterId && files.length > 0 && !!providerId && !!modelId && !busy;

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    setError("");
    try {
      const { id } = await createBatch({
        subject_id: subjectId,
        chapter_id: chapterId,
        target_count: targetCount,
        max_per_page: maxPerPage,
        provider: providerId,
        model: modelId,
        allow_vision_fallback: allowVisionFallback,
      });
      await uploadPages(id, files);
      await auditBatch(id);
      onCreated(id);
    } catch (e: any) {
      setError(errorMessage(e, "Could not start the batch."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">1 · Set the run</h2>
        <p className="text-sm text-slate-400">One chapter, one set of page images, one target.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Subject">
          <Select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">Pick a subject…</option>
            {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>

        <Field label="Chapter">
          <Select
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
            disabled={!subjectId}
          >
            <option value="">Pick a chapter…</option>
            {chapters.map((c: any) => <option key={c.id} value={c.id}>Ch {c.number} — {c.title}</option>)}
          </Select>
        </Field>

        <div className="md:col-span-2">
          <Field label="Page images (named BGS conv 55.png, …)">
            <FileInput
              multiple
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
            <span className="mt-1 block pl-4 text-xs text-slate-500">{files.length} image{files.length === 1 ? "" : "s"} selected</span>
          </Field>
        </div>

        <Field label="Questions target">
          <NumberInput
            min={1} max={500}
            value={targetCount}
            onChange={(e) => setTargetCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>

        <Field label="Max per page">
          <NumberInput
            min={1} max={20}
            value={maxPerPage}
            onChange={(e) => setMaxPerPage(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>

        <Field label="Provider">
          <Select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">Pick a provider…</option>
            {providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>

        <Field label="Model">
          <Select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={!currentProvider}
          >
            <option value="">Pick a model…</option>
            {(currentProvider?.models || []).map((m: any) => (
              <option key={m.id} value={m.id}>{m.name || m.id}{m.appOnly ? " (app only)" : ""}</option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={allowVisionFallback}
            onChange={(e) => setAllowVisionFallback(e.target.checked)}
          />
          <span className="text-slate-300">Allow a flagged vision fallback when OCR cannot read a quote</span>
          <span className="text-xs text-slate-500">(default off)</span>
        </label>
      </div>

      {error && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">Nothing is generated until the page audit is confirmed.</p>
        <Button type="button" onClick={start} disabled={!canStart}>
          {busy ? "Starting…" : "Start audit"}
        </Button>
      </div>
    </section>
  );
}
