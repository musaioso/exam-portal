import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Card, Button, Input, Field, Select, Badge } from "../components/ui";
import { Plus, Trash2, PlayCircle, Shuffle, X, Wand2, Printer, ArrowUp, ArrowDown, GripVertical, FileText, Pencil } from "lucide-react";
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
  const dragIndex = useRef<number | null>(null);
  const PAGE_SIZE = 40;

  const subjectKey = form.subjectIds.join(",");

  const load = async () => {
    const { data } = await api.get("/exams");
    setExams(data.exams || []);
  };
  useEffect(() => { load(); api.get("/subjects").then(r => setSubjects(r.data.subjects || [])); }, []);

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
    setSubjectTimes((prev) => (prev[id] != null ? prev : { ...prev, [id]: 10 }));
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

  const applyTypeMarks = async () => {
    const groups: Record<string, string[]> = { mcq: [], short: [], long: [] };
    for (const q of selectedQs as any[]) if (groups[q.type]) groups[q.type].push(q.id);
    const jobs = (["mcq", "short", "long"] as const)
      .filter((t) => groups[t].length)
      .map((t) => ({ type: t, ids: groups[t], marks: typeMarks[t] }));
    if (!jobs.length) return;
    const summary = jobs.map((j) => `${j.type.toUpperCase()}: ${j.ids.length} × ${j.marks}`).join("\n");
    if (!confirm(`Set marks on the selected questions in the question bank?\n\n${summary}\n\n(This updates the shared questions.)`)) return;
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
    const existingTimes: Record<string, number> = {};
    for (const t of (e.subject_times || [])) existingTimes[t.subject_id] = t.minutes;
    const base = Math.max(1, Math.floor((e.duration_minutes || 30) / Math.max(1, subjIds.length)));
    const t: Record<string, number> = {};
    subjIds.forEach((id) => { t[id] = existingTimes[id] ?? base; });
    if (!(e.subject_times || []).length && subjIds.length) {
      const sum = subjIds.reduce((s, id) => s + t[id], 0);
      t[subjIds[subjIds.length - 1]] = Math.max(1, t[subjIds[subjIds.length - 1]] + ((e.duration_minutes || 30) - sum));
    }
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
    if (!form.subjectIds.length || form.question_ids.length === 0) {
      alert("Select at least one subject and one question.");
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
    if (editingId) await api.put(`/exams/${editingId}`, payload);
    else await api.post("/exams", payload);
    resetForm();
    setShowForm(false);
    load();
  };

  const publish = async (id: string, val: boolean) => {
    await api.put(`/exams/${id}/${val ? "publish" : "unpublish"}`);
    load();
  };
  const del = async (id: string) => {
    if (!confirm("Delete exam?")) return;
    await api.delete(`/exams/${id}`); load();
  };

  const start = async (id: string) => {
    const { data } = await api.post(`/exams/${id}/start`);
    nav(`/take-exam/${data.attempt.id}`);
  };

  const isTeacher = user?.role === "admin" || user?.role === "teacher";
  const examSubjectNames = (e: any) => {
    const ids: string[] = Array.isArray(e.subject_ids) && e.subject_ids.length ? e.subject_ids : [e.subject_id].filter(Boolean);
    return ids.map(subjectName).join(" + ");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Exams</h1>
        {isTeacher && <Button onClick={() => { resetForm(); setShowForm(true); }}><Plus size={16}/> New Exam</Button>}
      </div>

      {showForm && (
        <Card>
          <form onSubmit={save} className="space-y-4">
            <div className="text-sm font-semibold text-slate-200">{editingId ? "Edit exam" : "New exam"}{editingId ? "" : ""}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Title"><Input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required /></Field>
              <Field label="Duration (min)"><Input type="number" value={form.duration_minutes} onChange={e=>setForm({...form,duration_minutes:Number(e.target.value)})} /></Field>
              <div className="flex items-end gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.shuffle_questions} onChange={e=>setForm({...form, shuffle_questions:e.target.checked})} /> Shuffle questions</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.shuffle_options} onChange={e=>setForm({...form, shuffle_options:e.target.checked})} /> Shuffle options</label>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-slate-300 mb-2">Subjects (multi-select) — selected {form.subjectIds.length}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {subjects.map(s => (
                  <label key={s.id} className={`flex items-center gap-2 text-sm p-2 rounded-lg border cursor-pointer ${form.subjectIds.includes(s.id) ? "border-indigo-500 bg-indigo-500/10" : "border-slate-700 hover:bg-white/5"}`}>
                    <input type="checkbox" checked={form.subjectIds.includes(s.id)} onChange={() => toggleSubject(s.id)} />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {form.subjectIds.length > 0 && (
              <div className="rounded-xl border border-slate-700 p-3 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm text-slate-300">Time per subject (minutes)</span>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>Total {subjectTimesSum} min</span>
                    {subjectTimesSum !== form.duration_minutes && <span className="text-amber-300">(paper total will be {subjectTimesSum} min)</span>}
                    <Button type="button" variant="ghost" className="text-xs px-2 py-1" onClick={autoSplitTime}>Split evenly</Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {form.subjectIds.map(id => (
                    <Field key={id} label={subjectName(id)}>
                      <Input type="number" min={0} value={subjectTimes[id] ?? 0}
                        onChange={e => setSubjectTimes(t => ({ ...t, [id]: Number(e.target.value) || 0 }))} />
                    </Field>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-700 p-3">
              <Wand2 size={16} className="text-indigo-300" />
              <span className="text-sm text-slate-300 mr-2">Auto paper by counts</span>
              <Field label="MCQ"><Input type="number" min={0} value={blueprint.mcq} onChange={e=>setBlueprint({...blueprint, mcq:Number(e.target.value)||0})} /></Field>
              <Field label="Short"><Input type="number" min={0} value={blueprint.short} onChange={e=>setBlueprint({...blueprint, short:Number(e.target.value)||0})} /></Field>
              <Field label="Long"><Input type="number" min={0} value={blueprint.long} onChange={e=>setBlueprint({...blueprint, long:Number(e.target.value)||0})} /></Field>
              <Field label="Difficulty">
                <Select value={blueprint.difficulty} onChange={e=>setBlueprint({...blueprint, difficulty:e.target.value as any})}>
                  <option value="">Any</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>
              <Button type="button" variant="outline" onClick={generateByBlueprint}>Generate</Button>
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-700 p-3">
              <span className="text-sm text-slate-300 mr-2">Auto marks by type</span>
              <Field label="MCQ marks"><Input type="number" min={0} value={typeMarks.mcq} onChange={e=>setTypeMarks({...typeMarks, mcq:Number(e.target.value)||0})} /></Field>
              <Field label="Short marks"><Input type="number" min={0} value={typeMarks.short} onChange={e=>setTypeMarks({...typeMarks, short:Number(e.target.value)||0})} /></Field>
              <Field label="Long marks"><Input type="number" min={0} value={typeMarks.long} onChange={e=>setTypeMarks({...typeMarks, long:Number(e.target.value)||0})} /></Field>
              <Button type="button" variant="outline" onClick={applyTypeMarks} disabled={selectedQs.length === 0}>Apply to selected</Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-3">
                <div className="text-sm font-medium text-slate-300">Select questions ({form.question_ids.length} selected, {filteredQs.length} shown)</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Field label="Direction / search (type, topic, keywords)">
                    <Input value={qQuery} onChange={e => setQQuery(e.target.value)} placeholder="e.g. mcq capital geography" />
                  </Field>
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
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={selectFiltered}>Select filtered</Button>
                  <Button type="button" variant="ghost" onClick={clearSelection}>Clear selection</Button>
                  <Field label="Auto count"><Input type="number" min={1} value={autoCount} onChange={e => setAutoCount(Number(e.target.value) || 1)} /></Field>
                  <Field label="Mode">
                    <Select value={autoMode} onChange={e => setAutoMode(e.target.value as any)}>
                      <option value="random">Random</option>
                      <option value="first">First available</option>
                    </Select>
                  </Field>
                  <Button type="button" variant="outline" onClick={autoSelect}>Auto-select</Button>
                </div>
                <div className="max-h-72 overflow-auto border border-slate-700 rounded-xl p-2 space-y-1">
                  {pageQs.map(q => (
                    <label key={q.id} className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" checked={form.question_ids.includes(q.id)} onChange={() => toggleQ(q.id)} />
                      <span className="truncate">{q.prompt}</span>
                      <Badge className="ml-auto">{q.type}{q.difficulty ? ` · ${q.difficulty}` : ""}</Badge>
                    </label>
                  ))}
                  {availableQs.length === 0 && <div className="text-slate-500 text-xs p-2">Select a subject with questions.</div>}
                  {availableQs.length > 0 && filteredQs.length === 0 && <div className="text-slate-500 text-xs p-2">No questions match your direction/filter.</div>}
                </div>
                {availableQs.length > 0 && (
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <Button type="button" variant="ghost" disabled={safePage <= 1} onClick={() => setQPage((p) => Math.max(1, p - 1))}>Prev</Button>
                    <span>Page {safePage} / {totalPages} · {filteredQs.length} matched</span>
                    <Button type="button" variant="ghost" disabled={safePage >= totalPages} onClick={() => setQPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-300">Paper order ({form.question_ids.length})</div>
                  <div className="text-xs text-slate-400">{selectedMarks} marks</div>
                </div>
                <div className="text-[11px] text-slate-500">Drag to reorder, or use ▲▼.</div>
                <div className="max-h-80 overflow-auto space-y-1">
                  {selectedQs.map((q: any, idx: number) => (
                    <div
                      key={q.id}
                      draggable
                      onDragStart={() => (dragIndex.current = idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (dragIndex.current != null) moveSelected(dragIndex.current, idx); dragIndex.current = null; }}
                      className="flex items-start gap-2 text-xs bg-white/5 rounded-lg p-2 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical size={14} className="text-slate-500 mt-0.5 shrink-0" />
                      <span className="flex-1 line-clamp-2">{idx + 1}. {q.prompt}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => moveSelected(idx, idx - 1)} className="text-slate-400 hover:text-white" title="Move up"><ArrowUp size={13} /></button>
                        <button type="button" onClick={() => moveSelected(idx, idx + 1)} className="text-slate-400 hover:text-white" title="Move down"><ArrowDown size={13} /></button>
                        <button type="button" onClick={() => toggleQ(q.id)} className="text-rose-300 hover:text-rose-200" title="Remove"><X size={14} /></button>
                      </div>
                    </div>
                  ))}
                  {form.question_ids.length > 0 && selectedQs.length < form.question_ids.length && (
                    <div className="text-xs text-amber-300">{form.question_ids.length - selectedQs.length} selected question(s) from hidden subjects.</div>
                  )}
                  {form.question_ids.length === 0 && <div className="text-xs text-slate-500">No questions selected yet.</div>}
                </div>
                <div className="text-[11px] text-slate-400 border-t border-slate-700/50 pt-2">
                  MCQ {marksByType.mcq.count}×{typeMarks.mcq} = {marksByType.mcq.marks}m · Short {marksByType.short.count}×{typeMarks.short} = {marksByType.short.marks}m · Long {marksByType.long.count}×{typeMarks.long} = {marksByType.long.marks}m
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit">{editingId ? <><Pencil size={14} /> Save changes</> : <><Shuffle size={14} /> Create Exam</>}</Button>
              <Button type="button" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {exams.filter(e => isTeacher || e.is_published).map(e => {
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
        {exams.filter(e => isTeacher || e.is_published).length === 0 && (
          <Card className="text-sm text-slate-400 flex items-center gap-2"><FileText size={16}/> No exams yet.</Card>
        )}
      </div>
    </div>
  );
}
