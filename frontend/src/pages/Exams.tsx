import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Card, Button, Input, NumberInput, Field, Select, Badge, cn } from "../components/ui";
import { confirmDialog, alertDialog, choiceDialog } from "../components/Dialog";
import {
  Plus, Trash2, PlayCircle, Shuffle, X, Wand2, Printer, ArrowUp, ArrowDown, GripVertical,
  FileText, Pencil, ClipboardList, BookOpen, Settings2, ListChecks, Check, Clock, Trophy, Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const emptyForm = {
  title: "",
  subjectIds: [] as string[],
  duration_minutes: 30,
  question_ids: [] as string[],
  shuffle_questions: false,
  shuffle_options: false,
};

/** One numbered block of the exam builder. Keeps the long form scannable. */
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

/** Checkbox rendered as a selectable pill instead of a bare box. */
function TogglePill({ checked, onChange, children }: {
  checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <label className={cn(
      "inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
      checked ? "border-indigo-500/60 bg-indigo-500/10 text-slate-100" : "border-slate-600/50 text-slate-300 hover:border-slate-500 hover:bg-ink/5"
    )}>
      <input type="checkbox" className="h-4 w-4 accent-indigo-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/** Small stat chip used in the sticky summary bar. */
function StatChip({ icon: Icon, tone = "text-indigo-300", children }: {
  icon: any; tone?: string; children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1 text-xs text-slate-300">
      <Icon size={13} className={tone} /> <span className="tabular-nums">{children}</span>
    </span>
  );
}

export default function Exams() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [availableQs, setAvailableQs] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [qQuery, setQQuery] = useState("");
  const [qType, setQType] = useState("");
  const [qDifficulty, setQDifficulty] = useState("");
  const [qChapter, setQChapter] = useState("");
  const [autoCount, setAutoCount] = useState(5);
  const [autoMode, setAutoMode] = useState<"random" | "first">("random");
  const [blueprint, setBlueprint] = useState({ mcq: 0, short: 0, long: 0, difficulty: "" as "" | "easy" | "medium" | "hard" });
  const [typeMarks, setTypeMarks] = useState({ mcq: 1, short: 5, long: 10 });
  const [subjectTimes, setSubjectTimes] = useState<Record<string, number>>({});
  const [qPage, setQPage] = useState(1);
  // Search + filters for the exam list below.
  const [examQuery, setExamQuery] = useState("");
  const [examStatus, setExamStatus] = useState("");
  const [examSubject, setExamSubject] = useState("");
  const [examSort, setExamSort] = useState("newest");
  const dragIndex = useRef<number | null>(null);
  const publishAfter = useRef(false);
  const PAGE_SIZE = 40;

  const subjectKey = form.subjectIds.join(",");

  const load = async () => {
    const { data } = await api.get("/exams");
    setExams(data.exams || []);
  };
  useEffect(() => { load(); api.get("/subjects").then(r => setSubjects(r.data.subjects || [])); }, []);

  // Dashboard quick action lands on /exams?new=1 — open the create form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setShowForm(true);
    }
  }, []);

  useEffect(() => {
    if (form.subjectIds.length) {
      api.get(`/questions?subject_ids=${subjectKey}`).then(r => setAvailableQs(r.data.questions || []));
      Promise.all(
        form.subjectIds.map((id) =>
          api.get(`/subjects/${id}/chapters`).then(r => (r.data.chapters || []).map((c: any) => ({ ...c, subject_id: id }))).catch(() => [])
        )
      ).then((lists) => setChapters(lists.flat()));
    } else {
      setAvailableQs([]);
      setChapters([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  const toggleSubject = (id: string) => {
    setForm((f) => ({
      ...f,
      subjectIds: f.subjectIds.includes(id) ? f.subjectIds.filter((x) => x !== id) : [...f.subjectIds, id],
    }));
  };

  const toggleQ = (id: string) => {
    setForm((f) => ({
      ...f,
      question_ids: f.question_ids.includes(id) ? f.question_ids.filter((x) => x !== id) : [...f.question_ids, id],
    }));
  };

  const moveSelected = (from: number, to: number) => {
    setForm((f) => {
      const arr = [...f.question_ids];
      if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return f;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return { ...f, question_ids: arr };
    });
  };

  useEffect(() => { setQPage(1); }, [qQuery, qType, qDifficulty, qChapter, subjectKey]);

  const filteredQs = availableQs.filter((q: any) => {
    if (qType && q.type !== qType) return false;
    if (qDifficulty && (q.difficulty || "medium") !== qDifficulty) return false;
    if (qChapter && q.chapter_id !== qChapter) return false;
    const terms = qQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = `${q.prompt || ""} ${q.type || ""} ${q.difficulty || ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  const selectFiltered = () => {
    setForm((f) => ({
      ...f,
      question_ids: Array.from(new Set([...f.question_ids, ...filteredQs.map((q: any) => q.id)])),
    }));
  };

  const clearSelection = () => setForm((f) => ({ ...f, question_ids: [] }));

  const autoSelect = () => {
    const pool = filteredQs.filter((q: any) => !form.question_ids.includes(q.id));
    const n = Math.max(0, Math.min(autoCount, pool.length));
    const picked = autoMode === "random" ? shuffleArray(pool).slice(0, n) : pool.slice(0, n);
    setForm((f) => ({
      ...f,
      question_ids: Array.from(new Set([...f.question_ids, ...picked.map((q: any) => q.id)])),
    }));
  };

  const generateByBlueprint = () => {
    const counts: Record<string, number> = { mcq: blueprint.mcq, short: blueprint.short, long: blueprint.long };
    const picked: string[] = [];
    for (const type of ["mcq", "short", "long"]) {
      const want = Math.max(0, counts[type] || 0);
      if (!want) continue;
      let pool = availableQs.filter((q: any) => q.type === type && !form.question_ids.includes(q.id) && !picked.includes(q.id));
      if (blueprint.difficulty) pool = pool.filter((q: any) => (q.difficulty || "medium") === blueprint.difficulty);
      if (qChapter) pool = pool.filter((q: any) => q.chapter_id === qChapter);
      picked.push(...shuffleArray(pool).slice(0, want).map((q: any) => q.id));
    }
    setForm((f) => ({ ...f, question_ids: Array.from(new Set([...f.question_ids, ...picked])) }));
  };

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name || "Subject";
  const chapterLabel = (c: any) => `Ch.${c.number} ${c.title}${form.subjectIds.length > 1 ? ` (${subjectName(c.subject_id)})` : ""}`;

  const selectedQs = useMemo(
    () => form.question_ids.map((id) => availableQs.find((q: any) => q.id === id)).filter(Boolean),
    [form.question_ids, availableQs]
  );
  const selectedMarks = selectedQs.reduce((s: number, q: any) => s + (q.marks || 1), 0);
  const marksByType = useMemo(() => {
    const out: Record<string, { count: number; marks: number }> = { mcq: { count: 0, marks: 0 }, short: { count: 0, marks: 0 }, long: { count: 0, marks: 0 } };
    for (const q of selectedQs as any[]) {
      if (!out[q.type]) out[q.type] = { count: 0, marks: 0 };
      out[q.type].count += 1;
      out[q.type].marks += q.marks || 1;
    }
    return out;
  }, [selectedQs]);

  const subjectTimesSum = form.subjectIds.reduce((s, id) => s + (subjectTimes[id] || 0), 0);
  const anySubjectTimes = form.subjectIds.some((id) => (subjectTimes[id] || 0) > 0);
  const effectiveDuration = anySubjectTimes ? subjectTimesSum : (form.duration_minutes || 0);
  const typeKeyOrder = ["mcq", "short", "long"] as const;

  // What still blocks the create button — shown beside it, not only after a failed submit.
  const issues: string[] = [];
  if (!form.title.trim()) issues.push("a title");
  if (!form.subjectIds.length) issues.push("a subject");
  if (!form.question_ids.length) issues.push("at least one question");

  // Rough reading time for the picked paper: 1 min per MCQ, 3 per short, 6 per long.
  const suggestedDuration = form.question_ids.length
    ? Math.max(5, marksByType.mcq.count * 1 + marksByType.short.count * 3 + marksByType.long.count * 6)
    : null;

  const applyTypeMarks = async () => {
    const groups: Record<string, string[]> = { mcq: [], short: [], long: [] };
    for (const q of selectedQs as any[]) if (groups[q.type]) groups[q.type].push(q.id);
    const jobs = (["mcq", "short", "long"] as const)
      .filter((t) => groups[t].length)
      .map((t) => ({ type: t, ids: groups[t], marks: typeMarks[t] }));
    if (!jobs.length) return;
    const summary = jobs.map((j) => `${j.type.toUpperCase()}: ${j.ids.length} × ${j.marks}`).join("\n");
    const ok = await confirmDialog({
      title: "Update the shared question bank?",
      message: `${summary}\n\nThese questions are shared, so the new marks will apply everywhere they are used.`,
      confirmLabel: "Update marks",
      tone: "danger",
    });
    if (!ok) return;
    await Promise.all(jobs.map((j) => api.post("/questions/bulk-update", { ids: j.ids, patch: { marks: j.marks } })));
    const { data } = await api.get(`/questions?subject_ids=${subjectKey}`);
    setAvailableQs(data.questions || []);
  };

  const autoSplitTime = () => {
    const ids = form.subjectIds;
    if (!ids.length) return;
    const base = Math.max(1, Math.floor((form.duration_minutes || 30) / ids.length));
    const t: Record<string, number> = {};
    ids.forEach((id) => { t[id] = base; });
    t[ids[ids.length - 1]] = Math.max(1, t[ids[ids.length - 1]] + ((form.duration_minutes || 30) - base * ids.length));
    setSubjectTimes(t);
    setForm((f) => ({ ...f, duration_minutes: ids.reduce((s, id) => s + t[id], 0) }));
  };

  const totalPages = Math.max(1, Math.ceil(filteredQs.length / PAGE_SIZE));
  const safePage = Math.min(qPage, totalPages);
  const pageQs = filteredQs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setBlueprint({ mcq: 0, short: 0, long: 0, difficulty: "" });
    setSubjectTimes({});
    setQQuery(""); setQType(""); setQDifficulty(""); setQChapter("");
  };

  const startEdit = (e: any) => {
    const subjIds: string[] = Array.isArray(e.subject_ids) && e.subject_ids.length ? e.subject_ids : [e.subject_id].filter(Boolean);
    // Only carry over per-subject times the exam actually has. Inventing a split
    // here would silently override the duration set in step 1.
    const existingTimes: Record<string, number> = {};
    for (const t of (e.subject_times || [])) existingTimes[t.subject_id] = t.minutes;
    const t: Record<string, number> = {};
    subjIds.forEach((id) => { t[id] = existingTimes[id] ?? 0; });
    setForm({
      title: e.title || "",
      subjectIds: subjIds,
      duration_minutes: e.duration_minutes || 30,
      question_ids: Array.isArray(e.question_ids) ? [...e.question_ids] : [],
      shuffle_questions: !!e.shuffle_questions,
      shuffle_options: !!e.shuffle_options,
    });
    setSubjectTimes(t);
    setBlueprint({ mcq: 0, short: 0, long: 0, difficulty: "" });
    setEditingId(e.id);
    setShowForm(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) {
      await alertDialog({ title: "Almost there", message: `This paper still needs ${issues.join(", ")}.` });
      return;
    }
    const times = form.subjectIds.map((id) => ({ subject_id: id, minutes: subjectTimes[id] ?? 0 }));
    const anyTimes = times.some((t) => t.minutes > 0);
    const payload = {
      title: form.title,
      subject_id: form.subjectIds[0],
      subject_ids: form.subjectIds,
      subject_times: anyTimes ? times : [],
      question_ids: form.question_ids,
      duration_minutes: anyTimes ? times.reduce((s, t) => s + t.minutes, 0) : form.duration_minutes,
      shuffle_questions: form.shuffle_questions,
      shuffle_options: form.shuffle_options,
    };
    const wasEditing = editingId;
    let savedId: string | null = editingId;
    if (editingId) await api.put(`/exams/${editingId}`, payload);
    else {
      const { data } = await api.post("/exams", payload);
      savedId = data?.exam?.id ?? null;
    }
    const wantedPublish = publishAfter.current;
    publishAfter.current = false;
    if (wantedPublish && savedId) await api.put(`/exams/${savedId}/publish`);
    resetForm();
    setShowForm(false);
    await load();
    if (wasEditing) {
      await alertDialog({ title: "Changes saved", message: `“${payload.title}” has been updated.` });
      return;
    }
    // Don't just drop the teacher back on the list — offer the obvious next steps.
    const next = await choiceDialog({
      title: wantedPublish ? "Exam published" : "Exam created",
      message: wantedPublish
        ? `“${payload.title}” is live — students can start it now. Print a paper copy if the class needs one.`
        : `“${payload.title}” is saved as a draft. Students can't see it until it is published.`,
      actions: wantedPublish
        ? [
            { label: "Print paper", value: "print", variant: "primary" },
            { label: "Done", value: "done", variant: "ghost", safe: true },
          ]
        : [
            { label: "Publish & print", value: "publish-print", variant: "primary" },
            { label: "Publish now", value: "publish" },
            { label: "Keep as draft", value: "draft", variant: "ghost", safe: true },
          ],
    });
    if (!savedId) return;
    if (next === "publish-print" || next === "publish") {
      await api.put(`/exams/${savedId}/publish`);
      await load();
    }
    if (next === "publish-print" || next === "print") nav(`/print?exam=${savedId}`);
  };

  const publish = async (id: string, val: boolean) => {
    await api.put(`/exams/${id}/${val ? "publish" : "unpublish"}`);
    load();
  };
  const del = async (id: string) => {
    const ok = await confirmDialog({
      title: "Delete this exam?",
      message: "The paper and its schedule go away. The questions themselves stay in the question bank.",
      confirmLabel: "Delete exam",
      tone: "danger",
    });
    if (!ok) return;
    await api.delete(`/exams/${id}`); load();
  };

  const start = async (id: string) => {
    const { data } = await api.post(`/exams/${id}/start`);
    nav(`/take-exam/${data.attempt.id}`);
  };

  const isTeacher = user?.role === "admin" || user?.role === "teacher";
  const examSubjectIds = (e: any): string[] =>
    Array.isArray(e.subject_ids) && e.subject_ids.length ? e.subject_ids : [e.subject_id].filter(Boolean);
  const examSubjectNames = (e: any) => examSubjectIds(e).map(subjectName).join(" + ");

  // Narrow the shelf as it grows — every card is matched on title + subject
  // names, then put in the chosen order.
  const examTerms = examQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const examTotal = exams.filter((e: any) => isTeacher || e.is_published).length;
  const filtersActive = examTerms.length > 0 || !!examStatus || !!examSubject || examSort !== "newest";

  const visibleExams = useMemo(() => {
    const out = exams.filter((e: any) => {
      if (!isTeacher && !e.is_published) return false;
      if (examStatus === "published" && !e.is_published) return false;
      if (examStatus === "draft" && e.is_published) return false;
      if (examSubject && !examSubjectIds(e).includes(examSubject)) return false;
      if (examTerms.length) {
        const hay = `${e.title || ""} ${examSubjectNames(e)}`.toLowerCase();
        if (!examTerms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    if (examSort === "oldest") out.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    else if (examSort === "title") out.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (examSort === "marks") out.sort((a, b) => (b.total_marks || 0) - (a.total_marks || 0));
    else out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams, examQuery, examStatus, examSubject, examSort, subjects, isTeacher]);

  const clearExamFilters = () => {
    setExamQuery(""); setExamStatus(""); setExamSubject(""); setExamSort("newest");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Exams</h1>
        {isTeacher && <Button onClick={() => { resetForm(); setShowForm(true); }}><Plus size={16}/> New Exam</Button>}
      </div>

      {showForm && (
        <Card hover={false} className="overflow-hidden p-0">
          {/* Panel header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-600/40 bg-ink/5 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white shadow-lg shadow-indigo-500/25">
                <ClipboardList size={20} className="card-icon" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">{editingId ? "Edit exam" : "Create a new exam"}</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {editingId
                    ? "Update the paper details, subjects and question order."
                    : "Name the paper, choose its subjects, then build it from your question bank."}
                </p>
              </div>
            </div>
            <button
              type="button"
              title="Close"
              onClick={() => { resetForm(); setShowForm(false); }}
              className="shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-ink/10 hover:text-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={save} className="space-y-5 p-5 sm:p-6">
            {/* 1 — Paper details */}
            <FormSection step={1} done={!!form.title.trim()} icon={Settings2} title="Paper details" hint="A clear title and a realistic time limit.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label="Exam title">
                    <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Class 8 — Half-yearly Model Test" required />
                  </Field>
                </div>
                <Field label="Duration (minutes)">
                  <NumberInput min={1} value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
                  {suggestedDuration != null && !anySubjectTimes && suggestedDuration !== form.duration_minutes && (
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, duration_minutes: suggestedDuration }))}
                      className="mt-1.5 block text-left text-[11px] text-indigo-300 transition hover:text-indigo-200"
                    >
                      Suggested {suggestedDuration} min for this paper — use it
                    </button>
                  )}
                </Field>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <TogglePill checked={form.shuffle_questions} onChange={v => setForm({ ...form, shuffle_questions: v })}>Shuffle question order</TogglePill>
                <TogglePill checked={form.shuffle_options} onChange={v => setForm({ ...form, shuffle_options: v })}>Shuffle options</TogglePill>
              </div>
            </FormSection>

            {/* 2 — Subjects */}
            <FormSection
              step={2}
              done={form.subjectIds.length > 0}
              icon={BookOpen}
              title="Subjects"
              hint="Pick one or more subjects — questions are pulled from all of them."
              right={<Badge className="whitespace-nowrap">{form.subjectIds.length} selected</Badge>}
            >
              {subjects.length === 0 ? (
                <p className="text-xs text-slate-400">No subjects yet — add one from “Subjects &amp; Chapters” first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {subjects.map(s => {
                    const active = form.subjectIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSubject(s.id)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
                          active
                            ? "border-indigo-500/60 bg-indigo-500/15 text-slate-100 shadow-sm shadow-indigo-500/20"
                            : "border-slate-600/50 text-slate-300 hover:border-slate-500 hover:bg-ink/5"
                        )}
                      >
                        <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border transition", active ? "border-indigo-400 bg-indigo-500 text-white" : "border-slate-500")}>
                          {active && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="max-w-[12rem] truncate">{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {form.subjectIds.length > 0 && (
                <div className="mt-4 rounded-xl border border-slate-600/40 bg-ink/5 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <Clock size={13} className="text-indigo-300" /> Time per subject (minutes)
                    </span>
                    <div className="flex items-center gap-2">
                      {anySubjectTimes ? (
                        <span className={cn("text-xs tabular-nums", subjectTimesSum !== form.duration_minutes ? "text-amber-300" : "text-slate-400")}>
                          Total {subjectTimesSum} min{subjectTimesSum !== form.duration_minutes ? ` · paper will be ${subjectTimesSum} min` : ""}
                        </span>
                      ) : (
                        <span className="text-xs tabular-nums text-slate-500">Off — the paper uses the {form.duration_minutes} min above</span>
                      )}
                      <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={autoSplitTime}>Split evenly</Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {form.subjectIds.map(id => (
                      <Field key={id} label={subjectName(id)}>
                        <NumberInput min={0} value={subjectTimes[id] ?? 0}
                          onChange={e => setSubjectTimes(t => ({ ...t, [id]: Number(e.target.value) || 0 }))} />
                      </Field>
                    ))}
                  </div>
                </div>
              )}
            </FormSection>

            {/* 3 — Smart tools */}
            <FormSection step={3} icon={Wand2} title="Smart tools" hint="Optional shortcuts — fill the paper or set marks automatically.">
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-slate-600/40 bg-ink/5 p-3">
                  <div className="text-xs font-medium text-slate-300">Auto paper by counts</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label="MCQ"><NumberInput min={0} value={blueprint.mcq} onChange={e => setBlueprint({ ...blueprint, mcq: Number(e.target.value) || 0 })} /></Field>
                    <Field label="Short"><NumberInput min={0} value={blueprint.short} onChange={e => setBlueprint({ ...blueprint, short: Number(e.target.value) || 0 })} /></Field>
                    <Field label="Long"><NumberInput min={0} value={blueprint.long} onChange={e => setBlueprint({ ...blueprint, long: Number(e.target.value) || 0 })} /></Field>
                    <Field label="Difficulty">
                      <Select value={blueprint.difficulty} onChange={e => setBlueprint({ ...blueprint, difficulty: e.target.value as any })}>
                        <option value="">Any</option>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </Select>
                    </Field>
                  </div>
                  <Button type="button" variant="outline" onClick={generateByBlueprint}><Wand2 size={14} /> Generate paper</Button>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-600/40 bg-ink/5 p-3">
                  <div className="text-xs font-medium text-slate-300">Auto marks by type</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="MCQ"><NumberInput min={0} value={typeMarks.mcq} onChange={e => setTypeMarks({ ...typeMarks, mcq: Number(e.target.value) || 0 })} /></Field>
                    <Field label="Short"><NumberInput min={0} value={typeMarks.short} onChange={e => setTypeMarks({ ...typeMarks, short: Number(e.target.value) || 0 })} /></Field>
                    <Field label="Long"><NumberInput min={0} value={typeMarks.long} onChange={e => setTypeMarks({ ...typeMarks, long: Number(e.target.value) || 0 })} /></Field>
                  </div>
                  <Button type="button" variant="outline" onClick={applyTypeMarks} disabled={selectedQs.length === 0}>Apply to selected</Button>
                  <p className="text-[11px] text-slate-500">Updates the marks on the selected questions in the shared bank.</p>
                </div>
              </div>
            </FormSection>

            {/* 4 — Questions */}
            <FormSection
              step={4}
              done={form.question_ids.length > 0}
              icon={ListChecks}
              title="Questions"
              hint="Search the bank, tick the questions you want, then arrange their order."
              right={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="whitespace-nowrap">{form.question_ids.length} selected</Badge>
                  <Badge className="whitespace-nowrap border-cyan-500/30 bg-cyan-500/20 text-cyan-300">{selectedMarks} marks</Badge>
                </div>
              }
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="sm:col-span-2">
                  <Field label="Search (type, topic, keywords)">
                    <Input value={qQuery} onChange={e => setQQuery(e.target.value)} placeholder="e.g. mcq capital geography" />
                  </Field>
                </div>
                <Field label="Type">
                  <Select value={qType} onChange={e => setQType(e.target.value)}>
                    <option value="">All</option>
                    <option value="mcq">MCQ</option>
                    <option value="short">Short</option>
                    <option value="long">Long</option>
                  </Select>
                </Field>
                <Field label="Difficulty">
                  <Select value={qDifficulty} onChange={e => setQDifficulty(e.target.value)}>
                    <option value="">All</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </Select>
                </Field>
                <Field label="Chapter">
                  <Select value={qChapter} onChange={e => setQChapter(e.target.value)}>
                    <option value="">All</option>
                    {chapters.map((c: any) => <option key={c.id} value={c.id}>{chapterLabel(c)}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-slate-600/40 bg-ink/5 p-3">
                <Button type="button" variant="outline" onClick={selectFiltered}>Select filtered ({filteredQs.length})</Button>
                <Button type="button" variant="ghost" onClick={clearSelection} disabled={form.question_ids.length === 0}>Clear selection</Button>
                <span aria-hidden="true" className="hidden h-9 w-px self-end bg-slate-600/50 sm:block" />
                <div className="w-28">
                  <Field label="Auto count"><NumberInput min={1} value={autoCount} onChange={e => setAutoCount(Number(e.target.value) || 1)} /></Field>
                </div>
                <div className="w-40">
                  <Field label="Mode">
                    <Select value={autoMode} onChange={e => setAutoMode(e.target.value as any)}>
                      <option value="random">Random</option>
                      <option value="first">First available</option>
                    </Select>
                  </Field>
                </div>
                <Button type="button" variant="outline" onClick={autoSelect}>Auto-select</Button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-2 lg:col-span-2">
                  <div className="text-xs text-slate-400">Question bank · {filteredQs.length} match{filteredQs.length === 1 ? "" : "es"}</div>
                  <div className="max-h-80 space-y-1 overflow-auto rounded-xl border border-slate-600/40 p-1.5">
                    {pageQs.map(q => {
                      const picked = form.question_ids.includes(q.id);
                      const ch = chapters.find((c: any) => c.id === q.chapter_id);
                      const marks = q.marks || 1;
                      return (
                        <label key={q.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition", picked ? "bg-indigo-500/10" : "hover:bg-ink/5")}>
                          <input type="checkbox" className="h-4 w-4 shrink-0 accent-indigo-500" checked={picked} onChange={() => toggleQ(q.id)} />
                          <span className="flex-1 truncate">{q.prompt}</span>
                          {ch && (
                            <span className="max-w-28 shrink-0 truncate text-[11px] text-slate-500">
                              {form.subjectIds.length > 1 ? `${subjectName(ch.subject_id)} · ` : ""}Ch.{ch.number}
                            </span>
                          )}
                          <span className="shrink-0 text-[11px] tabular-nums text-cyan-300">{marks} mark{marks === 1 ? "" : "s"}</span>
                          <Badge className="shrink-0">{q.type}{q.difficulty ? ` · ${q.difficulty}` : ""}</Badge>
                        </label>
                      );
                    })}
                    {availableQs.length === 0 && <div className="p-2 text-xs text-slate-500">Select a subject with questions to see them here.</div>}
                    {availableQs.length > 0 && filteredQs.length === 0 && <div className="p-2 text-xs text-slate-500">No questions match your search or filters.</div>}
                  </div>
                  {availableQs.length > 0 && (
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <Button type="button" variant="ghost" disabled={safePage <= 1} onClick={() => setQPage(p => Math.max(1, p - 1))}>Prev</Button>
                      <span>Page {safePage} / {totalPages}</span>
                      <Button type="button" variant="ghost" disabled={safePage >= totalPages} onClick={() => setQPage(p => Math.min(totalPages, p + 1))}>Next</Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-slate-600/40 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300"><GripVertical size={14} className="text-indigo-300" /> Paper order</div>
                    <span className="text-xs text-slate-400 tabular-nums">{form.question_ids.length} items</span>
                  </div>
                  <p className="text-[11px] text-slate-500">Drag to reorder, or use ▲▼.</p>
                  <div className="max-h-64 space-y-1 overflow-auto">
                    {selectedQs.map((q: any, idx: number) => (
                      <div
                        key={q.id}
                        draggable
                        onDragStart={() => (dragIndex.current = idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { if (dragIndex.current != null) moveSelected(dragIndex.current, idx); dragIndex.current = null; }}
                        className="flex cursor-grab items-start gap-2 rounded-lg bg-ink/5 p-2 text-xs active:cursor-grabbing"
                      >
                        <GripVertical size={14} className="mt-0.5 shrink-0 text-slate-500" />
                        <span className="flex-1 line-clamp-2">{idx + 1}. {q.prompt}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveSelected(idx, idx - 1)}
                            disabled={idx === 0}
                            title="Move up"
                            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-600/50 text-slate-300 transition hover:border-indigo-400/60 hover:bg-indigo-500/10 hover:text-indigo-300 disabled:pointer-events-none disabled:opacity-40"
                          ><ArrowUp size={16} /></button>
                          <button
                            type="button"
                            onClick={() => moveSelected(idx, idx + 1)}
                            disabled={idx === selectedQs.length - 1}
                            title="Move down"
                            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-600/50 text-slate-300 transition hover:border-indigo-400/60 hover:bg-indigo-500/10 hover:text-indigo-300 disabled:pointer-events-none disabled:opacity-40"
                          ><ArrowDown size={16} /></button>
                          <button
                            type="button"
                            onClick={() => toggleQ(q.id)}
                            title="Remove"
                            className="grid h-7 w-7 place-items-center rounded-lg border border-slate-600/50 text-rose-300 transition hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-200"
                          ><X size={16} /></button>
                        </div>
                      </div>
                    ))}
                    {form.question_ids.length > 0 && selectedQs.length < form.question_ids.length && (
                      <div className="text-xs text-amber-300">{form.question_ids.length - selectedQs.length} selected question(s) from hidden subjects.</div>
                    )}
                    {form.question_ids.length === 0 && <div className="text-xs text-slate-500">No questions selected yet.</div>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-slate-600/40 pt-2">
                    {typeKeyOrder.map((k) => (
                      <div key={k} className="rounded-lg bg-ink/5 px-2 py-1.5 text-center">
                        <div className="text-[11px] font-medium text-slate-400">{k === "mcq" ? "MCQ" : k === "short" ? "Short" : "Long"}</div>
                        <div className="text-sm font-semibold tabular-nums">{marksByType[k].count}</div>
                        <div className="text-[10px] text-slate-500">{marksByType[k].marks} marks</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </FormSection>

            {/* Summary + actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-600/40 bg-ink/5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatChip icon={ListChecks}>{form.question_ids.length} questions</StatChip>
                <StatChip icon={Trophy} tone="text-cyan-300">{selectedMarks} marks</StatChip>
                <StatChip icon={Clock} tone="text-emerald-300">{effectiveDuration} min</StatChip>
                <StatChip icon={BookOpen}>{form.subjectIds.length} subject{form.subjectIds.length === 1 ? "" : "s"}</StatChip>
                {issues.length > 0 && <span className="text-xs text-rose-300">Still needed: {issues.join(" · ")}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
                {!editingId && (
                  <Button type="submit" variant="outline" disabled={issues.length > 0} onClick={() => { publishAfter.current = true; }}>
                    <Check size={14} /> Create &amp; publish
                  </Button>
                )}
                <Button type="submit" disabled={issues.length > 0} onClick={() => { publishAfter.current = false; }}>
                  {editingId ? <><Pencil size={14} /> Save changes</> : <><Shuffle size={14} /> Create Exam</>}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* Search + filters for the exam list */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Search exams">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input value={examQuery} onChange={e => setExamQuery(e.target.value)} placeholder="title or subject..." className="pl-9" />
              </div>
            </Field>
          </div>
          {isTeacher && (
            <Field label="Status">
              <Select value={examStatus} onChange={e => setExamStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </Select>
            </Field>
          )}
          <Field label="Subject">
            <Select value={examSubject} onChange={e => setExamSubject(e.target.value)}>
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Sort">
            <Select value={examSort} onChange={e => setExamSort(e.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="title">Title A–Z</option>
              <option value="marks">Most marks</option>
            </Select>
          </Field>
          {filtersActive && <Button variant="ghost" onClick={clearExamFilters}>Clear</Button>}
        </div>
        {filtersActive && (
          <div className="mt-3 border-t border-slate-600/40 pt-3 text-xs text-slate-400">
            Showing {visibleExams.length} of {examTotal} exam{examTotal === 1 ? "" : "s"}
          </div>
        )}
      </Card>

      <div className="space-y-3">
        {visibleExams.map(e => {
          const qCount = Array.isArray(e.question_ids) ? e.question_ids.length : 0;
          const subjIds: string[] = Array.isArray(e.subject_ids) && e.subject_ids.length ? e.subject_ids : [e.subject_id].filter(Boolean);
          return (
            <Card key={e.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-slate-500">{examSubjectNames(e)} · {e.total_marks} marks · {e.duration_minutes} min · {qCount} questions{e.shuffle_questions ? " · shuffled" : ""}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {e.is_published ? <Badge>Published</Badge> : <Badge className="bg-slate-700/40 text-slate-400 border-slate-600">Draft</Badge>}
                    {subjIds.length > 1 && <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/30">{subjIds.length} subjects</Badge>}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {!isTeacher && e.is_published && <Button onClick={() => start(e.id)}><PlayCircle size={16}/> Start</Button>}
                  {isTeacher && <>
                    <Button variant="outline" onClick={() => startEdit(e)}><Pencil size={14}/> Edit</Button>
                    <Button variant="outline" onClick={() => nav(`/print?exam=${e.id}`)}><Printer size={14}/> Print</Button>
                    <Button variant="outline" onClick={() => publish(e.id, !e.is_published)}>{e.is_published ? "Unpublish" : "Publish"}</Button>
                    <Button variant="ghost" onClick={() => del(e.id)}><Trash2 size={14}/></Button>
                  </>}
                </div>
              </div>
            </Card>
          );
        })}
        {visibleExams.length === 0 && (
          <Card hover={false} className="flex items-center justify-between gap-3 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <FileText size={16} />
              {examTotal === 0 ? "No exams yet." : "No exams match your search or filters."}
            </span>
            {filtersActive && <Button variant="ghost" onClick={clearExamFilters}>Clear filters</Button>}
          </Card>
        )}
      </div>
    </div>
  );
}
