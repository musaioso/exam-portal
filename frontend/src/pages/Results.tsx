import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { optionLabel } from "../lib/labels";
import { useAuth } from "../lib/auth-context";
import { Card, Button, Input, NumberInput, Field, Badge, Select } from "../components/ui";
import { CheckCircle2, Eye, Filter, Lightbulb, Save, Target, X, XCircle } from "lucide-react";

function statusBadge(status: string) {
  if (status === "graded")
    return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Graded</Badge>;
  if (status === "submitted")
    return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">Submitted</Badge>;
  return <Badge className="bg-slate-700/40 text-slate-300 border-slate-600">In progress</Badge>;
}

const pct = (score: any, total: any) => (total ? ((score / total) * 100).toFixed(1) : "0.0");

const EMPTY_FILTERS = { subjectId: "", studentId: "", examId: "", status: "", q: "" };

export default function Results() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const isTeacher = user?.role === "admin" || user?.role === "teacher";

  const [attempts, setAttempts] = useState<any[]>([]);
  const [examMap, setExamMap] = useState<Record<string, string>>({});
  const [subjectMap, setSubjectMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // filter option lists (teacher/admin only)
  const [subjects, setSubjects] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [search, setSearch] = useState("");

  const [detail, setDetail] = useState<any | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  /** Whether the marking key + explanation may be shown for the open attempt. */
  const [showKey, setShowKey] = useState(false);
  const [gradeForm, setGradeForm] = useState({ score: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attemptParam = params.get("attempt");

  const load = async () => {
    setLoading(true);
    try {
      if (isTeacher) {
        const qs = new URLSearchParams();
        if (filters.subjectId) qs.set("subject_id", filters.subjectId);
        if (filters.studentId) qs.set("student_id", filters.studentId);
        if (filters.examId) qs.set("exam_id", filters.examId);
        if (filters.status) qs.set("status", filters.status);
        if (filters.q.trim()) qs.set("q", filters.q.trim());
        const { data } = await api.get(`/exams/attempts?${qs.toString()}`);
        setAttempts(data.attempts || []);
      } else {
        const [{ data: a }, { data: e }] = await Promise.all([
          api.get("/exams/attempts/mine"),
          api.get("/exams"),
        ]);
        setAttempts(a.attempts || []);
        const m: Record<string, string> = {};
        (e.exams || []).forEach((x: any) => { m[x.id] = x.title; });
        setExamMap(m);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [user, filters]);

  // Load filter options (subjects, students, exams) for teachers once.
  useEffect(() => {
    if (!isTeacher) return;
    (async () => {
      const [s, u, e] = await Promise.all([api.get("/subjects"), api.get("/users"), api.get("/exams")]);
      const subjectList = s.data.subjects || [];
      setSubjects(subjectList);
      setStudents((u.data.users || []).filter((x: any) => x.role === "student"));
      setExams(e.data.exams || []);
      const sm: Record<string, string> = {};
      subjectList.forEach((x: any) => { sm[x.id] = x.name; });
      setSubjectMap(sm);
    })();
  }, [user]);

  // Debounce the free-text search into the filters.
  useEffect(() => {
    if (!isTeacher) return;
    const t = setTimeout(() => setFilters(f => ({ ...f, q: search })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const openAttempt = async (id: string) => {
    setError(null);
    try {
      // One call gets the attempt, its questions, what was given, whether it was
      // right and (when allowed) the key + explanation.
      const { data } = await api.get(`/exams/attempts/${id}/review`);
      const a = data.attempt;
      // The teacher list already knows who sat the paper; the review endpoint
      // deliberately does not repeat it.
      const row = attempts.find((x: any) => x.id === id);
      setDetail({ ...a, exam_title: data.exam?.title, ...(row || {}) });
      setGradeForm({ score: a.score ?? 0, total: a.total ?? 0 });
      setQuestions(data.questions || []);
      setShowKey(!!data.showKey);
    } catch {
      setError("Could not load that attempt.");
    }
  };

  useEffect(() => {
    if (attemptParam) openAttempt(attemptParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptParam]);

  const closeDetail = () => {
    setDetail(null);
    setQuestions([]);
    setShowKey(false);
    if (params.get("attempt")) {
      params.delete("attempt");
      setParams(params, { replace: true });
    }
  };

  const submitGrade = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await api.put(`/exams/attempts/${detail.id}/grade`, gradeForm);
      closeDetail();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const examTitle = (a: any) =>
    a.exam_title || examMap[a.exam_id] || `Exam ${String(a.exam_id).slice(0, 8)}`;

  const examOptions = exams.filter(e => !filters.subjectId || e.subject_id === filters.subjectId);
  const hasActiveFilters =
    !!(filters.subjectId || filters.studentId || filters.examId || filters.status || filters.q);

  /** MCQs the student did not get right — the set offered for practice. */
  const practiceCount = questions.filter((q: any) => q.type === "mcq" && q.correct !== true).length;

  const setSubject = (subjectId: string) =>
    setFilters(f => {
      // Drop the exam selection if it no longer belongs to the chosen subject.
      const keepExam = exams.some(e => e.id === f.examId && (!subjectId || e.subject_id === subjectId));
      return { ...f, subjectId, examId: keepExam ? f.examId : "" };
    });

  const clearFilters = () => { setSearch(""); setFilters({ ...EMPTY_FILTERS }); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Results</h1>
        {isTeacher && <div className="text-xs text-slate-500">{attempts.length} attempt{attempts.length === 1 ? "" : "s"}</div>}
      </div>

      {error && <Card hover={false} className="border border-rose-500/40 text-rose-300 text-sm">{error}</Card>}

      {isTeacher && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-300"><Filter size={15} /> Filters</div>
            {hasActiveFilters && (
              <Button variant="ghost" className="px-2 py-1" onClick={clearFilters}>
                <X size={14} /> Clear
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Subject">
              <Select value={filters.subjectId} onChange={e => setSubject(e.target.value)}>
                <option value="">All subjects</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Exam">
              <Select value={filters.examId} onChange={e => setFilters(f => ({ ...f, examId: e.target.value }))}>
                <option value="">All exams</option>
                {examOptions.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
              </Select>
            </Field>
            <Field label="Student">
              <Select value={filters.studentId} onChange={e => setFilters(f => ({ ...f, studentId: e.target.value }))}>
                <option value="">All students</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.grade ? ` (${s.grade}${s.section ? `-${s.section}` : ""})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">All statuses</option>
                <option value="in_progress">In progress</option>
                <option value="submitted">Submitted</option>
                <option value="graded">Graded</option>
              </Select>
            </Field>
          </div>
          <Field label="Search">
            <Input
              placeholder="Student name, email or exam title"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </Field>
        </Card>
      )}

      {detail && (
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">{examTitle(detail)}</div>
              <div className="text-xs text-slate-400">
                {isTeacher && detail.student_name
                  ? `${detail.student_name}${detail.student_email ? ` · ${detail.student_email}` : ""} · `
                  : ""}
                {detail.started_at ? new Date(detail.started_at).toLocaleString() : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(detail.status)}
              <button onClick={closeDetail} className="text-slate-400 hover:text-slate-200" title="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="text-sm text-slate-300">
            Score: <span className="text-emerald-400 font-bold">{detail.score ?? "-"}</span> / {detail.total ?? "-"}
            {detail.total ? <span className="text-slate-500"> ({pct(detail.score, detail.total)}%)</span> : null}
          </div>

          {questions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-slate-300">Answers</div>
                {showKey && practiceCount > 0 && (
                  <Link
                    to={`/practice/${detail.id}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20"
                  >
                    <Target size={14} /> ভুল {practiceCount}টি অনুশীলন
                  </Link>
                )}
              </div>

              {questions.map((q: any, i: number) => (
                <div key={q.id} className="rounded-2xl border border-slate-700/50 p-3 text-sm space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">
                      {i + 1}. {q.prompt}{" "}
                      <span className="text-slate-500 text-xs">({q.marks} mark{q.marks > 1 ? "s" : ""})</span>
                    </div>
                    {q.type === "mcq" ? (
                      q.answered ? (
                        <Badge
                          className={
                            q.correct
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          }
                        >
                          {q.correct ? "Correct" : "Wrong"}
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-700/40 text-slate-400 border-slate-600">No answer</Badge>
                      )
                    ) : (
                      <Badge className="bg-slate-700/40 text-slate-400 border-slate-600">{q.type}</Badge>
                    )}
                  </div>

                  {/* Option-by-option: what they picked, and where the key sits. */}
                  {Array.isArray(q.options) && q.options.length > 0 ? (
                    <div className="space-y-1">
                      {q.options.map((o: any, oi: number) => {
                        const isGiven =
                          q.answered && String(q.given).trim().toLowerCase() === String(o).trim().toLowerCase();
                        const isKey =
                          showKey &&
                          q.answer != null &&
                          String(q.answer).trim().toLowerCase() === String(o).trim().toLowerCase();
                        const tone = isKey
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : isGiven
                            ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                            : "border-slate-700/40 text-slate-400";
                        return (
                          <div
                            key={oi}
                            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${tone}`}
                          >
                            {isKey ? (
                              <CheckCircle2 size={13} className="shrink-0" />
                            ) : isGiven ? (
                              <XCircle size={13} className="shrink-0" />
                            ) : (
                              <span className="w-[13px] shrink-0 text-center text-slate-600">
                                {optionLabel(q.prompt, oi)}
                              </span>
                            )}
                            <span>{String(o)}</span>
                            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide opacity-80">
                              {isKey && isGiven ? "সঠিক" : isGiven ? "আপনার উত্তর" : isKey ? "সঠিক উত্তর" : ""}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">
                      Answer:{" "}
                      <span className="text-slate-200">
                        {q.answered ? String(q.given) : <span className="italic text-slate-500">no answer</span>}
                      </span>
                    </div>
                  )}

                  {showKey && !Array.isArray(q.options) && q.answer != null && (
                    <div className="text-xs text-slate-400">
                      সঠিক উত্তর: <span className="font-medium text-emerald-300">{String(q.answer)}</span>
                    </div>
                  )}

                  {showKey && q.explanation && (
                    <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1.5 text-xs text-slate-300">
                      <Lightbulb size={12} className="mr-1 inline -mt-0.5 text-indigo-300" />
                      <span className="font-medium text-indigo-200">ব্যাখ্যা:</span> {q.explanation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {isTeacher && (
            <div className="border-t border-slate-700/50 pt-3 space-y-3">
              <div className="text-sm font-medium text-slate-300">Grade</div>
              <div className="grid grid-cols-2 gap-3 max-w-sm">
                <Field label="Score">
                  <NumberInput
                    value={gradeForm.score}
                    onChange={e => setGradeForm({ ...gradeForm, score: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Total">
                  <NumberInput
                    value={gradeForm.total}
                    onChange={e => setGradeForm({ ...gradeForm, total: Number(e.target.value) })}
                  />
                </Field>
              </div>
              <Button onClick={submitGrade} disabled={saving}>
                <Save size={15} /> {saving ? "Saving..." : "Save Grade"}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="text-slate-500 text-sm">Loading...</div>
        ) : attempts.length === 0 ? (
          <div className="text-slate-500 text-sm">
            {isTeacher
              ? hasActiveFilters
                ? "No attempts match these filters."
                : "No attempts submitted yet."
              : "No attempts yet."}
          </div>
        ) : (
          <div className="space-y-2">
            {attempts.map(a => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-4 py-2 border-b border-slate-700/40 last:border-0 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{examTitle(a)}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {isTeacher && a.student_name ? `${a.student_name} · ` : ""}
                    {isTeacher && subjectMap[a.subject_id] ? `${subjectMap[a.subject_id]} · ` : ""}
                    {a.started_at ? new Date(a.started_at).toLocaleString() : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="font-semibold text-emerald-400">
                      {a.score ?? "-"} / {a.total ?? "-"}
                    </div>
                    <div className="text-xs text-slate-500">{a.total ? `${pct(a.score, a.total)}%` : ""}</div>
                  </div>
                  {statusBadge(a.status)}
                  <Button variant="outline" className="px-2 py-1" onClick={() => openAttempt(a.id)}>
                    <Eye size={14} /> {isTeacher ? "Review" : "View"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
