import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import { Card, Button, Field, Select, NumberInput, Badge, Input, cn } from "../components/ui";
import {
  PenLine, Wand2, RotateCcw, CheckCircle2, AlertCircle, X, BookOpen, Sparkles,
} from "lucide-react";
import {
  buildProofreadingPassage, normalizeText, PROOF_SENTENCE_COUNT, PROOF_TAGS,
  type ProofPassage, type ProofToken,
} from "../lib/proofreading";

/**
 * Proofreading (বানান শোধন) — passage-based spelling practice.
 *
 * A passage is generated from the curated spelling bank: a few sentences, each
 * containing one deliberately misspelled word. The student reads, clicks the
 * words they believe are wrong and types the correct form. Grading is instant
 * and local, so it works as self-practice without a teacher in the room.
 */

type TokenStatus = "neutral" | "selected" | "correct" | "wrong-spelling" | "missed" | "false-positive";

export default function Proofreading() {
  const toast = useToast();

  const [passage, setPassage] = useState<ProofPassage | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [corrections, setCorrections] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const [count, setCount] = useState(5);
  const [tag, setTag] = useState("all");

  const generate = () => {
    const p = buildProofreadingPassage({
      sentenceCount: count,
      seed: Date.now() & 0x7fffffff,
      tag: tag === "all" ? null : tag,
    });
    setPassage(p);
    setSelected(new Set());
    setCorrections({});
    setSubmitted(false);
    toast.success(`${p.wrongCount}টি ভুল লুকানো আছে — খুঁজে বের করুন।`);
  };

  // First passage on mount.
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: number) => {
    if (submitted) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setCorrections((c) => {
          const { [id]: _, ...rest } = c;
          return rest;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const statusOf = (t: ProofToken): TokenStatus => {
    if (!submitted) return selected.has(t.id) ? "selected" : "neutral";
    if (t.isWrong) {
      if (!selected.has(t.id)) return "missed";
      const corr = normalizeText(corrections[t.id] || "");
      return corr === normalizeText(t.correct || "") ? "correct" : "wrong-spelling";
    }
    return selected.has(t.id) ? "false-positive" : "neutral";
  };

  const result = useMemo(() => {
    if (!passage || !submitted) return null;
    const wrongTokens = passage.tokens.filter((t) => t.isWrong);
    let correct = 0;
    let wrongSpelling = 0;
    let missed = 0;
    let falsePos = 0;
    for (const t of passage.tokens) {
      const sel = selected.has(t.id);
      if (t.isWrong) {
        if (!sel) missed++;
        else if (normalizeText(corrections[t.id] || "") === normalizeText(t.correct || "")) correct++;
        else wrongSpelling++;
      } else if (sel) {
        falsePos++;
      }
    }
    const total = wrongTokens.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 100;
    return { correct, wrongSpelling, missed, falsePos, total, pct };
  }, [passage, submitted, selected, corrections]);

  const submit = () => {
    if (!passage) return;
    if (selected.size === 0) {
      // Allow submitting with nothing selected — shows all as missed.
    }
    setSubmitted(true);
  };

  const reset = () => {
    if (!passage) return;
    setSelected(new Set());
    setCorrections({});
    setSubmitted(false);
  };

  const tokenClass = (status: TokenStatus) => {
    const base = "cursor-pointer rounded px-0.5 transition-colors";
    switch (status) {
      case "selected":
        return cn(base, "bg-indigo-500/30 text-indigo-100 ring-1 ring-indigo-400/60");
      case "correct":
        return cn(base, "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/50");
      case "wrong-spelling":
        return cn(base, "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50");
      case "missed":
        return cn(base, "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/50 underline decoration-rose-400");
      case "false-positive":
        return cn(base, "bg-rose-500/30 text-rose-100 line-through");
      default:
        return cn(base, "hover:bg-ink/10");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
            <PenLine className="text-fuchsia-300" size={24} /> বানান শোধন (Proofreading)
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            প্যাসেজটা পড়ুন, ভুল বানানের শব্দগুলো চিহ্নিত করুন আর শুদ্ধ বানান লিখুন।
            নম্বর নেই — প্রতিদিনের অনুশীলনের জন্য।
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1">
            <BookOpen size={13} className="text-indigo-300" /> {PROOF_SENTENCE_COUNT}টি বাক্য
          </span>
          {passage && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1">
              <Sparkles size={13} className="text-fuchsia-300" /> {passage.wrongCount}টি ভুল লুকানো
            </span>
          )}
        </div>
      </div>

      <Card hover={false} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="কতটি বাক্য">
            <NumberInput
              min={3}
              max={8}
              step={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={submitted}
            />
          </Field>
          <Field label="ভুলের ধরন">
            <Select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={submitted}
            >
              <option value="all">সব ধরন</option>
              {PROOF_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="কাজ">
            <div className="flex gap-2">
              <Button onClick={generate} disabled={submitted}>
                <Wand2 size={16} /> নতুন প্যাসেজ
              </Button>
              <Button variant="ghost" onClick={reset} disabled={submitted || selected.size === 0}>
                <RotateCcw size={16} /> রিসেট
              </Button>
            </div>
          </Field>
        </div>
        {!submitted && (
          <p className="text-xs text-slate-500">
            নির্দেশনা: প্যাসেজের ভুল মনে হওয়া শব্দে ক্লিক করুন (নীল হাইলাইট), তারপর নিচে শুদ্ধ বানান লিখুন।
            সব শেষে “জমা দিন” চাপুন।
          </p>
        )}
      </Card>

      {passage && (
        <Card hover={false} className="space-y-4">
          <div className="leading-loose text-base text-slate-100">
            {passage.tokens.map((t) => (
              <span
                key={t.id}
                onClick={() => toggle(t.id)}
                className={tokenClass(statusOf(t))}
                title={submitted && t.isWrong ? t.correct || "" : undefined}
              >
                {t.text}{" "}
              </span>
            ))}
          </div>

          {selected.size > 0 && !submitted && (
            <div className="space-y-2 rounded-2xl border border-slate-600/40 bg-ink/5 p-3">
              <p className="text-xs font-semibold text-slate-300">চিহ্নিত শব্দগুলোর শুদ্ধ বানান লিখুন:</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {passage.tokens
                  .filter((t) => selected.has(t.id))
                  .map((t) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="min-w-[80px] truncate text-sm text-slate-300">{t.text}</span>
                      <span className="text-slate-500">→</span>
                      <Input
                        value={corrections[t.id] || ""}
                        onChange={(e) => setCorrections((c) => ({ ...c, [t.id]: e.target.value }))}
                        placeholder="শুদ্ধ বানান"
                        className="flex-1"
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {!submitted && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submit}>
                <CheckCircle2 size={16} /> জমা দিন
              </Button>
              <span className="text-xs text-slate-500">
                চিহ্নিত: {selected.size}টি
              </span>
            </div>
          )}
        </Card>
      )}

      {submitted && result && passage && (
        <Card hover={false} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-100">ফলাফল</h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                সঠিক: {result.correct}/{result.total}
              </span>
              {result.wrongSpelling > 0 && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-300">
                  বানান ভুল: {result.wrongSpelling}
                </span>
              )}
              {result.missed > 0 && (
                <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-300">
                  মিস: {result.missed}
                </span>
              )}
              {result.falsePos > 0 && (
                <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-300">
                  ভুল চিহ্ন: {result.falsePos}
                </span>
              )}
              <span className="rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1 text-slate-300">
                স্কোর: {result.pct}%
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {passage.tokens
              .filter((t) => t.isWrong)
              .map((t) => {
                const sel = selected.has(t.id);
                const corr = normalizeText(corrections[t.id] || "");
                const spellingOk = corr === normalizeText(t.correct || "");
                const status = !sel ? "missed" : spellingOk ? "correct" : "wrong-spelling";
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "rounded-2xl border p-3 text-sm",
                      status === "correct" && "border-emerald-500/30 bg-emerald-500/5",
                      status === "wrong-spelling" && "border-amber-500/30 bg-amber-500/5",
                      status === "missed" && "border-rose-500/30 bg-rose-500/5",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {status === "correct" && <CheckCircle2 size={15} className="text-emerald-400" />}
                      {status === "wrong-spelling" && <AlertCircle size={15} className="text-amber-400" />}
                      {status === "missed" && <X size={15} className="text-rose-400" />}
                      <span className="font-medium text-slate-200">
                        ভুল: <span className="text-rose-300">{t.wrong}</span>
                      </span>
                      <span className="text-slate-500">→</span>
                      <span className="text-emerald-300">শুদ্ধ: {t.correct}</span>
                      {sel && !spellingOk && (
                        <span className="text-amber-300">(আপনি লিখেছেন: {corrections[t.id] || "—"})</span>
                      )}
                    </div>
                    {t.explanation && (
                      <p className="mt-1 text-xs text-slate-400">{t.explanation}</p>
                    )}
                  </div>
                );
              })}

            {result.falsePos > 0 && (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">
                <X size={15} className="mr-1 inline text-rose-400" />
                {result.falsePos}টি শব্দ আপনি ভুল বলেছেন, কিন্তু সেগুলো আসলে শুদ্ধ ছিল।
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => { setSubmitted(false); setSelected(new Set()); setCorrections({}); }}>
              <RotateCcw size={16} /> আবার চেষ্টা
            </Button>
            <Button variant="outline" onClick={generate}>
              <Wand2 size={16} /> নতুন প্যাসেজ
            </Button>
            <Link to="/practice/standalone" className="ml-auto text-xs text-violet-300 hover:underline self-center">
              MCQ অনুশীলনে যান →
            </Link>
          </div>
        </Card>
      )}

      {!passage && (
        <Card hover={false} className="py-8 text-center">
          <p className="text-sm text-slate-300">প্যাসেজ তৈরি হচ্ছে…</p>
        </Card>
      )}
    </div>
  );
}
