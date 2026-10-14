import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Card, Button, Input, Textarea } from "../components/ui";

export default function TakeExam() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const [attempt, setAttempt] = useState<any>(null);
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: a } = await api.get(`/exams/attempts/${attemptId}`);
      setAttempt(a.attempt);
      const { data: e } = await api.get(`/exams/${a.attempt.exam_id}`);
      setExam(e.exam);
      setQuestions(e.questions);
      setAnswers(a.attempt.answers || {});
      setRemaining(e.exam.duration_minutes * 60);
    })();
  }, [attemptId]);

  useEffect(() => {
    if (!exam) return;
    const t = setInterval(() => setRemaining(r => {
      if (r <= 1) { clearInterval(t); handleSubmit(true); return 0; }
      return r - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [exam]);

  const saveAnswer = (qid: string, val: string) => {
    setAnswers(prev => ({ ...prev, [qid]: val }));
    api.post(`/exams/attempts/${attemptId}/answer`, { question_id: qid, answer: val }).catch(() => {});
  };

  const handleSubmit = async (auto = false) => {
    if (submitting) return;
    if (!auto && !confirm("Submit exam?")) return;
    setSubmitting(true);
    try {
      const { data } = await api.post(`/exams/attempts/${attemptId}/submit`);
      nav(`/results?attempt=${attemptId}`, { state: data });
    } finally { setSubmitting(false); }
  };

  if (!exam) return <div className="p-6 text-slate-400">Loading...</div>;

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card className="flex items-center justify-between sticky top-0 z-10">
        <div>
          <div className="font-semibold">{exam.title}</div>
          <div className="text-xs text-slate-400">{exam.total_marks} marks</div>
        </div>
        <div className="text-lg font-mono text-cyan-300">{String(mm).padStart(2,"0")}:{String(ss).padStart(2,"0")}</div>
      </Card>

      {questions.map((q, idx) => (
        <Card key={q.id}>
          <div className="text-sm font-medium mb-2">
            {idx + 1}. {q.prompt} <span className="text-slate-500 text-xs">({q.marks} mark{q.marks>1?"s":""})</span>
          </div>
          {q.type === "mcq" && (
            <div className="space-y-1">
              {(Array.isArray(q.options) ? q.options : JSON.parse(q.options)).map((o: string, i: number) => (
                <label key={i} className="flex items-center gap-2 text-sm p-2 rounded-lg hover:bg-white/5 cursor-pointer">
                  <input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => saveAnswer(q.id, o)} />
                  {o}
                </label>
              ))}
            </div>
          )}
          {q.type === "short" && (
            <Input value={answers[q.id] || ""} onChange={e => saveAnswer(q.id, e.target.value)} placeholder="Your answer" />
          )}
          {q.type === "long" && (
            <Textarea rows={5} value={answers[q.id] || ""} onChange={e => saveAnswer(q.id, e.target.value)} placeholder="Your answer" />
          )}
        </Card>
      ))}

      <div className="flex justify-end">
        <Button onClick={() => handleSubmit(false)} disabled={submitting}>{submitting ? "Submitting..." : "Submit Exam"}</Button>
      </div>
    </div>
  );
}