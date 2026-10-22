import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { optionLabel } from "../lib/labels";
import { useToast } from "../components/Toast";
import { Card, Button, Field, Select, NumberInput, Badge, Input, cn } from "../components/ui";
import { alertDialog, confirmDialog } from "../components/Dialog";
import {
  SpellCheck, Wand2, Upload, Trash2, RotateCcw, Loader2, BookOpen, Sparkles, CheckCircle2,
} from "lucide-react";
import {
  buildSpellingQuestions, SPELLING_BANK_SIZE, SPELLING_TAGS, type GeneratedSpelling,
} from "../lib/banglaSpelling";

/**
 * Bangla spelling MCQ generator.
 *
 * The word bank (with hand-checked misspellings) lives in lib/banglaSpelling;
 * this page only picks a subject/chapter, builds the questions and lets the
 * teacher review them before they hit the bank. Nothing is imported until the
 * "Import" button is pressed, and imported prompts are remembered per subject
 * so the next click produces a fresh set instead of the same 50.
 */

const DEFAULT_CHAPTER = "বানান শুদ্ধকরণ";
const MAX_BATCH = 100;

const usedKey = (subjectId: string) => `mcq_spelling_used_${subjectId || "none"}`;

function readUsed(subjectId: string): string[] {
  try {
    const raw = localStorage.getItem(usedKey(subjectId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeUsed(subjectId: string, prompts: string[]) {
  try {
    // Cap the history: enough to cover several hundred questions, small enough
    // that localStorage never fills up.
    localStorage.setItem(usedKey(subjectId), JSON.stringify(prompts.slice(-5000)));
  } catch {
    /* storage can be unavailable — generation still works */
  }
}

export default function Spelling() {
  const toast = useToast();

  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterTitle, setChapterTitle] = useState(DEFAULT_CHAPTER);

  const [count, setCount] = useState(50);
  const [tag, setTag] = useState("all");
  const [items, setItems] = useState<GeneratedSpelling[]>([]);
  const [busy, setBusy] = useState(false);
  const [importedTotal, setImportedTotal] = useState(0);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    api.get("/subjects")
      .then((r) => setSubjects(r.data.subjects || []))
      .catch((e) => toast.error(errorMessage(e, "সাবজেক্ট লোড হয়নি।")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!subjectId) { setChapters([]); return; }
    api.get(`/subjects/${subjectId}/chapters`)
      .then((r) => setChapters(r.data.chapters || []))
      .catch(() => setChapters([]));
  }, [subjectId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const used = useMemo(() => readUsed(subjectId), [subjectId, historyTick]);

  const generate = (append: boolean) => {
    const wanted = Math.max(1, Math.min(MAX_BATCH, Math.round(count) || 50));
    let exclude = readUsed(subjectId);
    let fresh = buildSpellingQuestions({
      count: wanted,
      seed: Date.now() & 0x7fffffff,
      exclude,
      tag: tag === "all" ? null : tag,
    });

    // The bank ran dry for this subject/filter: offer a clean restart instead of
    // silently repeating the same prompts (which the server would skip anyway).
    if (fresh.length === 0) {
      const restart = window.confirm(
        "এই ফিল্টারে সব শব্দ একবার ব্যবহার হয়ে গেছে।\n\n‘ঠিক আছে’ চাপলে ইতিহাস মুছে আবার প্রথম থেকে নতুন সেট তৈরি হবে।",
      );
      if (!restart) return;
      writeUsed(subjectId, []);
      exclude = [];
      fresh = buildSpellingQuestions({
        count: wanted,
        seed: Date.now() & 0x7fffffff,
        exclude,
        tag: tag === "all" ? null : tag,
      });
    }

    if (fresh.length === 0) {
      toast.error("এই ফিল্টারে কোনো শব্দ পাওয়া যায়নি।");
      return;
    }

    writeUsed(subjectId, [...exclude, ...fresh.map((q) => q.prompt)]);
    setHistoryTick((n) => n + 1);
    setItems(append ? [...items, ...fresh] : fresh);
    if (fresh.length < wanted) {
      toast.info(`${wanted}টির মধ্যে ${fresh.length}টি নতুন প্রশ্ন পাওয়া গেছে — ব্যাংকের শব্দ শেষের দিকে।`);
    } else {
      toast.success(`${fresh.length}টি নতুন প্রশ্ন তৈরি হয়েছে।`);
    }
  };

  const resetHistory = async () => {
    const ok = await confirmDialog({
      title: "ইতিহাস মুছবেন?",
      message: "এই সাবজেক্টের ‘আগে ব্যবহার হয়েছে’ তালিকা মুছে যাবে, ফলে পুরোনো শব্দগুলো আবার নতুন সেটে আসতে পারবে। ব্যাংকে আগের প্রশ্ন থেকে যাবে।",
      confirmLabel: "মুছে ফেলো",
      tone: "danger",
    });
    if (!ok) return;
    writeUsed(subjectId, []);
    setHistoryTick((n) => n + 1);
    toast.success("ইতিহাস মুছে ফেলা হয়েছে।");
  };

  const removeAt = (index: number) => {
    setItems((list) => list.filter((_, i) => i !== index));
  };

  const doImport = async () => {
    if (!subjectId) {
      await alertDialog({ title: "সাবজেক্ট বাছুন", message: "প্রশ্নগুলো কোন সাবজেক্টে যাবে, সেটা আগে বেছে নিন।" });
      return;
    }
    if (items.length === 0) return;

    setBusy(true);
    try {
      const payload = {
        subject_id: subjectId,
        chapter_title: chapterTitle.trim() || undefined,
        skip_duplicates: true,
        questions: items.map(({ tag: _tag, ...q }) => q),
      };
      const { data } = await api.post("/questions/bulk-import", payload);
      const imported = Number(data.imported ?? 0);
      setImportedTotal((n) => n + imported);
      setItems([]);
      await alertDialog({
        title: "ইমপোর্ট সম্পন্ন",
        message:
          `যোগ হয়েছে: ${imported}\n` +
          `ডুপ্লিকেট বাদ: ${data.skipped ?? 0}\n` +
          `ব্যর্থ: ${data.failed ?? 0}` +
          (Array.isArray(data.errors) && data.errors.length
            ? `\n\n${data.errors.slice(0, 5).map((e: any) => `• ${e.error || e.message || e}`).join("\n")}`
            : ""),
      });
      toast.success(`${imported}টি প্রশ্ন ব্যাংকে যোগ হয়েছে।`);
    } catch (e: any) {
      await alertDialog({
        title: "ইমপোর্ট হয়নি",
        message: errorMessage(e, "প্রশ্নগুলো সেভ করা যায়নি।"),
      });
    } finally {
      setBusy(false);
    }
  };

  const chapterOptions = chapters.map((c) => c.title).filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
            <SpellCheck className="text-fuchsia-300" size={24} /> বানান MCQ জেনারেটর
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            নিজেই প্রশ্ন বানায় — কোনো শব্দের তালিকা দিতে হয় না। এক ক্লিকে ৫০টি করে
            নতুন প্রশ্ন, প্রিভিউ দেখে তারপর এক ক্লিকে ব্যাংকে যোগ করুন।
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1">
            <BookOpen size={13} className="text-indigo-300" /> ব্যাংকে {SPELLING_BANK_SIZE}টি শব্দ
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/40 bg-ink/5 px-3 py-1">
            <Sparkles size={13} className="text-fuchsia-300" /> এই সেটে {items.length}টি
          </span>
          {importedTotal > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              <CheckCircle2 size={13} /> ইমপোর্ট হয়েছে
            </span>
          )}
        </div>
      </div>

      <Card hover={false} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="সাবজেক্ট">
            <Select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setItems([]);
              }}
            >
              <option value="">সাবজেক্ট বাছুন</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>

          <Field label="চ্যাপ্টার (না থাকলে নিজেই তৈরি হবে)">
            <Input
              list="spelling-chapters"
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              placeholder={DEFAULT_CHAPTER}
            />
            <datalist id="spelling-chapters">
              {chapterOptions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </Field>

          <Field label="কতটি প্রশ্ন">
            <NumberInput
              min={10}
              max={MAX_BATCH}
              step={10}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </Field>

          <Field label="ভুলের ধরন">
            <Select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="all">সব ধরন</option>
              {SPELLING_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => generate(false)} disabled={!subjectId}>
            <Wand2 size={16} /> {count}টি নতুন প্রশ্ন তৈরি
          </Button>
          <Button variant="outline" onClick={() => generate(true)} disabled={!subjectId || items.length === 0}>
            <Sparkles size={16} /> আরও {count}টি যোগ
          </Button>
          <Button variant="ghost" onClick={resetHistory} disabled={!subjectId}>
            <RotateCcw size={16} /> ইতিহাস রিসেট
          </Button>
          <span className="ml-auto text-xs text-slate-500">
            এখন পর্যন্ত {used.length}টি প্রশ্ন তৈরি হয়েছে
          </span>
        </div>

        {!subjectId && (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            প্রশ্ন তৈরি করতে আগে সাবজেক্ট বাছুন — নাহলে জানা যাবে না প্রশ্নগুলো কোথায় যাবে।
          </p>
        )}
      </Card>

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              প্রিভিউ <span className="text-slate-500">({items.length}টি)</span>
            </h2>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setItems([])} disabled={busy}>
                <Trash2 size={15} /> সব বাদ
              </Button>
              <Button onClick={doImport} disabled={busy || !subjectId}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                ব্যাংকে ইমপোর্ট ({items.length})
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {items.map((q, i) => (
              <Card key={`${q.prompt}-${i}`} hover={false} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-sm font-medium text-slate-100">
                    <span className="mr-1.5 text-slate-500">{i + 1}.</span>
                    {q.prompt}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className="border-slate-600/50 bg-ink/5 text-[11px] text-slate-300">{q.tag}</Badge>
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="rounded-lg p-1 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
                      title="এই প্রশ্নটি বাদ দাও"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid gap-1 sm:grid-cols-2">
                  {q.options.map((o, oi) => {
                    const right = o === q.answer;
                    return (
                      <div
                        key={o + oi}
                        className={cn(
                          "flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm",
                          right
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                            : "border-slate-600/30 text-slate-300",
                        )}
                      >
                        <span className="text-xs opacity-70">{optionLabel(q.prompt, oi)}.</span>
                        <span className="flex-1">{o}</span>
                        {right && <CheckCircle2 size={14} className="text-emerald-400" />}
                      </div>
                    );
                  })}
                </div>

                {q.explanation && (
                  <p className="text-xs leading-relaxed text-slate-400">
                    <span className="text-slate-500">ব্যাখ্যা: </span>{q.explanation}
                  </p>
                )}
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
            <p className="text-xs text-slate-500">
              ইমপোর্টের আগে একবার চোখ বুলিয়ে নিন — সন্দেহ হলে প্রশ্নটি বাদ দিন।
              ডুপ্লিকেট প্রশ্ন সার্ভার নিজেই বাদ দেবে।
            </p>
            <Button onClick={doImport} disabled={busy || !subjectId}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              ব্যাংকে ইমপোর্ট ({items.length})
            </Button>
          </div>
        </>
      )}

      {items.length === 0 && (
        <Card hover={false} className="py-8 text-center">
          <p className="text-sm text-slate-300">এখনো কোনো প্রশ্ন তৈরি হয়নি।</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            সাবজেক্ট বাছুন, তারপর “{count}টি নতুন প্রশ্ন তৈরি” চাপুন। প্রতিটি প্রশ্নে
            চারটি অপশন, একটাই শুদ্ধ বানান আর ব্যাখ্যা থাকবে — Practice পেজে ছাত্ররা
            সাথে সাথে ফিডব্যাক পাবে।
          </p>
          {subjectId && (
            <Button className="mt-4" onClick={() => generate(false)}>
              <Wand2 size={16} /> {count}টি নতুন প্রশ্ন তৈরি
            </Button>
          )}
          <div className="mt-4 text-xs text-slate-500">
            ওয়ার্কশিট ছাপতে চাইলে পরে <Link to="/print" className="text-violet-300 hover:underline">Print Paper</Link> ব্যবহার করুন।
          </div>
        </Card>
      )}
    </div>
  );
}
