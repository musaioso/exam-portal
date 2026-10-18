import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Card, Button, Skeleton } from "../components/ui";
import { ArrowLeft, ArrowRight, CheckCircle2, PartyPopper, RotateCcw, Target, XCircle } from "lucide-react";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const LIMIT = 10;

/**
 * Standalone self-study: pick a subject (or any subject), answer randomized MCQs
 * from the question bank with instant feedback. Nothing is saved — this is for
 * learning, not for a mark book.
 */
export default function StandalonePractice() {
  const [searchParams] = useSearchParams();
  const nav = useNavigate();

  const [subjects, setSubjects] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedSubject, setSelectedSubject] = useState(searchParams.get("subject") || "");

  useEffect(() => {
    api
      .get("/subjects")
      .then(({ data }) => setSubjects(Array.isArray(data) ? data : data.subjects || []))
      .catch(() => {});
  }, []);

  const start = () => {
    setLoading(true);
    setError("");
    api
      .get("/questions/practice", {
        params: { subject_id: selectedSubject || undefined, limit: LIMIT },
      })
      .then(({ data }) => {
        setQuestions(data.questions || []);
        setIdx(0);
        setPicked(null);
        setHits(0);
        setDone(false);
      })
      .catch(() => setError("প্রশ্ন আনা যায়নি। আবার চেষ্টা করুন।"))
      .finally(() => setLoading(false));
  };

  const q = questions[idx];
  const answered = picked != null;
  const correct =
    q && String(picked ?? "").trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase();

  const choose = (o: string) => {
    if (answered || !q) return;
    setPicked(o);
    // Correctness must be computed against the answer just picked (o), not the
    // stale `correct` captured from the previous render (picked was still null).
    const isCorrect =
      String(o).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase();
    if (isCorrect) setHits(h => h + 1);
  };

  const next = () => {
    if (idx + 1 >= questions.length) setDone(true);
    else {
      setIdx(i => i + 1);
      setPicked(null);
    }
  };

  const restart = () => {
    setIdx(0);
    setPicked(null);
    setHits(0);
    setDone(false);
    setError("");
  };

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name || "বিষয়";

  if (loading)
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    );

  // Subject picker — shown until the first round starts.
  if (!done && questions.length === 0)
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Target size={18} className="text-amber-300" /> স্বাধীন অনুশীলন
          </h1>
          <Link to="/dashboard" className="text-xs text-slate-400 hover:text-slate-200 shrink-0">
            <ArrowLeft size={14} /> ড্যাশবোর্ডে ফিরে যান
          </Link>
        </div>

        <Card hover={false} className="p-6 space-y-4">
          <div className="text-sm text-slate-400">
            যে বিষয়ে অনুশীলন করবেন তা বেছে নিন (খালি রাখলে যেকোনো বিষয় থেকে প্রশ্ন আসবে)।
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {subjects.map((s) => (
              <Button
                key={s.id}
                variant={selectedSubject === s.id ? "primary" : "outline"}
                onClick={() => setSelectedSubject(s.id)}
                className="text-sm"
              >
                {s.name}
              </Button>
            ))}
            <Button variant={!selectedSubject ? "primary" : "outline"} onClick={() => setSelectedSubject("")} className="text-sm">
              সব বিষয়
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            প্রতি রাউন্ডে {LIMIT}টি র‍্যান্ডম মাল্টিপল-চয়েস প্রশ্ন। সঠিক উত্তর দিলে অবিলম্বে ফলাফল জানতে পারবেন।
          </p>
          <div className="flex justify-end">
            <Button onClick={start} disabled={loading}>
              <RotateCcw size={15} /> রাউন্ড শুরু করুন
            </Button>
          </div>
        </Card>
      </div>
    );

  if (error)
    return (
      <div className="max-w-2xl mx-auto text-center py-10">
        <XCircle size={40} className="mx-auto text-rose-400" />
        <div className="text-lg font-semibold">{error}</div>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={start}>
            আবার চেষ্টা করুন
          </Button>
          <Link to="/dashboard">
            <Button variant="outline"><ArrowLeft size={14} /> ড্যাশবোর্ড</Button>
          </Link>
        </div>
      </div>
    );

  if (done) {
    const pct = questions.length ? Math.round((hits / questions.length) * 100) : 0;
    const tone =
      pct === 100 ? "text-emerald-300" : pct >= 60 ? "text-amber-300" : "text-rose-300";
    return (
      <div className="max-w-2xl mx-auto text-center py-10">
        <PartyPopper size={48} className="mx-auto text-amber-300" />
        <div className="text-3xl font-bold mt-2">
          <span className={tone}>{hits}</span>
          <span className="text-slate-500"> / {questions.length}</span>
        </div>
        <div className="text-sm text-slate-400 mt-1">
          এই রাউন্ডে {pct}% সঠিক হয়েছে
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={restart}><RotateCcw size={15} /> আবার করুন</Button>
          <Button variant="outline" asChild>
            <Link to="/results">ফলাফলে ফিরে যান <ArrowRight size={14} /></Link>
          </Button>
        </div>
      </div>
    );
  }

  const answeredCount = idx + 1;
  const progress = Math.round((answeredCount / questions.length) * 100);
  const opts = Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]");

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Target size={18} className="text-amber-300" /> স্বাধীন অনুশীলন
          </h1>
          <div className="text-xs text-slate-400">
            {answeredCount} / {questions.length} · সঠিক {hits}
          </div>
        </div>
        <Link to="/dashboard" className="text-xs text-slate-400 hover:text-slate-200 shrink-0">
          <ArrowLeft size={14} /> বাতিল
        </Link>
      </div>

      <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-amber-500 to-rose-400 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <Card key={q.id} hover={false} className="p-5 space-y-4">
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-indigo-300">{idx + 1}.</span>
          <div className="flex-1">
            <div className="text-sm font-medium">{q.prompt}</div>
            <div className="text-xs text-slate-500 mt-1">
              {q.subject_name ? subjectName(q.subject_id) + " · " : ""}({q.marks || 1} নম্বর)
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {opts.map((o: string, i: number) => {
            const active = picked === o;
            const shown = answered ? String(o).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase() : false;
            return (
              <button
                key={i}
                onClick={() => choose(o)}
                disabled={answered}
                className={`flex items-center gap-3 text-sm p-3 rounded-xl border transition ${answered
                  ? shown
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                    : active
                      ? "border-rose-500 bg-rose-500/10 text-rose-300"
                      : "border-slate-700/40 text-slate-400"
                  : active
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-transparent hover:bg-ink/10 text-slate-300"}`}
              >
                <span className={`w-7 h-7 shrink-0 rounded-full border flex items-center justify-center text-xs ${
                  answered
                    ? shown
                      ? "border-emerald-500 bg-emerald-500 text-slate-900"
                      : active
                        ? "border-rose-500 bg-rose-500 text-slate-900"
                        : "border-slate-600 text-slate-400"
                    : active
                      ? "border-indigo-500 bg-indigo-500 text-indigo-100"
                      : "border-slate-600 text-slate-400"
                }`}>
                  {LETTERS[i] || i + 1}
                </span>
                <span>{o}</span>
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="flex items-center gap-2 mt-2">
            {correct ? (
              <span className="flex items-center gap-1 text-emerald-400 text-sm font-medium">
                <CheckCircle2 size={14} /> সঠিক
              </span>
            ) : (
              <span className="flex items-center gap-1 text-rose-400 text-sm font-medium">
                <XCircle size={14} /> ভুল — সঠিক উত্তর:{" "}
                <span className="text-emerald-400">{q.answer}</span>
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={next} disabled={!answered}>
            {answered ? "পরবর্তী" : "একটি বিকল্প বেছে নিন"}
          </Button>
        </div>
      </Card>
    </div>
    );
}
