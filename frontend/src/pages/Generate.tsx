import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useToast } from "../components/Toast";
import { Card, Button, Input, NumberInput, Field, Textarea, Select, Badge, Skeleton, cn } from "../components/ui";
import { alertDialog, confirmDialog } from "../components/Dialog";
import {
  Sparkles, Upload, FileText, RefreshCw, Trash2, Wand2, ArrowRight, ArrowLeft,
  Save, Lock, Pencil, Loader2, AlertTriangle, X,
} from "lucide-react";

/**
 * AI question generator: source → settings → generate → review → save.
 *
 * Nothing generated here enters the question bank automatically. Duplicates
 * are excluded three times: the response flags prompts already in the subject,
 * edited prompts are re-checked live, and the final save runs through
 * bulk-import's skip_duplicates pass — so a duplicate can never be saved.
 */

type ModelInfo = { id: string; name?: string; free?: boolean; appOnly?: boolean; context?: number };
type Provider = { id: string; label: string; enabled: boolean; error?: string; models: ModelInfo[] };
type SourceDoc = { id: string; name: string; pages: number | null; char_count: number; created_at: number };
type GenQuestion = {
  type: "mcq" | "short" | "long";
  difficulty: "easy" | "medium" | "hard";
  prompt: string;
  options: string[] | null;
  answer: string;
  explanation: string | null;
  marks: number;
  isDuplicate?: boolean;
};
type ReviewItem = GenQuestion & { include: boolean; needsRecheck?: boolean };
type Dropped = { index: number; reason: string };

const STEPS = ["Source", "Settings", "Generate", "Review"];
const DIFFICULTIES = [
  { value: "mixed", label: "Mixed (recommended)" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];
const TYPE_OPTIONS = [
  { value: "mcq", label: "MCQ" },
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
];

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Generate() {
  const toast = useToast();
  const nav = useNavigate();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  // Step 0 — source
  const [mode, setMode] = useState<"document" | "text">("document");
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [pageFrom, setPageFrom] = useState("");
  const [pageTo, setPageTo] = useState("");
  const [text, setText] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 1 — settings
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [count, setCount] = useState("10");
  const [difficulty, setDifficulty] = useState("mixed");
  const [types, setTypes] = useState<string[]>(["mcq"]);
  const [language, setLanguage] = useState<"auto" | "english" | "bangla">("auto");

  // Step 3 — review
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [dropped, setDropped] = useState<Dropped[]>([]);
  const [usage, setUsage] = useState<{ inputTokens?: number; outputTokens?: number } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ prompt: string; options: string[]; answer: string; explanation: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled && p.models.length > 0), [providers]);
  const currentProvider = enabledProviders.find((p) => p.id === providerId);
  const currentModel = currentProvider?.models.find((m) => m.id === modelId);
  const selectedDoc = docs.find((d) => d.id === documentId);
  const dupCount = items.filter((i) => i.isDuplicate).length;
  const includeCount = items.filter((i) => i.include && !i.isDuplicate).length;

  /* ------------------------------------------------------------ data loading */

  const loadDocs = async () => {
    try {
      const { data } = await api.get("/documents");
      setDocs(data.documents || []);
    } catch { /* list failure is non-fatal — the step still allows pasted text */ }
  };
  const loadHistory = async () => {
    try {
      const { data } = await api.get("/ai/history");
      setHistory(data.history || []);
    } catch { /* non-fatal */ }
  };
  const loadModels = async (refresh = false) => {
    setModelsLoading(true);
    try {
      const { data } = await api.get(`/ai/models${refresh ? "?refresh=1" : ""}`);
      setProviders(data.providers || []);
    } catch (e) {
      toast.error(errorMessage(e, "Could not load the AI model list."));
    } finally {
      setModelsLoading(false);
    }
  };
  useEffect(() => { loadDocs(); loadModels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresh the history panel whenever the wizard lands back on step 0.
  useEffect(() => { if (step === 0) loadHistory(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get("/subjects").then((r) => setSubjects(r.data.subjects || [])); }, []);
  useEffect(() => {
    setChapterId("");
    if (subjectId) api.get(`/subjects/${subjectId}/chapters`).then((r) => setChapters(r.data.chapters || []));
    else setChapters([]);
  }, [subjectId]);

  // Default the pickers to the first usable provider/model (lists are sorted
  // server-callable-first, newest-first by the backend; app-only free-tier
  // models sink to the bottom because this backend cannot call them).
  useEffect(() => {
    if (enabledProviders.length === 0) return;
    const stillValid = enabledProviders.some((p) => p.id === providerId);
    const p = stillValid ? enabledProviders.find((x) => x.id === providerId)! : enabledProviders[0];
    if (!stillValid) setProviderId(p.id);
    if (!p.models.some((m) => m.id === modelId && !m.appOnly)) {
      const pick = p.models.find((m) => !m.appOnly) || p.models[0];
      setModelId(pick?.id || "");
    }
  }, [providers]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------------ upload */

  const uploadFile = async (file: File) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      await alertDialog({ title: "Unsupported file", message: "Only PDF files can be uploaded as a source." });
      return;
    }
    setUploadPct(0);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/documents", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
          if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100));
        },
      });
      await loadDocs();
      setDocumentId(data.document.id);
      setPageFrom("");
      setPageTo("");
      setMode("document");
      toast.success(`Uploaded “${data.document.name}” — ${data.document.pages} pages extracted.`);
    } catch (e) {
      await alertDialog({ title: "Upload failed", message: errorMessage(e, "The PDF could not be uploaded.") });
    } finally {
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeDoc = async (doc: SourceDoc) => {
    const ok = await confirmDialog({
      title: "Delete source?",
      message: `“${doc.name}” and its extracted text will be removed. Saved questions are not affected.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      if (documentId === doc.id) setDocumentId("");
      await loadDocs();
    } catch (e) {
      toast.error(errorMessage(e, "Could not delete the document."));
    }
  };

  /* ---------------------------------------------------------------- generate */

  const sourcePayload = () => {
    if (mode === "text") return { text };
    return {
      documentId,
      ...(pageFrom ? { pageFrom: Number(pageFrom) } : {}),
      ...(pageTo ? { pageTo: Number(pageTo) } : {}),
    };
  };

  const canContinue = mode === "text" ? text.trim().length >= 30 : !!documentId;

  const runGenerate = async () => {
    if (!subjectId) {
      await alertDialog({ title: "Subject required", message: "Pick the subject these questions belong to." });
      return;
    }
    if (types.length === 0) {
      await alertDialog({ title: "Question type required", message: "Choose at least one question type." });
      return;
    }
    if (!providerId || !modelId) {
      await alertDialog({ title: "Model required", message: "Choose an AI provider and model first." });
      return;
    }
    setStep(2);
    setBusy(true);
    try {
      const payload = {
        provider: providerId,
        model: modelId,
        subject_id: subjectId,
        chapter_id: chapterId || undefined,
        count: Math.max(1, Math.min(50, Number(count) || 10)),
        difficulty,
        types,
        language,
        ...sourcePayload(),
      };
      const { data } = await api.post("/ai/generate", payload);
      const list: ReviewItem[] = (data.questions || []).map((q: GenQuestion) => ({
        ...q,
        // Duplicates of the existing bank start excluded and locked.
        include: !q.isDuplicate,
      }));
      setItems(list);
      setDropped(data.dropped || []);
      setUsage(data.usage || null);
      setTruncated(!!data.truncated);
      setEditing(null);
      setStep(3);
      if (data.duplicates > 0) {
        toast.info(`${data.duplicates} generated question${data.duplicates === 1 ? "" : "s"} already exist${data.duplicates === 1 ? "s" : ""} in this subject and were excluded.`);
      }
    } catch (e) {
      await alertDialog({ title: "Generation failed", message: errorMessage(e, "The AI provider could not generate questions. Try again or pick another model.") });
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------------ review */

  const recheckDuplicates = async (next: ReviewItem[]) => {
    if (!subjectId) return next;
    try {
      const { data } = await api.post("/ai/check-duplicates", {
        subject_id: subjectId,
        prompts: next.map((i) => i.prompt),
      });
      return next.map((item, i) => {
        const dup = !!data.duplicates?.[i];
        return { ...item, isDuplicate: dup, include: dup ? false : item.include, needsRecheck: false };
      });
    } catch {
      return next; // keep previous flags if the check itself fails
    }
  };

  const toggleInclude = (idx: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx && !it.isDuplicate ? { ...it, include: !it.include } : it)));
  };

  const startEdit = (idx: number) => {
    const it = items[idx];
    setDraft({
      prompt: it.prompt,
      options: it.options ? [...it.options] : [],
      answer: it.answer,
      explanation: it.explanation || "",
    });
    setEditing(idx);
  };

  const commitEdit = async () => {
    if (editing == null || !draft) return;
    if (!draft.prompt.trim()) {
      await alertDialog({ title: "Empty question", message: "The question text cannot be empty." });
      return;
    }
    const options = draft.options.map((o) => o.trim()).filter((o) => o !== "");
    if (items[editing].type === "mcq") {
      if (options.length < 2) {
        await alertDialog({ title: "MCQ needs options", message: "Give at least two answer choices." });
        return;
      }
      if (!options.some((o) => o.trim() === draft.answer.trim())) {
        await alertDialog({ title: "Answer mismatch", message: "The answer must match one of the options." });
        return;
      }
    }
    const next = items.map((it, i) =>
      i === editing
        ? {
            ...it,
            prompt: draft.prompt.trim(),
            options: items[i].type === "mcq" ? options : null,
            answer: items[i].type === "mcq" ? options.find((o) => o.trim() === draft.answer.trim())! : draft.answer.trim(),
            explanation: draft.explanation.trim() || null,
            needsRecheck: true,
          }
        : it
    );
    setEditing(null);
    setDraft(null);
    const rechecked = await recheckDuplicates(next);
    setItems(rechecked);
  };

  const saveSelected = async () => {
    const payload = items.filter((i) => i.include && !i.isDuplicate);
    if (payload.length === 0) {
      await alertDialog({ title: "Nothing to save", message: "Select at least one non-duplicate question." });
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/questions/bulk-import", {
        subject_id: subjectId,
        questions: payload.map((q) => ({
          type: q.type,
          difficulty: q.difficulty,
          prompt: q.prompt,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation,
          marks: q.marks,
          ...(chapterId ? { chapter_id: chapterId } : {}),
        })),
      });
      const skipped = data.skipped ?? 0;
      let msg = `${data.imported ?? 0} questions saved`;
      if (skipped > 0) msg += `, ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped by the duplicate check`;
      if (data.failed > 0) msg += `, ${data.failed} failed`;
      await alertDialog({ title: "Save result", message: `${msg}.` });
      nav("/questions");
    } catch (e) {
      await alertDialog({ title: "Save failed", message: errorMessage(e, "Questions could not be saved.") });
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    const ok = await confirmDialog({
      title: "Discard generated questions?",
      message: "The generated batch will be lost. Nothing has been saved yet.",
      confirmLabel: "Discard",
    });
    if (ok) {
      setItems([]);
      setStep(0);
    }
  };

  /* -------------------------------------------------------------------- view */

  const stepper = (
    <div className="mb-6 flex items-center gap-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <button
            type="button"
            disabled={i > step || step === 2 || (i > 1 && items.length === 0)}
            onClick={() => i < step && setStep(i)}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition",
              i === step ? "bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/50" :
              i < step ? "text-slate-300 hover:bg-ink/10 cursor-pointer" : "text-slate-500"
            )}
          >
            <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px]",
              i === step ? "bg-violet-500 text-white" : i < step ? "bg-slate-600 text-slate-200" : "bg-slate-700/60 text-slate-500")}>
              {i < step ? "✓" : i + 1}
            </span>
            {label}
          </button>
          {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-700" />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-violet-300 ring-1 ring-violet-400/40">
          <Sparkles size={22} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-100">AI Question Generator</h1>
          <p className="text-sm text-slate-400">Turn a book or source text into review-ready questions.</p>
        </div>
      </header>

      {stepper}

      {/* ------------------------------------------------------- step 0: source */}
      {step === 0 && (
        <>
        <Card hover={false}>
          <div className="mb-4 flex gap-2">
            <Button variant={mode === "document" ? "primary" : "outline"} onClick={() => setMode("document")}>
              <FileText size={16} /> PDF book
            </Button>
            <Button variant={mode === "text" ? "primary" : "outline"} onClick={() => setMode("text")}>
              <Upload size={16} /> Paste text
            </Button>
          </div>

          {mode === "document" ? (
            <div className="space-y-4">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadPct !== null}>
                  {uploadPct !== null ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                  {uploadPct !== null ? `Uploading ${uploadPct}%` : "Upload PDF"}
                </Button>
                <Button variant="ghost" onClick={() => loadModels(true)} disabled={modelsLoading} title="Refresh model list">
                  <RefreshCw size={15} className={modelsLoading ? "animate-spin" : ""} /> Refresh
                </Button>
                <span className="text-xs text-slate-500">Text is extracted on the server — only the text is stored.</span>
              </div>

              {docs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-600/70 px-4 py-6 text-center text-sm text-slate-500">
                  No sources uploaded yet. Upload a PDF, or switch to “Paste text”.
                </p>
              ) : (
                <div className="space-y-2">
                  {docs.map((d) => (
                    <label
                      key={d.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition",
                        documentId === d.id ? "border-violet-400/70 bg-violet-500/10 text-slate-100" : "border-slate-600/60 text-slate-300 hover:bg-ink/10"
                      )}
                    >
                      <input type="radio" name="sourceDoc" checked={documentId === d.id} onChange={() => setDocumentId(d.id)} className="accent-violet-400" />
                      <FileText size={16} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {d.pages ?? "?"} pages · {fmtSize(d.char_count)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); removeDoc(d); }}
                        className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
                        title="Delete source"
                      >
                        <Trash2 size={15} />
                      </button>
                    </label>
                  ))}
                </div>
              )}

              {selectedDoc && (
                <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-900/40 p-3">
                  <Field label="Pages (optional)">
                    <div className="flex items-center gap-2">
                      <NumberInput placeholder="from" value={pageFrom} onChange={(e) => setPageFrom(e.target.value)} min={1} max={selectedDoc.pages ?? 9999} className="w-24" />
                      <span className="text-slate-500">–</span>
                      <NumberInput placeholder="to" value={pageTo} onChange={(e) => setPageTo(e.target.value)} min={1} max={selectedDoc.pages ?? 9999} className="w-24" />
                    </div>
                  </Field>
                  <p className="pb-2 text-xs text-slate-500">
                    Leave empty for the whole book (long books are cut to the first part automatically).
                  </p>
                </div>
              )}
            </div>
          ) : (
            <Field label="Source text (chapter, notes, article…)">
              <Textarea
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the material your questions should come from. The generator only uses what is written here."
              />
              <p className="mt-1 pl-4 text-xs text-slate-500">{text.trim().length} characters — at least 30 needed.</p>
            </Field>
          )}

          <div className="mt-6 flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!canContinue}>
              Next: Settings <ArrowRight size={16} />
            </Button>
          </div>
        </Card>

        {history.length > 0 && (
          <details className="mt-4 rounded-2xl border border-slate-600/50 bg-slate-900/40 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-300">
              Recent generations ({history.length})
            </summary>
            <ul className="mt-3 space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                  <span className="text-slate-500">{new Date(h.created_at).toLocaleString()}</span>
                  <span className="font-semibold text-slate-300">{h.model}</span>
                  {h.subject_name && <span>{h.subject_name}</span>}
                  <span>{h.produced}/{h.requested} produced</span>
                  {h.duplicates > 0 && <span className="text-amber-300">🔁 {h.duplicates} duplicate{h.duplicates === 1 ? "" : "s"}</span>}
                  {h.invalid > 0 && <span className="text-rose-300">{h.invalid} dropped</span>}
                  <span className="text-slate-500">{Math.round((h.duration_ms || 0) / 1000)}s</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        </>
      )}

      {/* ---------------------------------------------------- step 1: settings */}
      {step === 1 && (
        <Card hover={false}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Subject (required)">
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="Pick a subject…">
                <option value="">Pick a subject…</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Chapter (optional)">
              <Select value={chapterId} onChange={(e) => setChapterId(e.target.value)} placeholder="Whole subject" disabled={!subjectId}>
                <option value="">Whole subject</option>
                {chapters.map((c) => <option key={c.id} value={c.id}>Ch {c.number} — {c.title}</option>)}
              </Select>
            </Field>

            <Field label="AI provider">
              {modelsLoading ? (
                <Skeleton className="h-10" />
              ) : enabledProviders.length === 0 ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                  No AI provider is configured on the server. Add an API key (for example <code>OPENCODE_API_KEY</code>) to{" "}
                  <code>backend/.env</code> — see <code>backend/.env.example</code> — and restart.
                </div>
              ) : (
                <Select value={providerId} onChange={(e) => { setProviderId(e.target.value); const p = enabledProviders.find((x) => x.id === e.target.value); setModelId(p?.models[0]?.id || ""); }}>
                  {enabledProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Model">
              {modelsLoading ? (
                <Skeleton className="h-10" />
              ) : (
                <Select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!currentProvider}>
                  {(currentProvider?.models || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}{m.appOnly ? " · OpenCode app only" : m.free ? " · free" : ""}
                    </option>
                  ))}
                </Select>
              )}
              {currentProvider && currentModel?.appOnly && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                  This free model only works inside the OpenCode app — generation from this server will fail. Pick a
                  non-free model and make sure the OpenCode account has credits.
                </p>
              )}
            </Field>

            <Field label="How many questions">
              <NumberInput value={count} onChange={(e) => setCount(e.target.value)} min={1} max={50} />
            </Field>
            <Field label="Difficulty">
              <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
            </Field>

            <Field label="Question types">
              <div className="flex gap-2 pt-1">
                {TYPE_OPTIONS.map((t) => {
                  const on = types.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTypes((prev) => (on ? prev.filter((x) => x !== t.value) : [...prev, t.value]))}
                      className={cn(
                        "rounded-xl border px-4 py-2 text-sm font-semibold transition",
                        on ? "border-violet-400/70 bg-violet-500/20 text-violet-200" : "border-slate-600/70 text-slate-400 hover:bg-ink/10"
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Language">
              <Select value={language} onChange={(e) => setLanguage(e.target.value as any)}>
                <option value="auto">Match the source</option>
                <option value="english">English</option>
                <option value="bangla">বাংলা</option>
              </Select>
            </Field>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep(0)}><ArrowLeft size={16} /> Back</Button>
            <Button onClick={runGenerate} disabled={!subjectId || !providerId || !modelId}>
              <Wand2 size={16} /> Generate
            </Button>
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------- step 2: running */}
      {step === 2 && (
        <Card hover={false} className="grid place-items-center gap-4 py-16 text-center">
          <Loader2 size={40} className="animate-spin text-violet-400" />
          <div>
            <p className="font-semibold text-slate-100">Generating {count} question{Number(count) === 1 ? "" : "s"}…</p>
            <p className="text-sm text-slate-400">Reading the source and writing the batch. This can take up to a minute.</p>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------ step 3: review */}
      {step === 3 && (
        <div className="space-y-4">
          <Card hover={false} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="font-semibold text-slate-100">{items.length} generated</span>
            {dupCount > 0 && <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-200">🔁 {dupCount} duplicate{dupCount === 1 ? "" : "s"} excluded</Badge>}
            {dropped.length > 0 && <Badge className="border-rose-500/40 bg-rose-500/15 text-rose-200">{dropped.length} invalid dropped</Badge>}
            {truncated && <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-300">source was cut to fit</Badge>}
            {usage && <span className="text-xs text-slate-500">~{usage.inputTokens ?? 0} in / {usage.outputTokens ?? 0} out tokens</span>}
            <span className="ml-auto text-xs font-semibold text-emerald-300">{includeCount} selected to save</span>
          </Card>

          {truncated && (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
              The source was longer than the model’s window — questions came from the first part only. Use page ranges for full coverage.
            </p>
          )}

          {dropped.length > 0 && (
            <details className="rounded-xl border border-slate-600/60 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
              <summary className="cursor-pointer text-slate-300">{dropped.length} item{dropped.length === 1 ? "" : "s"} rejected while parsing</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {dropped.slice(0, 20).map((d, i) => <li key={i}>• #{d.index + 1}: {d.reason}</li>)}
                {dropped.length > 20 && <li>…and {dropped.length - 20} more</li>}
              </ul>
            </details>
          )}

          {items.map((it, idx) => (
            <Card key={idx} hover={false} className={cn(it.isDuplicate && "border-amber-500/40")}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={it.include && !it.isDuplicate}
                  disabled={it.isDuplicate}
                  onChange={() => toggleInclude(idx)}
                  className="mt-1 h-4 w-4 accent-violet-400 disabled:opacity-40"
                  title={it.isDuplicate ? "Already in the bank — cannot be selected" : "Include in save"}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge>{it.type.toUpperCase()}</Badge>
                    <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-300">{it.difficulty}</Badge>
                    {it.isDuplicate && (
                      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-200">
                        <span className="inline-flex items-center gap-1"><Lock size={11} /> Already exists — excluded</span>
                      </Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => (editing === idx ? (setEditing(null), setDraft(null)) : startEdit(idx))}
                      className="ml-auto rounded-lg p-1.5 text-slate-400 transition hover:bg-ink/10 hover:text-violet-300"
                      title={editing === idx ? "Cancel edit" : "Edit"}
                    >
                      {editing === idx ? <X size={16} /> : <Pencil size={15} />}
                    </button>
                  </div>

                  {editing === idx && draft ? (
                    <div className="space-y-3">
                      <Textarea rows={3} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} placeholder="Question" />
                      {it.type === "mcq" && (
                        <div className="space-y-2">
                          {draft.options.map((o, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`answer-${idx}`}
                                checked={draft.answer === o && o.trim() !== ""}
                                onChange={() => setDraft({ ...draft, answer: o })}
                                className="accent-emerald-400"
                                title="Correct answer"
                              />
                              <Input
                                value={o}
                                onChange={(e) => {
                                  const opts = [...draft.options];
                                  const old = opts[oi];
                                  opts[oi] = e.target.value;
                                  setDraft({ ...draft, options: opts, answer: draft.answer === old ? e.target.value : draft.answer });
                                }}
                                placeholder={`Option ${oi + 1} (radio = correct)`}
                              />
                              <button
                                type="button"
                                onClick={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== oi), answer: draft.answer === o ? "" : draft.answer })}
                                className="rounded-lg p-1.5 text-slate-500 hover:text-rose-300"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          <Button variant="outline" onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}>+ Option</Button>
                        </div>
                      )}
                      {it.type !== "mcq" && (
                        <Input value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder="Model answer" />
                      )}
                      <Textarea rows={2} value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} placeholder="Explanation (why the answer is correct)" />
                      <div className="flex gap-2">
                        <Button onClick={commitEdit}><Save size={15} /> Apply</Button>
                        <Button variant="outline" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-100">{it.prompt}</p>
                      {it.options && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {it.options.map((o, oi) => (
                            <li key={oi} className={cn("rounded-lg px-2 py-1", o === it.answer ? "bg-emerald-500/15 text-emerald-200" : "text-slate-300")}>
                              {String.fromCharCode(65 + oi)}. {o} {o === it.answer && "✓"}
                            </li>
                          ))}
                        </ul>
                      )}
                      {!it.options && <p className="mt-1 text-sm text-emerald-300">Answer: {it.answer}</p>}
                      {it.explanation && <p className="mt-2 text-xs text-slate-400">{it.explanation}</p>}
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}

          <div className="flex flex-wrap items-center gap-3 pb-6">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft size={16} /> Change settings</Button>
            <Button variant="ghost" onClick={runGenerate} disabled={busy}>
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Regenerate
            </Button>
            <Button variant="outline" onClick={discard}>Discard</Button>
            <Button className="ml-auto" onClick={saveSelected} disabled={saving || includeCount === 0}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save {includeCount} question{includeCount === 1 ? "" : "s"}
            </Button>
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
            Saving re-runs the duplicate check server-side — anything already in the bank is skipped, never overwritten.
          </p>
        </div>
      )}
    </div>
  );
}
