import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Card, Button, Input, Field } from "../components/ui";

export default function Results() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [attempts, setAttempts] = useState<any[]>([]);
  const [grading, setGrading] = useState<string | null>(null);
  const [gradeForm, setGradeForm] = useState({ score: 0, total: 0 });

  const load = async () => {
    if (user?.role === "student") {
      const { data } = await api.get("/exams/attempts/mine");
      setAttempts(data.attempts);
    } else {
      // teachers: load all exams then attempts? Our API doesn't list all attempts. Use attempts by exam not available. Fallback: fetch exams and attempts per exam not implemented. Show students only? Instead list from? We'll show message.
      const { data } = await api.get("/exams");
      const all: any[] = [];
      for (const e of data.exams) {
        // no endpoint for exam attempts list. Skip.
      }
      setAttempts(all);
    }
  };
  useEffect(() => { load(); }, [user]);

  // If attempt param in URL, fetch and display detail
  const attemptParam = params.get("attempt");
  const [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    if (attemptParam) api.get(`/exams/attempts/${attemptParam}`).then(r => setDetail(r.data.attempt)).catch(()=>{});
  }, [attemptParam]);

  const submitGrade = async (id: string) => {
    await api.put(`/exams/attempts/${id}/grade`, gradeForm);
    setGrading(null); load();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Results</h1>
      {detail && (
        <Card>
          <div className="text-lg font-semibold mb-2">Attempt submitted</div>
          <div className="text-sm text-slate-300">Score: <span className="text-emerald-400 font-bold">{detail.score}</span> / {detail.total} ({detail.total ? ((detail.score/detail.total)*100).toFixed(1) : 0}%)</div>
          <div className="text-xs text-slate-500 mt-1">Status: {detail.status}</div>
        </Card>
      )}
      <Card>
        {user?.role === "student" ? (
          <div className="space-y-2">
            {attempts.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-slate-700/40 text-sm">
                <div>
                  <div className="font-medium">Exam {a.exam_id.slice(0,8)}</div>
                  <div className="text-xs text-slate-500">{new Date(a.started_at).toLocaleString()} · {a.status}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-emerald-400">{a.score ?? "-"} / {a.total ?? "-"}</div>
                  <div className="text-xs text-slate-500">{a.total ? ((a.score/a.total)*100).toFixed(1) : ""}%</div>
                </div>
              </div>
            ))}
            {attempts.length === 0 && <div className="text-slate-500 text-sm">No attempts yet.</div>}
          </div>
        ) : (
          <div className="text-slate-400 text-sm">
            Teacher grading for written answers: open an attempt from a student exam submission. (Attempts can be graded via the API PUT /exams/attempts/:id/grade)
            {grading && (
              <div className="mt-3 space-y-2">
                <Field label="Score"><Input type="number" value={gradeForm.score} onChange={e=>setGradeForm({...gradeForm,score:Number(e.target.value)})} /></Field>
                <Field label="Total"><Input type="number" value={gradeForm.total} onChange={e=>setGradeForm({...gradeForm,total:Number(e.target.value)})} /></Field>
                <Button onClick={() => submitGrade(grading)}>Save Grade</Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}