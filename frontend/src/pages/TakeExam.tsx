import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Card, Button, Input, Textarea } from "../components/ui";
import { confirmDialog } from "../components/Dialog";
import { CheckCircle2 } from "lucide-react";

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export default function TakeExam() {
  const { attemptId } = useParams();
  const nav = useNavigate();

  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: a } = await api.get(`/exams/attempts/${attemptId}`);
      const { data: e } = await api.get(`/exams/${a.attempt.exam_id}`);
      setExam(e.exam);
      let qs: any[] = e.questions || [];
      if (e.exam.shuffle_options) {
        qs = qs.map((q: any) => ({ ...q, options: Array.isArray(q.options) ? shuffleArray(q.options) : q.options }));
      }
      if (e.exam.shuffle_questions) qs = shuffleArray(qs);
      setQuestions(qs);
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
      const missing = questions.filter((q) => !isAnswered(q)).length;
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

  const isAnswered = (q: any) => {
    const v = answers[q.id];
    return v != null && String(v).trim() !== "";
  };

  const answeredCount = useMemo(() => questions.filter(isAnswered).length, [questions, answers]);
  const progress = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  const saveAnswer = (qid: string, val: string) => {
    setAnswers(prev => ({ ...prev, [qid]: val }));
    api.post(`/exams/attempts/${attemptId}/answer`, { question_id: qid, answer: val }).catch(() => {});
  };

  if (!exam) return <div className="p-6 text-slate-400">Loading...</div>;

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const lowTime = remaining <= 60;

  const opts = (q: any) => (Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]"));

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card hover={false} className="sticky top-0 z-10 !p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">{exam.title}</div>
            <div className="text-xs text-slate-400">{exam.total_marks} marks · {questions.length} questions</div>
          </div>
          <div className={`text-lg font-mono ${lowTime ? "text-rose-400" : "text-cyan-300"}`}>
            {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>{answeredCount} / {questions.length} answered</span>
          <div className="flex flex-wrap gap-1 max-w-[60%] justify-end">
            {questions.map((q, i) => (
              <a
                key={q.id}
                href={`#q-${q.id}`}
                className={`w-5 h-5 rounded text-[10px] flex items-center justify-center ${isAnswered(q) ? "bg-emerald-500/25 text-emerald-300" : "bg-slate-700/50 text-slate-400"}`}
                title={isAnswered(q) ? "Answered" : "Not answered"}
              >
                {i + 1}
              </a>
            ))}
          </div>
        </div>
      </Card>

      {questions.map((q, idx) => {
        const answered = isAnswered(q);
        return (
          <Card key={q.id} className={`scroll-mt-32 ${answered ? "ring-1 ring-emerald-500/30" : ""}`}>
            <div id={`q-${q.id}`} className="scroll-mt-32" />
            <div className="text-sm font-medium mb-3 flex items-start gap-2">
              <span className="shrink-0">{idx + 1}.</span>
              <span className="flex-1">{q.prompt}</span>
              <span className="text-slate-500 text-xs shrink-0">({q.marks || 1} mark{(q.marks || 1) > 1 ? "s" : ""})</span>
            </div>
            {q.type === "mcq" && (
              <div className="space-y-1">
                {opts(q).map((o: string, i: number) => {
                  const active = answers[q.id] === o;
                  return (
                    <label key={i} className={`flex items-center gap-3 text-sm p-2 rounded-lg cursor-pointer border transition ${active ? "border-indigo-500 bg-indigo-500/10" : "border-transparent hover:bg-ink/5"}`}>
                      <input type="radio" name={q.id} checked={active} onChange={() => saveAnswer(q.id, o)} className="sr-only" />
                      <span className={`w-6 h-6 shrink-0 rounded-full border flex items-center justify-center text-xs ${active ? "border-indigo-400 bg-indigo-500/30 text-indigo-100" : "border-slate-600 text-slate-400"}`}>
                        {LETTERS[i] || i + 1}
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
          </Card>
        );
      })}

      <div className="flex items-center justify-between sticky bottom-0 py-3 bg-slate-950/60 backdrop-blur rounded-xl px-3">
        <span className="text-xs text-slate-400">{answeredCount}/{questions.length} answered</span>
        <Button onClick={() => handleSubmit(false)} disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Exam"}
        </Button>
      </div>
    </div>
  );
}
