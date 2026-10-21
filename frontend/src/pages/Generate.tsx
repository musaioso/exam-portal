import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { optionLabel } from "../lib/labels";
import { useToast } from "../components/Toast";
import { Card, Button, Input, NumberInput, Field, Textarea, Select, Badge, Skeleton, cn } from "../components/ui";
import { alertDialog, confirmDialog } from "../components/Dialog";
import {
  Sparkles, Upload, FileText, RefreshCw, Trash2, Wand2,
  Save, Lock, Pencil, Loader2, AlertTriangle, X, Settings2, KeyRound, Check, Image as ImageIcon,
} from "lucide-react";

/**
 * AI question generator — ONE page, same house style as Create exam:
 * numbered sections, a summary/action bar, and the review batch appearing
 * inline below once questions come back (no step wizard, no back-and-forth).
 *
 * Sources can be mixed freely: PDFs, PNG/JPG page photos (OCR'd on upload)
 * and pasted text. Nothing generated here enters the question bank
 * automatically. Duplicates are excluded three times: the response flags
 * prompts already in the subject, edited prompts are re-checked live, and the
 * final save runs through bulk-import's skip_duplicates pass — so a duplicate
 * can never be saved.
 */

type ModelInfo = { id: string; name?: string; free?: boolean; appOnly?: boolean; context?: number };
type Provider = { id: string; label: string; enabled: boolean; error?: string; models: ModelInfo[] };
type SourceDoc = { id: string; name: string; pages: number | null; char_count: number; kind?: "pdf" | "image" | null; created_at: number };
type KeyStatus = {
  id: string; label: string; keyless: boolean; enabled: boolean;
  source: "env" | "stored" | null; hint: string | null; envVar?: string;
};
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
const OCR_LANG_OPTIONS = [
  { value: "eng", label: "English" },
  { value: "ben", label: "বাংলা" },
  { value: "eng+ben", label: "English + বাংলা" },
];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

/** One numbered block of the form. Same shape as the exam builder's. */
function FormSection({ step, title, hint, icon: Icon, right, done, children }: {
  step: number; title: string; hint?: string; icon: any; right?: React.ReactNode; done?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-600/40 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold",
              done ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-indigo-500/25 bg-indigo-500/15 text-indigo-300",
            )}
            title={done ? "Done" : undefined}
          >
            {done ? <Check size={14} strokeWidth={3} /> : step}
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
              <Icon size={15} className="text-indigo-300" /> {title}
            </h3>
            {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Small stat chip used in the summary/action bars. */
function StatChip({ icon: Icon, tone = "text-indigo-300", children }: {
  icon: any; tone?: string; children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1 text-xs text-slate-300">
      <Icon size={13} className={tone} /> <span className="tabular-nums">{children}</span>
    </span>
  );
}

export default function Generate() {
  const toast = useToast();
  const nav = useNavigate();

  const [busy, setBusy] = useState(false);

  // Source
  const [mode, setMode] = useState<"document" | "text">("document");
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageFrom, setPageFrom] = useState("");
  const [pageTo, setPageTo] = useState("");
  const [text, setText] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  // Bangla is the common case for scanned pages here, and the English model
  // alone turns Bangla script into Latin garbage. Default to both so an
  // upload is never silently misread.
  const [ocrLang, setOcrLang] = useState("eng+ben");
  // Vision ("read with AI") state — see uploadWithVision.
  const [visionProviders, setVisionProviders] = useState<Array<{ id: string; label: string; models: string[] }>>([]);
  const [visionBusy, setVisionBusy] = useState(false);
  // Ids of sources produced by a vision read, so the list can label them.
  const [aiReadIds, setAiReadIds] = useState<string[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const visionRef = useRef<HTMLInputElement>(null);

  // Question settings
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [count, setCount] = useState("10");
  const [difficulty, setDifficulty] = useState("mixed");
  const [types, setTypes] = useState<string[]>(["mcq"]);
  const [language, setLanguage] = useState<"auto" | "english" | "bangla">("auto");

  // AI model
  const [providers, setProviders] = useState<Provider[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  // Optional seed from the server (AI_DEFAULT_MODEL), e.g. a Gemini model.
  const [preferredModel, setPreferredModel] = useState("");
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [showKeys, setShowKeys] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Review (inline, below the form)
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [dropped, setDropped] = useState<Dropped[]>([]);
  const [usage, setUsage] = useState<{ inputTokens?: number; outputTokens?: number } | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ prompt: string; options: string[]; answer: string; explanation: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchId, setBatchId] = useState("");
  const reviewRef = useRef<HTMLDivElement>(null);

  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const currentProvider = enabledProviders.find((p) => p.id === providerId);
  const currentModel = currentProvider?.models.find((m) => m.id === modelId);
  const selectedDocs = docs.filter((d) => selectedIds.includes(d.id));
  const selectedChars = selectedDocs.reduce((n, d) => n + (d.char_count || 0), 0);
  const dupCount = items.filter((i) => i.isDuplicate).length;
  const includeCount = items.filter((i) => i.include && !i.isDuplicate).length;
  const sourceOk = mode === "text" ? text.trim().length >= 30 : selectedIds.length > 0;
  const canGenerate = !!(sourceOk && subjectId && types.length && providerId && modelId && !busy);

  /* ------------------------------------------------------------ data loading */

  const loadDocs = async () => {
    try {
      const { data } = await api.get("/documents");
      setDocs(data.documents || []);
    } catch { /* list failure is non-fatal — pasted text still works */ }
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
      if (data.defaultModel) setPreferredModel(String(data.defaultModel));
    } catch (e) {
      toast.error(errorMessage(e, "Could not load the AI model list."));
    } finally {
      setModelsLoading(false);
    }
  };
  const loadKeys = async () => {
    try {
      const { data } = await api.get("/ai/keys");
      setKeys(data.keys || []);
    } catch { /* non-fatal — the key panel simply stays hidden */ }
  };
  useEffect(() => { loadDocs(); loadModels(); loadKeys(); loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Which providers can read page images — drives the "read with AI" button.
  useEffect(() => {
    api.get("/ai/vision")
      .then((r) => setVisionProviders(r.data.providers || []))
      .catch(() => setVisionProviders([])); // no AI reading is a valid state
  }, []);
  useEffect(() => { api.get("/subjects").then((r) => setSubjects(r.data.subjects || [])); }, []);
  useEffect(() => {
    setChapterId("");
    if (subjectId) api.get(`/subjects/${subjectId}/chapters`).then((r) => setChapters(r.data.chapters || []));
    else setChapters([]);
  }, [subjectId]);

  // Default the pickers to the first usable provider/model (lists are sorted
  // server-callable-first, newest-first by the backend; app-only free-tier
  // models sink to the bottom because this backend cannot call them).
  // A server-provided seed (AI_DEFAULT_MODEL, e.g. a Gemini model) wins when
  // that model is actually offered by the provider.
  useEffect(() => {
    if (enabledProviders.length === 0) return;
    const stillValid = enabledProviders.some((p) => p.id === providerId);
    const p = stillValid ? enabledProviders.find((x) => x.id === providerId)! : enabledProviders[0];
    if (!stillValid) setProviderId(p.id);
    const usable = p.models.filter((m) => !m.appOnly);
    const seed = preferredModel ? usable.find((m) => m.id === preferredModel) : undefined;
    if (!p.models.some((m) => m.id === modelId && !m.appOnly)) {
      setModelId((seed || usable[0] || p.models[0])?.id || "");
    } else if (seed && !modelId) {
      setModelId(seed.id);
    }
  }, [providers]); // eslint-disable-line react-hooks/exhaustive-deps

  // No provider configured → open the key panel so the fix is right there.
  useEffect(() => {
    if (!modelsLoading && keys.length > 0 && enabledProviders.length === 0) setShowKeys(true);
  }, [modelsLoading, keys, enabledProviders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bring a fresh batch into view when it arrives.
  useEffect(() => {
    if (batchId && reviewRef.current) {
      reviewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [batchId]);

  /* ------------------------------------------------------------------ upload */

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const bad = list.find((f) => !/^(application\/pdf|image\/png|image\/jpeg)$/i.test(f.type) && !/\.(pdf|png|jpe?g)$/i.test(f.name));
    if (bad) {
      await alertDialog({ title: "Unsupported file", message: `“${bad.name}” is not a PDF, PNG or JPG.` });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploadPct(0);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("file", f);
      fd.append("ocr_lang", ocrLang);
      const { data } = await api.post("/documents", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        // OCR of a scanned book happens inside this request — allow up to 15 min.
        timeout: 15 * 60 * 1000,
        onUploadProgress: (e) => {
          if (e.total) setUploadPct(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        },
      });
      await loadDocs();
      const newIds = (data.documents || []).map((d: any) => d.id);
      setSelectedIds((prev) => [...new Set([...prev, ...newIds])]);
      setMode("document");
      const warnings = (data.documents || []).filter((d: any) => d.warning).map((d: any) => `“${d.name}”: ${d.warning}`);
      const errors = (data.errors || []).map((e: any) => `“${e.name}”: ${e.error}`);
      const okCount = (data.documents || []).length;
      if (okCount > 0) toast.success(`${okCount} source${okCount === 1 ? "" : "s"} added — text extracted on the server.`);
      for (const w of warnings) toast.info(w);
      for (const e of errors) toast.error(e);
    } catch (e) {
      await alertDialog({ title: "Upload failed", message: errorMessage(e, "The files could not be uploaded.") });
    } finally {
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /**
   * Re-read the chosen file with a vision model instead of tesseract. The
   * server keeps only extracted text, so the original has to be sent again —
   * hence a dedicated file picker rather than a "re-read" button on the list.
   * Creates a NEW source document; the tesseract one is left untouched so the
   * teacher can compare and delete whichever is worse.
   */
  const readWithVision = async (files: FileList | null, providerId: string) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setVisionBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("provider", providerId);
      // Only pass the generation model along when it can actually read images;
      // the server falls back to a vision model of the same provider otherwise.
      if (modelId) fd.append("model", modelId);
      const { data } = await api.post("/documents/vision-read", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        // Vision reads of a multi-page book take a while.
        timeout: 15 * 60 * 1000,
      });
      await loadDocs();
      if (data.document?.id) {
        setSelectedIds((prev) => [...new Set([...prev, data.document.id])]);
        setAiReadIds((prev) => [...new Set([...prev, data.document.id])]);
        setMode("document");
      }
      const who = data.readBy ? `${data.readBy.model}` : "the AI model";
      toast.success(`“${data.document?.name}” read by ${who} — ${(data.document?.char_count || 0).toLocaleString()} characters.`);
      if (data.warning) toast.info(data.warning);
    } catch (e) {
      await alertDialog({
        title: "AI reading failed",
        message: errorMessage(e, "The file could not be read with the AI model. The built-in OCR result is unchanged."),
      });
    } finally {
      setVisionBusy(false);
      if (visionRef.current) visionRef.current.value = "";
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
      setSelectedIds((prev) => prev.filter((id) => id !== doc.id));
      await loadDocs();
    } catch (e) {
      toast.error(errorMessage(e, "Could not delete the document."));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /* --------------------------------------------------------------- key manager */

  const saveKey = async (providerIdToSave: string, force = false) => {
    const key = (keyDrafts[providerIdToSave] || "").trim();
    if (!key) return;
    setSavingKey(providerIdToSave);
    try {
      const { data } = await api.post("/ai/keys", { provider: providerIdToSave, key, ...(force ? { force: true } : {}) });
      if (data.warning) toast.info(`Key saved — but the vendor check failed (${data.warning}).`);
      else toast.success(`API key saved — the provider is ready${data.models ? ` (${data.models} models)` : ""}.`);
      setKeyDrafts((d) => ({ ...d, [providerIdToSave]: "" }));
      await Promise.all([loadKeys(), loadModels(true)]);
    } catch (e: any) {
      if (e?.response?.status === 409 && e.response.data?.needsConfirm) {
        const ok = await confirmDialog({
          title: "The vendor rejected this key",
          message: `${e.response.data.error}\n\nSave it anyway? (Use this when your account really has access but the vendor's model-list check disagrees.)`,
          confirmLabel: "Save anyway",
        });
        if (ok) { setSavingKey(null); return saveKey(providerIdToSave, true); }
      } else {
        toast.error(errorMessage(e, "The key could not be saved."));
      }
    } finally {
      setSavingKey(null);
    }
  };

  const removeKey = async (k: KeyStatus) => {
    const ok = await confirmDialog({
      title: `Remove the ${k.label} key?`,
      message: "The provider will be disabled until a key is added again.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await api.delete(`/ai/keys/${k.id}`);
      toast.success(`Removed the stored ${k.label} key.`);
      await Promise.all([loadKeys(), loadModels(true)]);
    } catch (e) {
      toast.error(errorMessage(e, "Could not remove the key."));
    }
  };

  /* ---------------------------------------------------------------- generate */

  const runGenerate = async () => {
    if (!sourceOk) {
      await alertDialog({ title: "Source required", message: mode === "text" ? "Paste at least 30 characters of source text." : "Tick at least one uploaded source." });
      return;
    }
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
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        provider: providerId,
        model: modelId,
        subject_id: subjectId,
        chapter_id: chapterId || undefined,
        count: Math.max(1, Math.min(50, Number(count) || 10)),
        difficulty,
        types,
        language,
      };
      if (mode === "text") {
        payload.text = text;
      } else {
        payload.documentIds = selectedIds;
        // Page ranges only make sense against a single document.
        if (selectedIds.length === 1) {
          if (pageFrom) payload.pageFrom = Number(pageFrom);
          if (pageTo) payload.pageTo = Number(pageTo);
        }
      }
      const { data } = await api.post("/ai/generate", payload, { timeout: 10 * 60 * 1000 });
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
      setBatchId(data.generationId || String(Date.now()));
      loadHistory();
      if (data.duplicates > 0) {
        toast.info(`${data.duplicates} generated question${data.duplicates === 1 ? "" : "s"} already exist${data.duplicates === 1 ? "s" : ""} in this subject and were excluded.`);
      }
    } catch (e) {
      await alertDialog({ title: "Generation failed", message: errorMessage(e, "The AI provider could not generate questions. Try again or pick another model.") });
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
      setDropped([]);
      setBatchId("");
    }
  };

  /* -------------------------------------------------------------------- view */

  const sourceHint = !sourceOk
    ? mode === "text" ? "Paste at least 30 characters." : "Tick at least one source."
    : !subjectId ? "Pick a subject."
      : enabledProviders.length === 0 ? "Add an API key in the AI model section."
        : !providerId || !modelId ? "Pick a model."
          : `Ready — ${count} question${Number(count) === 1 ? "" : "s"} from ${mode === "text" ? "pasted text" : `${selectedIds.length} source${selectedIds.length === 1 ? "" : "s"}`}.`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-violet-300 ring-1 ring-violet-400/40">
            <Sparkles size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">AI Question Generator</h1>
            <p className="text-sm text-slate-400">Turn books, page photos or pasted text into review-ready questions.</p>
          </div>
        </div>
        <Button variant="ghost" onClick={() => { loadModels(true); loadKeys(); }} disabled={modelsLoading} title="Refresh model list and key status">
          <RefreshCw size={15} className={modelsLoading ? "animate-spin" : ""} /> Refresh
        </Button>
      </header>

      {/* ------------------------------------------------------------ the form */}
      <Card hover={false} className="overflow-hidden p-0">
        <div className="flex items-start justify-between gap-4 border-b border-slate-600/40 bg-ink/5 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 text-white shadow-lg shadow-violet-500/25">
              <Wand2 size={20} />
            </span>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Generate questions</h2>
              <p className="mt-0.5 text-xs text-slate-400">One page, no steps — everything below stays editable.</p>
            </div>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); runGenerate(); }} className="space-y-5 p-5 sm:p-6">
          {/* ------------------------------------------------ 1 · source material */}
          <FormSection
            step={1}
            title="Source material"
            hint="PDFs, PNG/JPG pages (OCR'd) or pasted text — mix them freely."
            icon={FileText}
            done={sourceOk}
            right={
              <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-300">
                {mode === "text" ? `${text.trim().length} chars` : `${selectedIds.length} selected`}
              </Badge>
            }
          >
            <div className="mb-4 flex gap-2">
              <Button type="button" variant={mode === "document" ? "primary" : "outline"} onClick={() => setMode("document")}>
                <FileText size={16} /> Files
              </Button>
              <Button type="button" variant={mode === "text" ? "primary" : "outline"} onClick={() => setMode("text")}>
                <Upload size={16} /> Paste text
              </Button>
            </div>

            {mode === "document" ? (
              <div className="space-y-4">
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => uploadFiles(e.target.files)}
                />
                <input
                  ref={visionRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => readWithVision(e.target.files, visionProviders[0].id)}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadPct !== null || visionBusy}>
                    {uploadPct !== null ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    {uploadPct !== null ? "Uploading…" : "Upload PDF / images"}
                  </Button>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Image OCR language:</span>
                    {OCR_LANG_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setOcrLang(o.value)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                          ocrLang === o.value ? "border-violet-400/70 bg-violet-500/20 text-violet-200" : "border-slate-600/70 text-slate-400 hover:bg-ink/10"
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI vision reading — the accurate path for small/dense Bangla
                    print, which the built-in OCR turns into Latin garbage. */}
                {visionProviders.length > 0 && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => visionRef.current?.click()}
                        disabled={visionBusy || uploadPct !== null}
                      >
                        {visionBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        {visionBusy ? "Reading with AI…" : "Read with AI"}
                      </Button>
                      <p className="min-w-0 flex-1 text-xs text-slate-400">
                        Much more accurate than the built-in OCR on small or dense Bangla print.
                        Upload the same page again — it is read by{" "}
                        <span className="font-semibold text-violet-300">{visionProviders[0].label}</span> and added as a new source.
                      </p>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Uses your configured AI key. Slower than OCR (a few seconds per page) and subject to the provider’s daily limits.
                    </p>
                  </div>
                )}

                <p className="text-xs text-slate-500">
                  PDF, PNG or JPG — pick several at once. Images and scanned pages are OCR’d on the server; only the text is stored.
                  {uploadPct !== null && " Extracting text can take a minute for scanned files…"}
                </p>

                {docs.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-600/70 px-4 py-6 text-center text-sm text-slate-500">
                    No sources uploaded yet. Upload a PDF or page photos, or switch to “Paste text”.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {docs.map((d) => {
                      const checked = selectedIds.includes(d.id);
                      return (
                        <label
                          key={d.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition",
                            checked ? "border-violet-400/70 bg-violet-500/10 text-slate-100" : "border-slate-600/60 text-slate-300 hover:bg-ink/10"
                          )}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleSelect(d.id)} className="h-4 w-4 accent-violet-400" />
                          {d.kind === "image"
                            ? <ImageIcon size={16} className="shrink-0 text-slate-400" />
                            : <FileText size={16} className="shrink-0 text-slate-400" />}
                          <span className="min-w-0 flex-1 truncate">{d.name}</span>
                          {aiReadIds.includes(d.id) && (
                            <span className="shrink-0 rounded-md border border-violet-400/50 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                              AI
                            </span>
                          )}
                          <span className="shrink-0 text-xs text-slate-500">
                            {d.kind === "image" ? "image · OCR" : `${d.pages ?? "?"} pages`} · {d.char_count.toLocaleString()} chars
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
                      );
                    })}
                  </div>
                )}

                {selectedDocs.length === 1 && (selectedDocs[0].pages ?? 0) > 1 && (
                  <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-900/40 p-3">
                    <Field label="Pages (optional)">
                      <div className="flex items-center gap-2">
                        <NumberInput placeholder="from" value={pageFrom} onChange={(e) => setPageFrom(e.target.value)} min={1} max={selectedDocs[0].pages ?? 9999} className="w-24" />
                        <span className="text-slate-500">–</span>
                        <NumberInput placeholder="to" value={pageTo} onChange={(e) => setPageTo(e.target.value)} min={1} max={selectedDocs[0].pages ?? 9999} className="w-24" />
                      </div>
                    </Field>
                    <p className="pb-2 text-xs text-slate-500">
                      Leave empty for the whole book (long books are cut to the first part automatically).
                    </p>
                  </div>
                )}
                {selectedIds.length > 1 && (pageFrom || pageTo) && (
                  <p className="text-xs text-amber-400">A page range applies to a single document — with several sources selected the whole of each is used.</p>
                )}
              </div>
            ) : (
              <Field label="Source text (chapter, notes, article…)">
                <Textarea
                  rows={10}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the material your questions should come from. The generator only uses what is written here."
                />
                <p className="mt-1 pl-4 text-xs text-slate-500">{text.trim().length} characters — at least 30 needed.</p>
              </Field>
            )}
          </FormSection>

          {/* ------------------------------------------------ 2 · question settings */}
          <FormSection
            step={2}
            title="Question settings"
            hint="What to generate and how hard."
            icon={Settings2}
            done={!!subjectId && types.length > 0}
            right={subjectId ? <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-200">subject set</Badge> : undefined}
          >
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
          </FormSection>

          {/* ------------------------------------------------------- 3 · AI model */}
          <FormSection
            step={3}
            title="AI model"
            hint="Provider, model and API keys — paste a key and the provider turns on."
            icon={Sparkles}
            done={!!providerId && !!modelId}
            right={
              <button
                type="button"
                onClick={() => setShowKeys((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition",
                  showKeys ? "border-violet-400/60 bg-violet-500/15 text-violet-200" : "border-slate-600/60 text-slate-300 hover:bg-ink/10"
                )}
              >
                <KeyRound size={13} /> Manage API keys
              </button>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="AI provider">
                {modelsLoading ? (
                  <Skeleton className="h-10" />
                ) : enabledProviders.length === 0 ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                    No AI provider is configured yet. Open “Manage API keys” above and paste a key (Groq, DeepSeek, OpenAI…) —
                    it is checked against the vendor and saved on the server.
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
                    {(currentProvider?.models.length ?? 0) === 0 && <option value="">No models returned</option>}
                  </Select>
                )}
                {currentProvider?.error && (
                  <p className="mt-1.5 text-xs text-rose-400">
                    Could not load {currentProvider.label}’s models: {currentProvider.error}
                  </p>
                )}
                {currentProvider && currentModel?.appOnly && (
                  <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                    This free model only works inside the OpenCode app — generation from this server will fail. Pick a
                    non-free model and make sure the OpenCode account has credits.
                  </p>
                )}
              </Field>
            </div>

            {showKeys && (
              <div className="mt-4 space-y-2 rounded-xl border border-slate-600/50 bg-slate-900/40 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-300">API keys — validated against the vendor, stored on the server, never displayed again.</p>
                  <button type="button" onClick={() => setShowKeys(false)} className="rounded-lg p-1 text-slate-500 hover:text-slate-300"><X size={14} /></button>
                </div>
                {keys.length === 0 ? (
                  <Skeleton className="h-10" />
                ) : (
                  keys.map((k) => (
                    <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/50 bg-ink/5 px-3 py-2.5">
                      <span className="w-36 shrink-0 truncate text-sm font-medium text-slate-200">{k.label}</span>
                      {k.enabled ? (
                        <Badge className={k.source === "env" ? "border-sky-500/40 bg-sky-500/15 text-sky-200" : "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"}>
                          {k.source === "env" ? "via server env" : "connected"}
                        </Badge>
                      ) : (
                        <Badge className="border-slate-600/60 bg-slate-700/30 text-slate-400">off</Badge>
                      )}
                      {k.hint && <span className="text-xs tabular-nums text-slate-500">{k.hint}</span>}

                      {k.keyless ? (
                        <span className="text-xs text-slate-500">
                          {k.enabled ? "Host configured — no key needed." : `No key needed — set ${k.id === "ollama" ? "OLLAMA_HOST" : "LMSTUDIO_HOST"} on the server.`}
                        </span>
                      ) : k.source === "env" ? (
                        <span className="text-xs text-slate-500">Key comes from the server environment ({k.envVar}).</span>
                      ) : (
                        <>
                          <Input
                            type="password"
                            autoComplete="off"
                            placeholder={k.hint ? `Replace (${k.hint})` : "Paste API key"}
                            value={keyDrafts[k.id] || ""}
                            onChange={(e) => setKeyDrafts((d) => ({ ...d, [k.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveKey(k.id); } }}
                            className="w-56"
                          />
                          <Button type="button" size="sm" onClick={() => saveKey(k.id)} disabled={!keyDrafts[k.id]?.trim() || savingKey === k.id}>
                            {savingKey === k.id ? <Loader2 size={14} className="animate-spin" /> : null}
                            {k.source === "stored" ? "Replace" : "Save"}
                          </Button>
                          {k.source === "stored" && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeKey(k)}>Remove</Button>
                          )}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </FormSection>

          {/* ------------------------------------------------------ summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-600/40 bg-ink/5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatChip icon={FileText}>
                {mode === "text" ? "pasted text" : `${selectedIds.length} source${selectedIds.length === 1 ? "" : "s"}`}
              </StatChip>
              <StatChip icon={Sparkles} tone="text-violet-300">{providerId ? `${providerId} · ${modelId || "—"}` : "no model"}</StatChip>
              <span className={cn("text-xs", sourceHint.startsWith("Ready") ? "text-emerald-300" : "text-amber-300")}>{sourceHint}</span>
            </div>
            <Button type="submit" disabled={!canGenerate}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {busy ? "Generating…" : "Generate"}
            </Button>
          </div>
          {busy && (
            <p className="flex items-center gap-2 rounded-xl bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin text-violet-400" />
              Reading the source and writing {count} question{Number(count) === 1 ? "" : "s"} — this can take up to a minute.
            </p>
          )}
        </form>
      </Card>

      {/* ----------------------------------------------------------- review */}
      {items.length > 0 && (
        <div ref={reviewRef} className="space-y-4">
          <Card hover={false} className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-600/40 bg-ink/5 px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-lg shadow-emerald-500/25">
                  <Check size={20} strokeWidth={3} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold leading-tight">Review {items.length} generated question{items.length === 1 ? "" : "s"}</h2>
                  <p className="mt-0.5 text-xs text-slate-400">Edit anything, then save — duplicates never enter the bank.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={runGenerate} disabled={busy}>
                  <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Regenerate
                </Button>
                <Button variant="outline" onClick={discard}>Discard</Button>
              </div>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <span className="font-semibold text-slate-100">{items.length} generated</span>
                {dupCount > 0 && <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-200">🔁 {dupCount} duplicate{dupCount === 1 ? "" : "s"} excluded</Badge>}
                {dropped.length > 0 && <Badge className="border-rose-500/40 bg-rose-500/15 text-rose-200">{dropped.length} invalid dropped</Badge>}
                {truncated && <Badge className="border-slate-500/40 bg-slate-500/15 text-slate-300">source was cut to fit</Badge>}
                {usage && <span className="text-xs text-slate-500">~{usage.inputTokens ?? 0} in / {usage.outputTokens ?? 0} out tokens</span>}
                <span className="ml-auto text-xs font-semibold text-emerald-300">{includeCount} selected to save</span>
              </div>

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
                              <Button type="button" variant="outline" onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}>+ Option</Button>
                            </div>
                          )}
                          {it.type !== "mcq" && (
                            <Input value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder="Model answer" />
                          )}
                          <Textarea rows={2} value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} placeholder="Explanation (why the answer is correct)" />
                          <div className="flex gap-2">
                            <Button type="button" onClick={commitEdit}><Save size={15} /> Apply</Button>
                            <Button type="button" variant="outline" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-slate-100">{it.prompt}</p>
                          {it.options && (
                            <ul className="mt-2 space-y-1 text-sm">
                              {it.options.map((o, oi) => (
                                <li key={oi} className={cn("rounded-lg px-2 py-1", o === it.answer ? "bg-emerald-500/15 text-emerald-200" : "text-slate-300")}>
                                  {optionLabel(it.prompt, oi)}. {o} {o === it.answer && "✓"}
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

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-600/40 bg-ink/5 px-4 py-3">
                <p className="flex items-start gap-2 text-xs text-slate-500">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                  Saving re-runs the duplicate check server-side — anything already in the bank is skipped, never overwritten.
                </p>
                <Button onClick={saveSelected} disabled={saving || includeCount === 0}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Save {includeCount} question{includeCount === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------ history */}
      {history.length > 0 && (
        <details className="rounded-2xl border border-slate-600/50 bg-slate-900/40 px-4 py-3">
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
    </div>
  );
}
