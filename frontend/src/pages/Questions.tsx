import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { optionLabel } from "../lib/labels";
import { useToast } from "../components/Toast";
import { Card, Button, Input, NumberInput, Field, Textarea, Select, Badge, Skeleton, cn } from "../components/ui";
import { confirmDialog, alertDialog } from "../components/Dialog";
import { CopyCheck, Plus, Trash2, Upload } from "lucide-react";

const empty = { subject_id: "", chapter_id: "", type: "mcq", difficulty: "medium", prompt: "", options: ["", "", "", ""], answer: "", explanation: "", marks: 1 };

type DupeItem = {
  id: string; prompt: string; type: string; difficulty: string;
  chapter_number: number | null; chapter_title: string | null;
  answer: string | null; explanation: string | null; marks: number; created_at: number;
};
type DupeGroup = { key: string; subject_name: string | null; count: number; answerDiffers: boolean; items: DupeItem[] };

/** What makes a copy worth keeping: an explanation counts most, then a chapter, then an answer. */
const weight = (q: DupeItem) => (q.explanation ? 4 : 0) + (q.chapter_title ? 2 : 0) + (q.answer ? 1 : 0);
/** The fullest copy wins; ties go to the older question. */
const richest = (items: DupeItem[]) =>
  [...items].sort((a, b) => weight(b) - weight(a) || a.created_at - b.created_at)[0];
const clip = (s: string | null | undefined, n = 70) => {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const shortDate = (ts: number) =>
  new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const extraCopies = (groups: DupeGroup[]) => groups.reduce((n, g) => n + g.count - 1, 0);

export default function Questions() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [formChapters, setFormChapters] = useState<any[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  // null = the duplicate panel is closed; [] = scanned and nothing is repeated.
  const [dupeGroups, setDupeGroups] = useState<DupeGroup[] | null>(null);
  const [dupeLoading, setDupeLoading] = useState(false);
  const [dupeKeep, setDupeKeep] = useState<Record<string, string>>({});
  const [dupeBusy, setDupeBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;
  const toast = useToast();
  const importRef = useRef<HTMLInputElement>(null);

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Accept both a single batch object ({ questions: [...] }) and an array of
      // batches ([{ subject_slug, chapter_title, questions: [...] }, ...]).
      const batches: any[] = Array.isArray(parsed) ? parsed : [parsed];
      if (batches.length === 0 || batches.some((b) => !Array.isArray(b?.questions) || b.questions.length === 0)) {
        await alertDialog({ title: "Import failed", message: "The file must contain at least one question (a \"questions\" array)." });
        return;
      }
      let imported = 0, skipped = 0, failed = 0;
      const allErrors: any[] = [];
      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        try {
          const { data } = await api.post("/questions/bulk-import", batch);
          imported += data.imported ?? 0;
          skipped += data.skipped ?? 0;
          failed += data.failed ?? 0;
          if (Array.isArray(data.errors)) allErrors.push(...data.errors);
        } catch (e: any) {
          // A whole batch failed (e.g. bad subject slug) — record and continue.
          failed += (batch.questions || []).length;
          allErrors.push({ index: bi, error: e?.response?.data?.error || e?.message || "batch failed" });
        }
      }
      const failed2 = failed;
      let msg = `Import complete: imported ${imported}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}, failed ${failed2}`;
      if (failed2 > 0 && allErrors.length) {
        const details = allErrors.slice(0, 8).map((e: any) => `• batch/row ${ (e.index ?? "?") + 1 }: ${e.error}`).join("\n");
        msg += `\n\n${details}` + (allErrors.length > 8 ? `\n…and ${allErrors.length - 8} more` : "");
      }
      await alertDialog({ title: "Import result", message: msg });
      loadQuestions();
      if (dupeGroups !== null) scanDuplicates();
    } catch (e: any) {
      await alertDialog({
        title: "Import failed",
        message: errorMessage(e, "The file could not be imported."),
      });
    }
  };

  useEffect(() => { api.get("/subjects").then(r => setSubjects(r.data.subjects)); }, []);

  // Dashboard quick action lands on /questions?new=1 — open the create form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setShowForm(true);
    }
  }, []);
  useEffect(() => {
    setSelectedChapter("");
    if (selectedSubject) api.get(`/subjects/${selectedSubject}/chapters`).then(r => setChapters(r.data.chapters));
    else setChapters([]);
  }, [selectedSubject]);
  useEffect(() => {
    if (form.subject_id) api.get(`/subjects/${form.subject_id}/chapters`).then(r => setFormChapters(r.data.chapters));
    else setFormChapters([]);
  }, [form.subject_id]);
  const loadQuestions = async () => {
    const params = new URLSearchParams();
    if (selectedSubject) params.set("subject_id", selectedSubject);
    if (selectedChapter) params.set("chapter_id", selectedChapter);
    if (filterType) params.set("type", filterType);
    if (filterDifficulty) params.set("difficulty", filterDifficulty);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    params.set("pageSize", String(PAGE_SIZE));
    params.set("page", String(page));
    const { data } = await api.get(`/questions?${params.toString()}`);
    setQuestions(data.questions);
    setTotal(data.total ?? data.questions.length);
    setSelected([]);
    // If the current page is now empty (e.g. after a delete), step back.
    if ((data.questions?.length ?? 0) === 0 && page > 1) setPage((p) => p - 1);
  };
  useEffect(() => { setPage(1); }, [selectedSubject, selectedChapter, filterType, filterDifficulty, searchQuery]);
  useEffect(() => { loadQuestions(); }, [selectedSubject, selectedChapter, filterType, filterDifficulty, searchQuery, page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showForm) reset();
      else if (dupeGroups !== null) setDupeGroups(null);
      else if (selected.length) setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm, dupeGroups, selected.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showForm) reset();
      else if (dupeGroups !== null) setDupeGroups(null);
      else if (selected.length) setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm, dupeGroups, selected.length]);

  const reset = () => { setForm(empty); setEditing(null); setShowForm(false); };

  const undoImport = async () => {
    if (!lastBatchId) return;
    const ok = await confirmDialog({
      title: "Undo the last import?",
      message: "Every question from that import gets deleted.",
      confirmLabel: "Undo import",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await api.delete(`/questions/imports/${lastBatchId}`);
      await alertDialog({ title: "Import undone", message: `Deleted ${data.deleted} questions.` });
      setLastBatchId(null);
      loadQuestions();
    } catch (e: any) {
      await alertDialog({
        title: "Could not undo",
        message: errorMessage(e, "The import could not be undone."),
      });
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    if (payload.type === "mcq") payload.options = payload.options.filter((o: string) => o.trim() !== "");
    else payload.options = undefined;
    try {
      if (editing) await api.put(`/questions/${editing}`, payload);
      else await api.post("/questions", payload);
    } catch (err: any) {
      const res = err?.response;
      // 409 = the same question is already stored, so ask before adding a copy.
      const found: DupeItem[] = res?.status === 409 ? res.data?.duplicates || [] : [];
      if (editing || found.length === 0) {
        await alertDialog({
          title: editing ? "Could not update" : "Could not save",
          message: res?.data?.error || err?.message || "The question was not saved.",
        });
        return;
      }
      const lines = found
        .slice(0, 5)
        .map((d) => `• ${[d.chapter_title && `Ch.${d.chapter_number} ${d.chapter_title}`, d.type?.toUpperCase(), d.answer && `answer: ${clip(d.answer, 40)}`].filter(Boolean).join(" · ") || "no chapter"}`)
        .join("\n");
      const ok = await confirmDialog({
        title: `Already in the bank (${found.length})`,
        message:
          `${res.data?.message || "An identical question is already in this subject."}\n\n${lines}` +
          (found.length > 5 ? `\n…and ${found.length - 5} more` : "") +
          (res.data?.answerDiffers ? "\n\nHeads up: the stored copy has a different answer or choices." : "") +
          "\n\nAdd your question anyway?",
        confirmLabel: "Add anyway",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      try {
        await api.post("/questions", { ...payload, force: true });
      } catch (e2: any) {
        await alertDialog({
          title: "Could not save",
          message: errorMessage(e2, "The question was not saved."),
        });
        return;
      }
    }
    reset();
    loadQuestions();
    if (dupeGroups !== null) scanDuplicates();
  };

  const edit = (q: any) => {
    setForm({
      subject_id: q.subject_id, chapter_id: q.chapter_id || "",
      type: q.type, difficulty: q.difficulty, prompt: q.prompt,
      options: q.options || ["", "", "", ""], answer: q.answer || "",
      explanation: q.explanation || "", marks: q.marks,
    });
    setEditing(q.id); setShowForm(true);
  };

  const del = async (q: any) => {
    const ok = await confirmDialog({
      title: "Delete this question?",
      message: "This can't be undone.",
      confirmLabel: "Delete question",
      tone: "danger",
    });
    if (!ok) return;
    const snapshot = {
      subject_id: q.subject_id,
      chapter_id: q.chapter_id || undefined,
      type: q.type,
      difficulty: q.difficulty,
      prompt: q.prompt,
      options: Array.isArray(q.options) ? q.options : (q.options ? JSON.parse(q.options) : undefined),
      answer: q.answer || undefined,
      explanation: q.explanation || undefined,
      marks: q.marks,
    };
    await api.delete(`/questions/${q.id}`);
    loadQuestions();
    toast.success("Question deleted.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            await api.post("/questions", snapshot);
            toast.success("Question restored.");
            loadQuestions();
          } catch (e: any) {
            await alertDialog({ title: "Could not restore", message: errorMessage(e, "The question was not restored.") });
          }
        },
      },
    });
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAll = () => setSelected(questions.map((q) => q.id));
  const clearSelection = () => setSelected([]);

  const deleteSelected = async () => {
    if (selected.length === 0) return;
    const ok = await confirmDialog({
      title: `Delete ${selected.length} question${selected.length > 1 ? "s" : ""}?`,
      message: "This can't be undone.",
      confirmLabel: "Delete selected",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await api.post("/questions/bulk-delete", { ids: selected });
      toast.success(`Deleted ${data.deleted ?? selected.length} questions.`);
      setSelected([]);
      loadQuestions();
      if (dupeGroups !== null) scanDuplicates();
    } catch (e: any) {
      await alertDialog({ title: "Could not delete", message: errorMessage(e, "Nothing was deleted.") });
    }
  };

  const scanDuplicates = async () => {
    // Open the panel straight away on the first scan; a rescan keeps the old
    // groups on screen until the fresh ones arrive.
    setDupeGroups((prev) => prev ?? []);
    setDupeLoading(true);
    try {
      const { data } = await api.get("/questions/duplicates");
      const groups: DupeGroup[] = data.groups || [];
      const keep: Record<string, string> = {};
      groups.forEach((g) => { keep[g.key] = richest(g.items).id; });
      setDupeKeep(keep);
      setDupeGroups(groups);
    } catch (e: any) {
      await alertDialog({
        title: "Could not scan",
        message: errorMessage(e, "The duplicate scan failed."),
      });
    } finally {
      setDupeLoading(false);
    }
  };

  const deleteDuplicates = async () => {
    if (!dupeGroups) return;
    const ids = dupeGroups.flatMap((g) => g.items.filter((i) => i.id !== dupeKeep[g.key]).map((i) => i.id));
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: `Delete ${ids.length} duplicate question${ids.length > 1 ? "s" : ""}?`,
      message: "The ticked question in each group stays. This can't be undone.",
      confirmLabel: "Delete duplicates",
      tone: "danger",
    });
    if (!ok) return;
    setDupeBusy(true);
    try {
      const { data } = await api.post("/questions/bulk-delete", { ids });
      toast.success(`Deleted ${data.deleted ?? ids.length} questions.`);
      await loadQuestions();
      await scanDuplicates();
    } catch (e: any) {
      await alertDialog({
        title: "Could not delete",
        message: errorMessage(e, "Nothing was deleted."),
      });
    } finally {
      setDupeBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Question Bank</h1>
        <div className="flex gap-2">
          <input ref={importRef} type="file" accept="application/json,.json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
          <Button variant="ghost" onClick={() => importRef.current?.click()}><Upload size={16}/> Import JSON</Button>
          {lastBatchId && <Button variant="ghost" onClick={undoImport}>Undo Last Import</Button>}
          <Button
            variant="ghost"
            onClick={() => (dupeGroups === null ? scanDuplicates() : setDupeGroups(null))}
          >
            <CopyCheck size={16} /> Duplicates
          </Button>
          {selected.length > 0 && (
            <Button variant="danger" onClick={deleteSelected}>
              <Trash2 size={16} /> Delete selected ({selected.length})
            </Button>
          )}
          <Button onClick={() => { reset(); setShowForm(true); }}><Plus size={16}/> New Question</Button>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Subject">
            <Select value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)}>
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Chapter">
            <Select value={selectedChapter} onChange={e => setSelectedChapter(e.target.value)} disabled={!selectedSubject}>
              <option value="">All chapters</option>
              {chapters.map(c => <option key={c.id} value={c.id}>Ch.{c.number} {c.title}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">All types</option>
              <option value="mcq">MCQ</option>
              <option value="short">Short</option>
              <option value="long">Long</option>
            </Select>
          </Field>
          <Field label="Difficulty">
            <Select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value)}>
              <option value="">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
          <Field label="Search">
            <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="prompt text..." />
          </Field>
          <Button variant="ghost" onClick={() => { setSelectedSubject(""); setSelectedChapter(""); setFilterType(""); setFilterDifficulty(""); setSearchQuery(""); }}>Clear</Button>
        </div>
      </Card>

      {dupeGroups !== null && (
        <Card hover={false}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Duplicate questions</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {dupeLoading
                  ? "Scanning the question bank…"
                  : dupeGroups.length === 0
                    ? "Nothing repeated — every question appears once."
                    : `${dupeGroups.length} group${dupeGroups.length > 1 ? "s" : ""} · ${extraCopies(dupeGroups)} extra cop${extraCopies(dupeGroups) === 1 ? "y" : "ies"} to remove`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={scanDuplicates} disabled={dupeLoading}>Rescan</Button>
              <Button variant="ghost" onClick={() => setDupeGroups(null)}>Close</Button>
            </div>
          </div>

          {dupeLoading && dupeGroups.length === 0 && (
            <div className="mt-4 space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          )}

          {!dupeLoading && dupeGroups.length === 0 && (
            <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              No duplicates found — nothing to clean up.
            </div>
          )}

          {!dupeLoading && dupeGroups.length > 0 && (
            <>
              <div className="mt-5 space-y-4">
                {dupeGroups.map((g) => (
                  <div key={g.key} className="rounded-2xl border border-slate-600/60 bg-slate-900/40 p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">{g.subject_name || "Unknown subject"}</span>
                      <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-300">{g.count} copies</Badge>
                      {g.answerDiffers && (
                        <Badge className="border-rose-500/30 bg-rose-500/20 text-rose-300">answers differ — check before deleting</Badge>
                      )}
                      <span className="ml-auto text-xs text-slate-500">the ticked one is kept</span>
                    </div>
                    <div className="space-y-2">
                      {g.items.map((it) => (
                        <label
                          key={it.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition",
                            dupeKeep[g.key] === it.id
                              ? "border-violet-400/60 bg-violet-500/10"
                              : "border-slate-600/40 hover:border-violet-400/40",
                          )}
                        >
                          <input
                            type="radio"
                            className="mt-0.5"
                            name={`dupe-${g.key}`}
                            checked={dupeKeep[g.key] === it.id}
                            onChange={() => setDupeKeep((k) => ({ ...k, [g.key]: it.id }))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-slate-100">{it.prompt}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                              <span>{it.type.toUpperCase()}</span>
                              <span>· {it.difficulty}</span>
                              {it.chapter_title && <span>· Ch.{it.chapter_number} {it.chapter_title}</span>}
                              <span>· {it.marks} mark(s)</span>
                              <span>· added {shortDate(it.created_at)}</span>
                            </div>
                            {it.answer && <div className="mt-1 text-xs text-emerald-400">Answer: {clip(it.answer, 80)}</div>}
                            {it.explanation && <div className="mt-0.5 text-xs text-slate-500">Explanation: {clip(it.explanation, 80)}</div>}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={deleteDuplicates} disabled={dupeBusy}>
                  <Trash2 size={16} /> Delete {extraCopies(dupeGroups)} duplicate{extraCopies(dupeGroups) === 1 ? "" : "s"}
                </Button>
                <span className="text-xs text-slate-500">
                  One copy per group stays — the ticked one, which holds the most detail by default.
                </span>
              </div>
            </>
          )}
        </Card>
      )}

      {showForm && (
        <Card>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Subject">
                <Select value={form.subject_id} onChange={e => setForm({ ...form, subject_id: e.target.value })} required>
                  <option value="">Select subject</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Chapter">
                <Select value={form.chapter_id} onChange={e => setForm({ ...form, chapter_id: e.target.value })}>
                  <option value="">No chapter / all</option>
                  {formChapters.map(c => <option key={c.id} value={c.id}>Ch.{c.number} {c.title}</option>)}
                </Select>
              </Field>
              <Field label="Type">
                <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="mcq">MCQ</option>
                  <option value="short">Short</option>
                  <option value="long">Long</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Difficulty">
                <Select value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>
              <Field label="Marks"><NumberInput value={form.marks} onChange={e=>setForm({...form,marks:Number(e.target.value)})} /></Field>
            </div>
            <Field label="Question prompt"><Textarea rows={3} value={form.prompt} onChange={e=>setForm({...form,prompt:e.target.value})} required /></Field>
            {form.type === "mcq" && (
              <div className="space-y-2">
                <div className="text-xs text-slate-300">Options (select correct answer below)</div>
                {form.options.map((o: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <Input value={o} onChange={e => { const opts=[...form.options]; opts[i]=e.target.value; setForm({...form,options:opts}); }} placeholder={`Option ${i+1}`} />
                  </div>
                ))}
                <Field label="Correct Answer (must match an option exactly)">
                  <Input value={form.answer} onChange={e=>setForm({...form,answer:e.target.value})} placeholder="Type correct option text" />
                </Field>
              </div>
            )}
            {form.type !== "mcq" && (
              <Field label="Model Answer / Key Points"><Textarea rows={3} value={form.answer} onChange={e=>setForm({...form,answer:e.target.value})} /></Field>
            )}
            <Field label="Explanation (optional)"><Textarea rows={2} value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})} /></Field>
            <div className="flex gap-2">
              <Button type="submit">{editing ? "Update" : "Save"} Question</Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {questions.length > 0 && (
          <div className="flex items-center gap-3 px-1 text-xs text-slate-400">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.length === questions.length && questions.length > 0}
                onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
              />
              Select all ({questions.length})
            </label>
            {selected.length > 0 && (
              <button className="text-slate-400 hover:text-slate-200 underline" onClick={clearSelection}>
                Clear selection
              </button>
            )}
          </div>
        )}
        {questions.map(q => {
          const sub = subjects.find(s => s.id === q.subject_id);
          const checked = selected.includes(q.id);
          return (
            <Card key={q.id} className={cn("p-4 transition", checked && "ring-1 ring-violet-400/50")}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1.5 shrink-0"
                  checked={checked}
                  onChange={() => toggleSelect(q.id)}
                  aria-label="Select question"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge>{q.type.toUpperCase()}</Badge>
                        <Badge className="bg-slate-700/40 text-slate-300 border-slate-600">{q.difficulty}</Badge>
                        <span className="text-xs text-slate-500">{sub?.name} · {q.marks} mark(s)</span>
                      </div>
                      <div className="text-sm">{q.prompt}</div>
                      {q.options && (
                        <ul className="text-xs text-slate-400 mt-2 space-y-0.5 ml-4">
                          {(Array.isArray(q.options)?q.options:JSON.parse(q.options)).map((o: string, i: number) => <li key={i}>{optionLabel(q.prompt, i)}. {o} {q.answer === o && <span className="text-emerald-400">(correct)</span>}</li>)}
                        </ul>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" onClick={() => edit(q)}>Edit</Button>
                      <Button variant="ghost" onClick={() => del(q)}><Trash2 size={14}/></Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {questions.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-12 gap-3 rounded-2xl border border-dashed border-slate-600/60 bg-slate-900/30">
            <div className="rounded-2xl bg-ink/5 p-3">
              <Plus size={22} className="text-slate-400" />
            </div>
            <div className="text-sm font-medium text-slate-200">No questions yet</div>
            <p className="text-xs text-slate-400 max-w-xs">
              {searchQuery || selectedSubject || selectedChapter || filterType || filterDifficulty
                ? "Nothing matches these filters. Try clearing them."
                : "Add your first question, or import a JSON file."}
            </p>
            <div className="flex gap-2 mt-1">
              <Button onClick={() => { reset(); setShowForm(true); }}><Plus size={16} /> New Question</Button>
              <Button variant="ghost" onClick={() => importRef.current?.click()}><Upload size={16} /> Import JSON</Button>
            </div>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-xs text-slate-400">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <span className="grid place-items-center px-2 text-xs text-slate-300">Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
            <Button variant="ghost" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}