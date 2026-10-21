import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { optionLabel } from "../lib/labels";
import { seededShuffle, questionSeed } from "../lib/shuffle";
import { Card, Button, Input, Textarea, cn } from "../components/ui";
import { confirmDialog } from "../components/Dialog";
import {
  PaletteLegend,
  QuestionPaletteGrid,
  QuestionPaletteSheet,
} from "../components/QuestionPalette";
import { CheckCircle2, LayoutGrid, SkipForward } from "lucide-react";

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A question counts as answered once it holds a non-blank answer. */
function isAnswered(q: any, answers: Record<string, string>) {
  const v = answers[q.id];
  return v != null && String(v).trim() !== "";
}

export default function TakeExam() {
  const { attemptId } = useParams();
  const nav = useNavigate();

  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The header is sticky, so scrolling a question to the very top would hide
  // it behind the header — we measure the header and offset the scroll by it.
  const headerRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  // Set when the student jumps via the palette / "next unanswered" so the
  // automatic scroll-to-question only fires for deliberate jumps.
  const jumpedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const { data: a } = await api.get(`/exams/attempts/${attemptId}`);
      const { data: e } = await api.get(`/exams/${a.attempt.exam_id}`);
      setExam(e.exam);
      let qs: any[] = e.questions || [];
      const seed = e.exam.shuffle_seed;
      if (seed != null && e.exam.shuffle_options) {
        qs = qs.map((q: any) => ({ ...q, options: Array.isArray(q.options) ? seededShuffle(q.options, questionSeed(seed, q.id)) : q.options }));
      } else if (e.exam.shuffle_options) {
        qs = qs.map((q: any) => ({ ...q, options: Array.isArray(q.options) ? shuffleArray(q.options) : q.options }));
      }
      if (seed != null && e.exam.shuffle_questions) qs = seededShuffle(qs, seed);
      else if (e.exam.shuffle_questions) qs = shuffleArray(qs);
      setQuestions(qs);
      setCurrent(0);
      setAnswers(a.attempt.answers || {});
      const durationSec = (e.exam.duration_minutes || 0) * 60;
      const startedAt = a.attempt.started_at || Date.now();
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemaining(Math.max(0, durationSec - elapsed));
    })();
  }, [attemptId]);

  const handleSubmit = async (auto = false) => {
    if (submitting) return;
    if (!auto) {
      const missing = questions.filter((q) => !isAnswered(q, answers)).length;
      const ok = await confirmDialog({
        title: "Submit exam?",
        message: missing > 0 ? `You still have ${missing} unanswered question${missing > 1 ? "s" : ""}.` : undefined,
        confirmLabel: "Submit exam",
      });
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/exams/attempts/${attemptId}/submit`);
      nav(`/results?attempt=${attemptId}`, { state: data });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!exam) return;
    const t = setInterval(() => setRemaining(r => {
      if (r <= 1) { clearInterval(t); handleSubmit(true); return 0; }
      return r - 1;
    }), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam]);

  const answeredCount = useMemo(
    () => questions.filter((q) => isAnswered(q, answers)).length,
    [questions, answers]
  );
  const progress = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  // The palette needs one entry per question, flagged answered / unanswered.
  const paletteItems = useMemo(
    () => questions.map((q) => ({ id: String(q.id), answered: isAnswered(q, answers) })),
    [questions, answers]
  );

  const saveAnswer = (qid: string, val: string) => {
    setAnswers(prev => ({ ...prev, [qid]: val }));
    api.post(`/exams/attempts/${attemptId}/answer`, { question_id: qid, answer: val }).catch(() => {});
  };

  /* ----------------------------------------------------------------------
     Navigation helpers
     ---------------------------------------------------------------------- */

  /** Jump to a question and bring it into view under the sticky header. */
  const goTo = (index: number) => {
    jumpedRef.current = true;
    setCurrent(index);
  };

  /** Jump to the next question that still has no answer (wraps around). */
  const goToNextUnanswered = () => {
    const n = questions.length;
    if (!n) return;
    for (let step = 1; step <= n; step++) {
      const i = (current + step) % n;
      if (!isAnswered(questions[i], answers)) {
        goTo(i);
        return;
      }
    }
  };

  useEffect(() => {
    const el = questionRef.current;
    const header = headerRef.current;
    if (!el) return;
    // Leave room for the sticky header so the question is never hidden.
    el.style.scrollMarginTop = `${(header?.offsetHeight ?? 0) + 12}px`;
    if (!jumpedRef.current) return;
    jumpedRef.current = false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [current, questions.length]);

  if (!exam) return <div className="p-6 text-slate-400">Loading...</div>;

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const lowTime = remaining <= 60;

  const opts = (q: any) => (Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]"));

  const hasUnanswered = answeredCount < questions.length;

  const pickQuestion = (i: number) => {
    goTo(i);
    setPaletteOpen(false);
  };

  return (
    <div className="mx-auto w-full max-w-[62rem]">
      {/* The rail only appears from `xl` up: below that the app sidebar already
          eats 256px, and squeezing the paper into a narrow column would hurt
          far more than the palette being one tap away. */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-start xl:gap-4">
        {/* ---------------------------- main column ---------------------------- */}
        <div className="mx-auto w-full max-w-3xl space-y-4 xl:mx-0 xl:max-w-none">
          {/* Compact sticky header — the question palette deliberately lives
              outside it so a 200-question exam can't drown the viewport. */}
          <div ref={headerRef} className="sticky top-0 z-10">
            <Card hover={false} className="!p-3 space-y-2 sm:!p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{exam.title}</div>
                  <div className="text-xs text-slate-400">
                    {exam.total_marks} marks · {questions.length} questions
                  </div>
                </div>
                <div className={cn("shrink-0 font-mono text-lg", lowTime ? "text-rose-400" : "text-cyan-300")}>
                  {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-slate-700/60 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {answeredCount}/{questions.length} answered
                </span>
              </div>

              {/* `flex-wrap` so very narrow phones drop the second action to
                  its own line instead of squeezing the header. */}
              <div className="flex flex-wrap items-center justify-between gap-2 xl:justify-end">
                {/* Below `xl` the palette lives in a sheet, so this button is
                    the only way into it. */}
                <Button
                  variant="outline"
                  className="shrink-0 px-2.5 py-1.5 text-xs xl:hidden"
                  onClick={() => setPaletteOpen(true)}
                >
                  <LayoutGrid size={14} />
                  Questions
                </Button>

                <Button
                  variant="outline"
                  className="shrink-0 px-2.5 py-1.5 text-xs"
                  onClick={goToNextUnanswered}
                  disabled={!hasUnanswered}
                  title="Jump to the next unanswered question"
                >
                  <SkipForward size={14} />
                  <span className="whitespace-nowrap">Next unanswered</span>
                </Button>
              </div>
            </Card>
          </div>

          {questions.length > 0 && (() => {
            const q = questions[current];
            const answered = isAnswered(q, answers);
            return (
              <div ref={questionRef}>
                <Card className={cn(answered && "ring-1 ring-emerald-500/30")}>
                  <div className="text-sm font-medium mb-3 flex items-start gap-2">
                    <span className="shrink-0">{current + 1}.</span>
                    <span className="flex-1">{q.prompt}</span>
                    <span className="text-slate-500 text-xs shrink-0">({q.marks || 1} mark{(q.marks || 1) > 1 ? "s" : ""})</span>
                  </div>
                  {q.type === "mcq" && (
                    <div className="space-y-1">
                      {opts(q).map((o: string, i: number) => {
                        const active = answers[q.id] === o;
                        return (
                          <label key={i} className={`flex items-center gap-3 text-sm p-2 rounded-lg border transition ${answered ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-ink/5"} ${active ? "border-indigo-500 bg-indigo-500/10" : "border-transparent"}`}>
                            <input type="radio" name={q.id} checked={active} disabled={answered} onChange={() => saveAnswer(q.id, o)} className="sr-only" />
                            <span className={`w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-xs ${active ? "border-indigo-400 bg-indigo-500/30 text-indigo-100" : "border-slate-600 text-slate-400"}`}>
                              {optionLabel(q.prompt, i)}
                            </span>
                            <span>{o}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {q.type === "short" && (
                    <Input value={answers[q.id] || ""} onChange={e => saveAnswer(q.id, e.target.value)} placeholder="Your answer" />
                  )}
                  {q.type === "long" && (
                    <Textarea rows={5} value={answers[q.id] || ""} onChange={e => saveAnswer(q.id, e.target.value)} placeholder="Your answer" />
                  )}
                  {answered && (
                    <div className="mt-2 text-[11px] text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Saved</div>
                  )}
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <Button variant="ghost" disabled={current === 0} onClick={() => goTo(Math.max(0, current - 1))}>
                      ← Previous
                    </Button>
                    <span className="text-xs text-slate-400">Question {current + 1} of {questions.length}</span>
                    <Button variant="ghost" disabled={current === questions.length - 1} onClick={() => goTo(Math.min(questions.length - 1, current + 1))}>
                      Next →
                    </Button>
                  </div>
                </Card>
              </div>
            );
          })()}

          <div className="flex items-center justify-between sticky bottom-0 py-3 bg-slate-950/60 backdrop-blur rounded-xl px-3">
            <span className="text-xs text-slate-400 tabular-nums">{answeredCount}/{questions.length} answered</span>
            <Button onClick={() => handleSubmit(false)} disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Exam"}
            </Button>
          </div>
        </div>

        {/* --------------------- desktop palette rail ---------------------- */}
        <aside className="hidden xl:block xl:sticky xl:top-0">
          <Card hover={false} className="!p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-200">Questions</span>
              <span className="text-xs tabular-nums text-slate-400">
                {answeredCount}/{questions.length}
              </span>
            </div>
            {/* Capped + scrollable: a 200-question palette is far taller than
                any viewport, so it must never grow the sticky column. */}
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain pr-1">
              <QuestionPaletteGrid
                items={paletteItems}
                current={current}
                onPick={(i) => goTo(i)}
              />
            </div>
            <PaletteLegend answered={answeredCount} total={questions.length} />
          </Card>
        </aside>
      </div>

      {/* --------------------- mobile palette sheet ---------------------- */}
      <QuestionPaletteSheet
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        current={current}
        onPick={pickQuestion}
        answered={answeredCount}
        total={questions.length}
      />
    </div>
  );
}
