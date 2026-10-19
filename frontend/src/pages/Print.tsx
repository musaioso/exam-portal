import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { parseOptions, PREVIEW_STORAGE_KEY, readPrintPrefs, writePrintPrefs, type PrintData } from "../lib/printTemplate";
import { Card, Button, Select, Field, Input, NumberInput, Textarea } from "../components/ui";
import { Printer, FileText } from "lucide-react";

type Mode = "exam" | "manual";

export default function Print() {
  const [params, setParams] = useSearchParams();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);

  const initialExam = params.get("exam") || "";
  const [mode, setMode] = useState<Mode>(initialExam ? "exam" : "manual");
  const [examId, setExamId] = useState(initialExam);
  const [exam, setExam] = useState<any>(null);

  // manual picking
  const [chapters, setChapters] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  // paper settings
  const [prefs] = useState(() => readPrintPrefs());
  const [title, setTitle] = useState(() => prefs.title || "Question Paper");
  const [school, setSchool] = useState(() => prefs.school || "School Name");
  const [time, setTime] = useState(30);
  const [columns, setColumns] = useState<1 | 2>(prefs.columns === 1 ? 1 : 2);
  const [groupBySubject, setGroupBySubject] = useState(() => prefs.groupBySubject !== false);
  const [includeAnswers, setIncludeAnswers] = useState(() => prefs.showAnswers !== false);
  const [includeMarks, setIncludeMarks] = useState(() => prefs.showMarks !== false);
  const [showInstructions, setShowInstructions] = useState(() => prefs.showInstructions !== false);
  const [instructions, setInstructions] = useState(() => prefs.instructions || "Answer all questions. Marks are shown on the right side.");

  // Remember these as this device's defaults (merged with whatever the preview
  // saved) so the next paper starts from the same setup.
  useEffect(() => {
    writePrintPrefs({
      school, title, instructions, columns, groupBySubject,
      showAnswers: includeAnswers, showMarks: includeMarks, showInstructions,
    });
  }, [school, title, instructions, columns, groupBySubject, includeAnswers, includeMarks, showInstructions]);

  // manual filters
  const [filterType, setFilterType] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/subjects").then(r => setSubjects(r.data.subjects || []));
    api.get("/exams").then(r => setExams(r.data.exams || []));
    api.get("/questions").then(r => setQuestions(r.data.questions || []));
  }, []);

  useEffect(() => {
    if (subjectId) api.get(`/subjects/${subjectId}/chapters`).then(r => setChapters(r.data.chapters || []));
    else setChapters([]);
    setChapterId("");
  }, [subjectId]);

  // Load the selected exam
  useEffect(() => {
    if (mode !== "exam" || !examId) { setExam(null); return; }
    api.get(`/exams/${examId}`).then(r => {
      const e = r.data.exam;
      setExam(e);
      setTitle(e.title || "Question Paper");
      setTime(e.duration_minutes || 30);
      setSelected(Array.isArray(e.question_ids) ? e.question_ids : []);
    }).catch(() => setExam(null));
    const next = new URLSearchParams(params);
    next.set("exam", examId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, examId]);

  const byId = useMemo(() => {
    const m: Record<string, any> = {};
    for (const q of questions) m[q.id] = q;
    return m;
  }, [questions]);

  const subjectName = (id?: string) => subjects.find(s => s.id === id)?.name || "Subject";

  // ordered selected questions
  const orderedSelected = useMemo(
    () => selected.map(id => byId[id]).filter(Boolean),
    [selected, byId]
  );
  const totalMarks = orderedSelected.reduce((s, q) => s + (q.marks || 1), 0);

  const subjectTimeMap = useMemo(() => {
    const m: Record<string, number> = {};
    if (exam && Array.isArray(exam.subject_times)) {
      for (const t of exam.subject_times) m[t.subject_id] = t.minutes;
    }
    return m;
  }, [exam]);

  // distinct subjects among printed questions
  const printedSubjects = useMemo(() => {
    const ids = Array.from(new Set(orderedSelected.map(q => q.subject_id).filter(Boolean)));
    const preferred: string[] = exam && Array.isArray(exam.subject_ids) ? exam.subject_ids : [];
    const ordered: string[] = [];
    for (const id of preferred) if (ids.includes(id)) ordered.push(id);
    for (const id of ids) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  }, [orderedSelected, exam]);
  const isMultiSubject = printedSubjects.length > 1;

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const filteredQuestions = questions.filter(q => {
    if (subjectId && q.subject_id !== subjectId) return false;
    if (chapterId && q.chapter_id !== chapterId) return false;
    if (filterType && q.type !== filterType) return false;
    if (filterDifficulty && q.difficulty !== filterDifficulty) return false;
    if (search.trim() && !(q.prompt || "").toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });
  const allVisibleSelected = filteredQuestions.length > 0 && filteredQuestions.every(q => selected.includes(q.id));
  const toggleSelectAllVisible = () => {
    const visibleIds = new Set(filteredQuestions.map(q => q.id));
    if (allVisibleSelected) setSelected(s => s.filter(id => !visibleIds.has(id)));
    else setSelected(s => Array.from(new Set([...s, ...filteredQuestions.map(q => q.id)])));
  };
  const clearSelection = () => setSelected([]);

  const buildPrint = () => {
    const mkQ = (q: any) => ({
      prompt: q.prompt,
      type: q.type,
      options: parseOptions(q),
      marks: q.marks || 1,
      answer: q.answer || "",
      explanation: q.explanation || "",
      subject: subjectName(q.subject_id),
      page: q.page ?? null,
    });

    const subjectLine = isMultiSubject
      ? printedSubjects.map(subjectName).join(", ")
      : subjectName(printedSubjects[0] || exam?.subject_id);
    const perSubjectTime = isMultiSubject && printedSubjects.some(s => subjectTimeMap[s])
      ? ` (${printedSubjects.map(s => `${subjectName(s)} ${subjectTimeMap[s] || 0}m`).join(" · ")})`
      : "";

    const groups = (groupBySubject && isMultiSubject)
      ? printedSubjects
          .map(sid => ({ name: subjectName(sid), time: subjectTimeMap[sid] || 0, questions: orderedSelected.filter(q => q.subject_id === sid).map(mkQ) }))
          .filter(g => g.questions.length)
      : [{ name: subjectLine, time: 0, questions: orderedSelected.map(mkQ) }];

    const data: PrintData = {
      subjectLine, time, perSubjectTime, totalMarks,
      groups,
      defaults: {
        school, title, instructions,
        columns, fontSize: 11, showHeader: true,
        showMarks: includeMarks, showAnswers: includeAnswers,
        showInstructions, groupBySubject, labelStyle: "auto", numStyle: "auto",
        date: new Date().toLocaleDateString("en-GB"),
        showName: true, showSchool: true, showTitle: true, showSubject: true,
        showTime: true, showFullMarks: true, showDate: true, showRollClass: false,
        runningTitle: true,
        showPageNo: true, pageNumPos: "alternate", pageNumFmt: "num",
      },
    };

    // Stage the payload for the preview tab (sessionStorage is copied to
    // same-origin windows opened via window.open), then open the real
    // /print/preview URL — a normal document, never a blank about:blank.
    try {
      sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable — the preview will show its fallback message */
    }
    const w = window.open("/print/preview", "_blank");
    if (!w) {
      // Popup blocked: open it in this tab instead (Back returns here).
      window.location.assign("/print/preview");
    }
  };

  const loadExamIntoManual = (id: string) => {
    setMode("exam");
    setExamId(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Print Question Paper</h1>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => { setMode("exam"); }}
            className={`px-3 py-1.5 rounded-xl border ${mode === "exam" ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-300 hover:bg-ink/5"}`}
          >
            From a ready exam
          </button>
          <button
            type="button"
            onClick={() => { setMode("manual"); setExam(null); setSelected([]); setTitle("Question Paper"); }}
            className={`px-3 py-1.5 rounded-xl border ${mode === "manual" ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-300 hover:bg-ink/5"}`}
          >
            Pick questions manually
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="space-y-3">
          {mode === "exam" && (
            <Field label="Ready exam">
              <Select value={examId} onChange={e => setExamId(e.target.value)} placeholder="Select an exam...">
                <option value="">Select an exam...</option>
                {exams.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title} · {(Array.isArray(ex.subject_ids) ? ex.subject_ids.length : 1)} subject(s) · {ex.total_marks}m
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="School / Institute"><Input value={school} onChange={e => setSchool(e.target.value)} /></Field>
          <Field label="Paper Title"><Input value={title} onChange={e => setTitle(e.target.value)} /></Field>

          {mode === "manual" && (
            <>
              <Field label="Subject">
                <Select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                  <option value="">All subjects</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Chapter">
                <Select value={chapterId} onChange={e => setChapterId(e.target.value)}>
                  <option value="">All chapters</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>Ch.{c.number} {c.title}</option>)}
                </Select>
              </Field>
              <Field label="Question Type">
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
              <Field label="Search question">
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="keyword..." />
              </Field>
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Time (min)"><NumberInput value={time} onChange={e => setTime(Number(e.target.value))} /></Field>
            <Field label="Columns">
              <Select value={String(columns)} onChange={e => setColumns(Number(e.target.value) === 1 ? 1 : 2)}>
                <option value="2">2 columns</option>
                <option value="1">1 column</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={groupBySubject} onChange={e => setGroupBySubject(e.target.checked)} /> Group by subject (multi-subject)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeAnswers} onChange={e => setIncludeAnswers(e.target.checked)} /> Include answer key &amp; mark scheme
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeMarks} onChange={e => setIncludeMarks(e.target.checked)} /> Show marks per question
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInstructions} onChange={e => setShowInstructions(e.target.checked)} /> Include instructions box
          </label>
          {showInstructions && (
            <Field label="Instructions">
              <Textarea rows={2} value={instructions} onChange={e => setInstructions(e.target.value)} />
            </Field>
          )}

          {exam && (
            <div className="text-xs text-slate-400 rounded-xl border border-slate-700 p-2 space-y-1">
              <div className="flex items-center gap-1 text-slate-300"><FileText size={13} /> {exam.title}</div>
              <div>{exam.is_published ? "Published" : "Draft"} · {exam.duration_minutes} min · {exam.total_marks} marks</div>
              {isMultiSubject && (
                <div>
                  {printedSubjects.map(s => (
                    <div key={s}>• {subjectName(s)}: {orderedSelected.filter(q => q.subject_id === s).length} q{subjectTimeMap[s] ? ` · ${subjectTimeMap[s]} min` : ""}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-sm text-slate-400">Selected: {selected.length} questions · {totalMarks} marks{isMultiSubject ? ` · ${printedSubjects.length} subjects` : ""}</div>
          <Button onClick={buildPrint} disabled={selected.length === 0} className="w-full"><Printer size={16} /> Preview &amp; Print</Button>
          <div className="text-xs text-slate-500">
            {selected.length === 0
              ? "Select at least one question to enable Preview & Print."
              : "Opens a preview window where you can adjust settings, then print/save as PDF."}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          {mode === "exam" ? (
            exam ? (
              <>
                <div className="text-sm font-medium mb-2">Exam questions ({selected.length} selected of {exam.question_ids.length})</div>
                <div className="max-h-[60vh] overflow-auto space-y-1">
                  {selected.map((id, i) => {
                    const q = byId[id];
                    if (!q) return null;
                    return (
                      <label key={id} className="flex items-start gap-2 text-sm py-1 border-b border-slate-700/30">
                        <input type="checkbox" checked onChange={() => toggle(id)} className="mt-1" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{i + 1}. {q.prompt}</div>
                          <div className="text-xs text-slate-500">{subjectName(q.subject_id)} · {String(q.type).toUpperCase()} · {q.marks}m{q.difficulty ? ` · ${q.difficulty}` : ""}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="text-xs text-slate-400 mt-2">Uncheck any question to leave it out of the print copy.</div>
              </>
            ) : (
              <div className="text-slate-400 text-sm">Select a ready exam from the left to load its questions.</div>
            )
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="text-sm font-medium">Select questions ({filteredQuestions.length} shown)</div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} /> Select all shown
                  </label>
                  <Button variant="ghost" onClick={clearSelection} className="text-xs px-2 py-1">Clear</Button>
                </div>
              </div>
              <div className="max-h-[60vh] overflow-auto space-y-1">
                {filteredQuestions.map(q => (
                  <label key={q.id} className="flex items-start gap-2 text-sm py-1 border-b border-slate-700/30">
                    <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{q.prompt}</div>
                      <div className="text-xs text-slate-500">{subjectName(q.subject_id)} · {q.type.toUpperCase()} · {q.marks}m{q.difficulty ? ` · ${q.difficulty}` : ""}</div>
                    </div>
                  </label>
                ))}
                {filteredQuestions.length === 0 && <div className="text-slate-500 text-xs">No questions. Adjust filters.</div>}
              </div>
              <div className="text-xs text-slate-400 mt-2">Selected total: {selected.length} questions · {totalMarks} marks.</div>
            </>
          )}
        </Card>
      </div>

      {mode === "manual" && exams.length > 0 && (
        <div className="text-xs text-slate-500">
          Tip: to print a ready exam, switch to <button className="text-indigo-300 underline" onClick={() => setMode("exam")}>From a ready exam</button> and pick one.
          {exams[0] && <span> Or open <button className="text-indigo-300 underline" onClick={() => loadExamIntoManual(exams[0].id)}>{exams[0].title}</button>.</span>}
        </div>
      )}
    </div>
  );
}
