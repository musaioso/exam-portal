import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card, Skeleton } from "../components/ui";
import { ArrowLeft, ArrowRight, CheckCircle2, Lightbulb, PartyPopper, RotateCcw, Target, XCircle } from "lucide-react";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/**
 * A low-stakes re-run of just the questions that went wrong: pick an option,
 * get told straight away whether it was right and why. Nothing is saved — this
 * is for learning, not for a mark book.
 */
export default function Practice() {
  const { attemptId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/exams/attempts/${attemptId}/review`)
      .then(({ data }) => {
        // Only MCQs with options can be practised interactively; long answers
        // have no single key to check against.
        const missed = (data.questions || []).filter(
          (q: any) => q.type === "mcq" && Array.isArray(q.options) && q.options.length > 0 && q.correct !== true
        );
        setItems(missed);
        setExamTitle(data.exam?.title || "");
      })
      .catch(() => setError("প্র্যাকটিস খোলা যায়নি।"))
      .finally(() => setLoading(false));
  }, [attemptId]);

  const q: any = items[idx];
  const answered = picked != null;
  const right =
    answered && q && String(picked).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase();

  const choose = (o: string) => {
    if (answered) return; // one pick per question
    setPicked(o);
    if (String(o).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase()) setHits(h => h + 1);
  };

  const next = () => {
    if (idx + 1 >= items.length) setDone(true);
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
  };

  if (loading)
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
      </div>
    );

  const noMisses = !error && items.length === 0;

  if (error || noMisses)
    return (
      <div className="max-w-2xl mx-auto">
        <Card hover={false} className="text-center space-y-3 py-10">
          <Target size={40} className="mx-auto text-emerald-400" />
          <div className="text-lg font-semibold">
            {noMisses ? "একটিও ভুল নেই 🎉" : "কিছু এনে দাও নি"}
          </div>
          <p className="text-sm text-slate-400">
            {noMisses
              ? "এই পরীক্ষার সব MCQ আপনি ঠিক করেছেন — অনুশীলনের মতো কিছু বাকি নেই।"
              : error}
          </p>
          <Link to="/results">
            <Button variant="outline">
              <ArrowLeft size={16} /> ফলাফলে ফিরে যান
            </Button>
          </Link>
        </Card>
      </div>
    );

  if (done) {
    const pct = items.length ? Math.round((hits / items.length) * 100) : 0;
    const tone =
      pct === 100 ? "text-emerald-300" : pct >= 60 ? "text-amber-300" : "text-rose-300";
    return (
      <div className="max-w-2xl mx-auto">
        <Card hover={false} className="text-center space-y-4 py-10">
          <PartyPopper size={40} className="mx-auto text-amber-300" />
          <div>
            <div className="text-3xl font-bold">
              <span className={tone}>{hits}</span>
              <span className="text-slate-500"> / {items.length}</span>
            </div>
            <div className="text-sm text-slate-400 mt-1">
              এই রাউন্ডে {pct}% ঠিক হয়েছে
              {examTitle ? ` · ${examTitle}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={restart}>
              <RotateCcw size={16} /> আবার করুন
            </Button>
            <Link to="/results">
              <Button>
                <ArrowLeft size={16} /> ফলাফলে ফিরে যান
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const progress = ((idx + (answered ? 1 : 0)) / items.length) * 100;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Target size={18} className="text-amber-300" /> ভুল অনুশীলন
            {examTitle ? <span className="text-slate-400 font-normal">· {examTitle}</span> : null}
          </h1>
          <div className="text-xs text-slate-400">
            {idx + 1} / {items.length} · সঠিক {hits}
          </div>
        </div>
        <Link to="/results" className="text-xs text-slate-400 hover:text-slate-200 shrink-0">
          বাতিল
        </Link>
      </div>

      <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-violet-400 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <Card hover={false}>
        <div className="text-sm font-medium mb-3 flex items-start gap-2">
          <span className="shrink-0">{idx + 1}.</span>
          <span className="flex-1">{q.prompt}</span>
        </div>

        <div className="space-y-1">
          {q.options.map((o: string, i: number) => {
            const isKey = String(o).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase();
            const isPicked = String(picked ?? "").trim().toLowerCase() === String(o).trim().toLowerCase();
            const tone = !answered
              ? "border-transparent hover:bg-ink/5"
              : isKey
                ? "border-emerald-500/50 bg-emerald-500/10"
                : isPicked
                  ? "border-rose-500/50 bg-rose-500/10"
                  : "border-transparent opacity-60";
            return (
              <button
                key={i}
                type="button"
                onClick={() => choose(o)}
                disabled={answered}
                className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left text-sm transition ${tone} ${
                  answered ? "cursor-default" : "cursor-pointer"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                    answered && isKey
                      ? "border-emerald-400 bg-emerald-500/30 text-emerald-300"
                      : answered && isPicked
                        ? "border-rose-400 bg-rose-500/30 text-rose-300"
                        : "border-slate-600 text-slate-400"
                  }`}
                >
                  {LETTERS[i] || i + 1}
                </span>
                <span>{o}</span>
                {answered && isKey && <CheckCircle2 size={16} className="ml-auto shrink-0 text-emerald-300" />}
                {answered && isPicked && !isKey && (
                  <XCircle size={16} className="ml-auto shrink-0 text-rose-300" />
                )}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="mt-3 space-y-3">
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                right
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-200"
              }`}
            >
              {right ? (
                <>
                  <CheckCircle2 size={15} className="mr-1.5 inline -mt-0.5" /> সঠিক!{" "}
                  {q.explanation ? null : "দারুণ।"}
                </>
              ) : (
                <>
                  <XCircle size={15} className="mr-1.5 inline -mt-0.5" /> সঠিক উত্তর{" "}
                  <span className="font-semibold">
                    {LETTERS[q.options.findIndex((o: string) => String(o).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase())] ||
                      q.answer}
                  </span>
                  {" — "}
                  <span className="font-medium">{String(q.answer)}</span>
                </>
              )}
            </div>

            {q.explanation && (
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-sm text-slate-300">
                <Lightbulb size={14} className="mr-1.5 inline -mt-0.5 text-indigo-300" />
                {q.explanation}
              </div>
            )}

            <Button onClick={next}>
              {idx + 1 >= items.length ? "শেষ করুন" : "পরের প্রশ্ন"} <ArrowRight size={16} />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
