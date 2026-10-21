import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { optionLabel } from "../lib/labels";
import { Button, Card, Skeleton, cn } from "../components/ui";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Layers,
  Lightbulb,
  ListChecks,
  PartyPopper,
  RotateCcw,
  SlidersHorizontal,
  Target,
  XCircle,
} from "lucide-react";

/** How many questions a round may hold. The endpoint caps a request at 50. */
const SIZES = [5, 10, 20, 50];

const DIFFICULTIES = [
  { value: "", label: "সব" },
  { value: "easy", label: "সহজ" },
  { value: "medium", label: "মাঝারি" },
  { value: "hard", label: "কঠিন" },
];

const DIFF_LABEL: Record<string, string> = { easy: "সহজ", medium: "মাঝারি", hard: "কঠিন" };

interface PracticeQuestion {
  id: string;
  subject_id: string;
  subject_name?: string | null;
  chapter_id?: string | null;
  chapter_title?: string | null;
  chapter_number?: number | null;
  difficulty?: string | null;
  prompt: string;
  options: string[];
  answer?: string | null;
  /** Index of the key inside `options` (-1 when the key matches no option). */
  answer_index: number;
  explanation?: string | null;
  marks: number;
}

interface FilterRow {
  id: string;
  name?: string;
  subject_id?: string;
  number?: number;
  title?: string;
  mcq_count?: number;
}

/**
 * Shuffle the options of a question while carrying the key along: the answer
 * index is remapped to wherever the key ended up, so grading never depends on
 * the order the options happen to be in.
 */
function shuffleOptions(options: string[], answerIndex: number) {
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    options: order.map((i) => options[i]),
    answer_index: answerIndex >= 0 ? order.indexOf(answerIndex) : -1,
  };
}

/**
 * The server hands over the index of the key, so the check is an exact
 * comparison and cannot be thrown off by a difference in case, Bangla digits
 * ("১.৫" vs "1.5") or Unicode composition ("য়" vs "য" + nukta). The text
 * comparison is only a fallback for rows whose key matches no option at all.
 */
function isCorrect(q: PracticeQuestion, picked: number | null): boolean {
  if (picked == null) return false;
  if (typeof q.answer_index === "number" && q.answer_index >= 0) return q.answer_index === picked;
  const text = String(q.options[picked] ?? "").trim().toLowerCase();
  return text !== "" && text === String(q.answer ?? "").trim().toLowerCase();
}

const marksOf = (q: PracticeQuestion) => Number(q.marks || 1);

/** A small count badge shown next to a filter chip. */
function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-black/25 px-1.5 text-[11px] font-semibold tabular-nums">
      {n}
    </span>
  );
}

/**
 * Standalone self-study: narrow the bank down to a subject, a chapter and a
 * difficulty, then answer a round of randomized MCQs with instant feedback and
 * an explanation. Nothing is saved — this is for learning, not for a mark book.
 */
export default function StandalonePractice() {
  const [searchParams] = useSearchParams();

  const [stage, setStage] = useState<"setup" | "round" | "done">("setup");
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [subjectId, setSubjectId] = useState(searchParams.get("subject") || "");
  const [chapterId, setChapterId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [size, setSize] = useState(10);

  const [subjects, setSubjects] = useState<FilterRow[]>([]);
  const [chapters, setChapters] = useState<FilterRow[]>([]);
  const [difficulties, setDifficulties] = useState<{ difficulty: string; n: number }[]>([]);
  const [total, setTotal] = useState(0);

  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  // The filter options come from the bank itself, so a subject that holds no
  // MCQ is never offered and every chip can show how many questions it hides.
  useEffect(() => {
    api
      .get("/questions/practice/filters", {
        params: { subject_id: subjectId || undefined, chapter_id: chapterId || undefined },
      })
      .then(({ data }) => {
        setSubjects(data.subjects || []);
        setChapters(data.chapters || []);
        setDifficulties(data.difficulties || []);
        setTotal(Number(data.total || 0));
      })
      .catch(() => {})
      .finally(() => setBooting(false));
  }, [subjectId, chapterId]);

  const subjectOptions = useMemo(() => subjects.filter((s) => Number(s.mcq_count || 0) > 0), [subjects]);
  const chapterOptions = useMemo(
    () => chapters.filter((c) => Number(c.mcq_count || 0) > 0 && (!subjectId || c.subject_id === subjectId)),
    [chapters, subjectId]
  );

  const allCount = useMemo(() => subjects.reduce((n, s) => n + Number(s.mcq_count || 0), 0), [subjects]);
  const subjectCount = subjectId
    ? Number(subjects.find((s) => s.id === subjectId)?.mcq_count || 0)
    : allCount;
  // How many questions the current selection really holds: the difficulty
  // breakdown is already scoped to the chosen subject and chapter.
  const diffCount = (value: string) =>
    value ? Number(difficulties.find((d) => d.difficulty === value)?.n || 0) : total;
  const available = diffCount(difficulty);
  const roundCount = Math.min(size, available);
  const selectedSubjectEmpty = !!subjectId && !subjectOptions.some((s) => s.id === subjectId);

  /** Lay out a set of questions as a fresh round. */
  const run = (list: PracticeQuestion[]) => {
    const prepared = list.map((q) => {
      const shuffled = shuffleOptions(q.options || [], q.answer_index);
      return { ...q, options: shuffled.options, answer_index: shuffled.answer_index };
    });
    setQuestions(prepared);
    setAnswers(prepared.map(() => null));
    setIdx(0);
    setPicked(null);
    setStage("round");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const start = () => {
    setLoading(true);
    setError("");
    api
      .get("/questions/practice", {
        params: {
          subject_id: subjectId || undefined,
          chapter_id: chapterId || undefined,
          difficulty: difficulty || undefined,
          limit: size,
        },
      })
      .then(({ data }) => {
        const list = (data.questions || []) as PracticeQuestion[];
        if (!list.length) {
          // The counters said there were questions, so an empty round is a
          // genuine failure — say so instead of dropping the student back to
          // the picker with no explanation.
          setError("এই সেটিংসে কোনো প্রশ্ন পাওয়া যায়নি। সেটিংস বদলে আবার চেষ্টা করুন।");
          return;
        }
        run(list);
      })
      .catch(() => setError("প্রশ্ন আনা যায়নি। আবার চেষ্টা করুন।"))
      .finally(() => setLoading(false));
  };

  const choose = (i: number) => {
    if (picked != null) return; // one pick per question
    setPicked(i);
    setAnswers((prev) => prev.map((v, k) => (k === idx ? i : v)));
  };

  const next = () => {
    if (idx + 1 >= questions.length) setStage("done");
    else {
      setIdx((i) => i + 1);
      setPicked(null);
    }
  };

  const q = questions[idx];
  const answered = picked != null;
  const correct = answered && q ? isCorrect(q, picked) : false;

  const answeredCount = answers.filter((a) => a != null).length;
  const hits = questions.filter((qq, i) => answers[i] != null && isCorrect(qq, answers[i])).length;
  const wrongList = questions.filter((qq, i) => !isCorrect(qq, answers[i]));
  const earned = questions.reduce((n, qq, i) => n + (isCorrect(qq, answers[i]) ? marksOf(qq) : 0), 0);
  const totalMarks = questions.reduce((n, qq) => n + marksOf(qq), 0);
  const pct = totalMarks ? Math.round((earned / totalMarks) * 100) : 0;

  if (booting)
    return (
      <div className="max-w-3xl mx-auto space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72" />
      </div>
    );

  /* ------------------------------------------------------------------ setup */
  if (stage === "setup")
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Target size={18} className="text-amber-300" /> স্বাধীন অনুশীলন
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              বিষয়, অধ্যায় ও কঠিনতা বেছে নিয়ে প্রশ্নের উত্তর দিন — সঠিক উত্তর ও ব্যাখ্যা সাথে সাথে দেখুন।
            </p>
          </div>
          <Link to="/dashboard" className="text-xs text-slate-400 hover:text-slate-200 shrink-0">
            <ArrowLeft size={14} /> ড্যাশবোর্ডে ফিরে যান
          </Link>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <Card hover={false} className="space-y-5">
          {/* বিষয় */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400">
              <BookOpen size={13} /> বিষয়
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={subjectId ? "outline" : "primary"}
                onClick={() => {
                  setSubjectId("");
                  setChapterId("");
                }}
                className="text-sm"
              >
                সব বিষয় <Count n={allCount} />
              </Button>
              {subjectOptions.map((s) => (
                <Button
                  key={s.id}
                  variant={subjectId === s.id ? "primary" : "outline"}
                  onClick={() => {
                    setSubjectId(s.id);
                    setChapterId("");
                  }}
                  className="text-sm"
                >
                  {s.name} <Count n={Number(s.mcq_count || 0)} />
                </Button>
              ))}
            </div>
            {selectedSubjectEmpty && (
              <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                এই বিষয়ে এখন কোনো মাল্টিপল-চয়েস প্রশ্ন নেই।{" "}
                <button
                  className="underline underline-offset-2 hover:text-amber-100"
                  onClick={() => {
                    setSubjectId("");
                    setChapterId("");
                  }}
                >
                  সব বিষয় দেখুন
                </button>
              </div>
            )}
          </div>

          {/* অধ্যায় */}
          {chapterOptions.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400">
                <Layers size={13} /> অধ্যায়
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant={chapterId ? "outline" : "primary"} onClick={() => setChapterId("")} className="text-sm">
                  সব অধ্যায় <Count n={subjectCount} />
                </Button>
                {chapterOptions.map((c) => (
                  <Button
                    key={c.id}
                    variant={chapterId === c.id ? "primary" : "outline"}
                    onClick={() => setChapterId(c.id)}
                    className="text-sm"
                  >
                    {c.number}. {c.title} <Count n={Number(c.mcq_count || 0)} />
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* কঠিনতা */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400">
              <SlidersHorizontal size={13} /> কঠিনতা
            </div>
            <div className="flex flex-wrap gap-2">
              {DIFFICULTIES.map((d) => (
                <Button
                  key={d.value}
                  variant={difficulty === d.value ? "primary" : "outline"}
                  onClick={() => setDifficulty(d.value)}
                  className="text-sm"
                >
                  {d.label} <Count n={diffCount(d.value)} />
                </Button>
              ))}
            </div>
          </div>

          {/* রাউন্ডের আকার */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-slate-400">
              <ListChecks size={13} /> রাউন্ডের আকার
            </div>
            <div className="flex flex-wrap gap-2">
              {SIZES.map((s) => (
                <Button
                  key={s}
                  variant={size === s ? "primary" : "outline"}
                  onClick={() => setSize(s)}
                  className="text-sm tabular-nums"
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/40 pt-4">
            <div className="text-xs text-slate-400">
              {available > 0 ? (
                <>
                  এই সেটিংসে <span className="font-semibold text-slate-200">{available}</span>টি প্রশ্ন আছে — রাউন্ডে{" "}
                  <span className="font-semibold text-slate-200">{roundCount}</span>টি থাকবে।
                </>
              ) : (
                "এই সেটিংসে কোনো মাল্টিপল-চয়েস প্রশ্ন নেই — সেটিংস বদলান।"
              )}
            </div>
            <Button onClick={start} disabled={loading || available === 0}>
              <RotateCcw size={15} /> রাউন্ড শুরু করুন
            </Button>
          </div>
        </Card>
      </div>
    );

  /* ------------------------------------------------------------------- done */
  if (stage === "done") {
    const tone = pct === 100 ? "text-emerald-300" : pct >= 60 ? "text-amber-300" : "text-rose-300";
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Card hover={false} className="text-center space-y-4 py-8">
          <PartyPopper size={40} className="mx-auto text-amber-300" />
          <div>
            <div className="text-3xl font-bold">
              <span className={tone}>{earned}</span>
              <span className="text-slate-500"> / {totalMarks} নম্বর</span>
            </div>
            <div className="text-sm text-slate-400 mt-1">
              এই রাউন্ডে {pct}% সঠিক হয়েছে · {answeredCount}/{questions.length}টি প্রশ্নের উত্তর দিয়েছেন
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {wrongList.length > 0 && (
              <Button onClick={() => run(wrongList)}>
                <RotateCcw size={15} /> ভুলগুলো আবার করুন ({wrongList.length})
              </Button>
            )}
            <Button variant="outline" onClick={start} disabled={loading}>
              <RotateCcw size={15} /> নতুন রাউন্ড
            </Button>
            <Button variant="ghost" onClick={() => setStage("setup")}>
              <SlidersHorizontal size={15} /> সেটিংস বদলান
            </Button>
          </div>
          <div className="text-xs">
            <Link to="/dashboard" className="text-slate-400 hover:text-slate-200">
              <ArrowLeft size={13} /> ড্যাশবোর্ডে ফিরে যান
            </Link>
          </div>
        </Card>

        <Card hover={false} className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks size={15} /> রাউন্ডের পর্যালোচনা
          </div>
          {questions.map((qq, i) => {
            const p = answers[i];
            const ok = isCorrect(qq, p);
            const keyText = qq.answer_index >= 0 ? qq.options[qq.answer_index] : String(qq.answer ?? "");
            return (
              <div key={qq.id} className="rounded-xl border border-slate-700/40 p-3">
                <div className="flex items-start gap-2">
                  <span className={cn("mt-0.5 shrink-0", ok ? "text-emerald-400" : "text-rose-400")}>
                    {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{qq.prompt}</div>
                    <div className="mt-1 space-y-0.5 text-xs">
                      <div className={ok ? "text-emerald-300" : "text-rose-300"}>
                        আপনার উত্তর: {p != null ? qq.options[p] : "উত্তর দেননি"}
                      </div>
                      {!ok && <div className="text-emerald-300">সঠিক উত্তর: {keyText}</div>}
                    </div>
                    {qq.explanation && (
                      <div className="mt-1.5 flex gap-1.5 text-xs text-slate-400">
                        <Lightbulb size={13} className="mt-0.5 shrink-0 text-indigo-300" />
                        <span>{qq.explanation}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------------------ round */
  const opts = Array.isArray(q?.options) ? q.options : [];
  const keyIndex = q ? (q.answer_index >= 0 ? q.answer_index : opts.findIndex((o) => String(o).trim().toLowerCase() === String(q.answer ?? "").trim().toLowerCase())) : -1;
  const progress = questions.length ? ((idx + (answered ? 1 : 0)) / questions.length) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Target size={18} className="text-amber-300" /> স্বাধীন অনুশীলন
          </h1>
          <div className="text-xs text-slate-400">
            {idx + 1} / {questions.length} · সঠিক {hits}
          </div>
        </div>
        <button
          onClick={() => setStage("setup")}
          className="text-xs text-slate-400 hover:text-slate-200 shrink-0"
        >
          সেটিংস
        </button>
      </div>

      <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-rose-400 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      {q && (
        <Card key={q.id} hover={false} className="p-5 space-y-4">
          <div className="flex items-start gap-2">
            <span className="shrink-0 text-indigo-300">{idx + 1}.</span>
            <div className="flex-1">
              <div className="text-sm font-medium">{q.prompt}</div>
              <div className="text-xs text-slate-500 mt-1">
                {[
                  q.subject_name,
                  q.chapter_title ? `${q.chapter_number ?? ""}. ${q.chapter_title}`.trim() : "",
                  q.difficulty ? DIFF_LABEL[q.difficulty] || q.difficulty : "",
                  `${marksOf(q)} নম্বর`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {opts.map((o: string, i: number) => {
              const isKey = i === keyIndex;
              const isPicked = picked === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => choose(i)}
                  disabled={answered}
                  className={`flex w-full items-center gap-3 text-left text-sm p-3 rounded-xl border transition ${
                    answered
                      ? isKey
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : isPicked
                          ? "border-rose-500 bg-rose-500/10 text-rose-300"
                          : "border-slate-700/40 text-slate-400"
                      : isPicked
                        ? "border-indigo-500 bg-indigo-500/10"
                        : "border-transparent hover:bg-ink/10 text-slate-300"
                  }`}
                >
                  <span
                    className={`w-7 h-7 shrink-0 rounded-full border flex items-center justify-center text-xs ${
                      answered
                        ? isKey
                          ? "border-emerald-500 bg-emerald-500 text-slate-900"
                          : isPicked
                            ? "border-rose-500 bg-rose-500 text-slate-900"
                            : "border-slate-600 text-slate-400"
                        : isPicked
                          ? "border-indigo-500 bg-indigo-500 text-indigo-100"
                          : "border-slate-600 text-slate-400"
                    }`}
                  >
                    {optionLabel(q.prompt, i)}
                  </span>
                  <span className="flex-1">{o}</span>
                  {answered && isKey && <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />}
                  {answered && isPicked && !isKey && <XCircle size={16} className="shrink-0 text-rose-400" />}
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="space-y-3">
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm",
                  correct
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                )}
              >
                {correct ? (
                  <>
                    <CheckCircle2 size={15} className="mr-1.5 inline -mt-0.5" /> সঠিক!{" "}
                    {q.explanation ? "" : "দারুণ।"}
                  </>
                ) : (
                  <>
                    <XCircle size={15} className="mr-1.5 inline -mt-0.5" /> সঠিক উত্তর{" "}
                    <span className="font-semibold">
                      {keyIndex >= 0 ? optionLabel(q.prompt, keyIndex) : "—"}
                    </span>
                    {keyIndex >= 0 && <> — <span className="font-medium">{opts[keyIndex]}</span></>}
                  </>
                )}
              </div>

              {q.explanation && (
                <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-sm text-slate-300">
                  <Lightbulb size={14} className="mr-1.5 inline -mt-0.5 text-indigo-300" />
                  {q.explanation}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={next}>
                  {idx + 1 >= questions.length ? "ফলাফল দেখুন" : "পরবর্তী"} <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
