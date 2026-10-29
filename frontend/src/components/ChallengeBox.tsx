import { useState } from "react";
import { CheckCircle2, Flag, MessageSquare, XCircle } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, Textarea } from "./ui";
import { useToast } from "./Toast";

export type ChallengeInfo = {
  id: string;
  status: "open" | "accepted" | "rejected";
  message?: string | null;
  reply?: string | null;
};

const STATUS_LABEL: Record<ChallengeInfo["status"], string> = {
  open: "পর্যালোচনার অপেক্ষায়",
  accepted: "গৃহীত",
  rejected: "প্রত্যাখ্যাত",
};

const STATUS_CLASS: Record<ChallengeInfo["status"], string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  accepted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

/**
 * Inline "something is wrong with this answer" form. The same component sits in
 * exam review, missed-question practice and standalone practice; once a
 * challenge exists it shows its status (and the teacher's reply) instead of a
 * second form.
 */
export function ChallengeBox({
  questionId,
  attemptId,
  existing,
  onSubmitted,
}: {
  questionId: string;
  attemptId?: string;
  existing?: ChallengeInfo | null;
  onSubmitted?: (challenge: ChallengeInfo) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState<ChallengeInfo | null>(existing ?? null);

  if (current) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-ink/5 px-3 py-2 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <MessageSquare size={13} className="text-slate-400" />
          <span className="text-slate-400">আপনার চ্যালেঞ্জ</span>
          <Badge className={STATUS_CLASS[current.status]}>{STATUS_LABEL[current.status]}</Badge>
        </div>
        {current.message && <div className="text-slate-400">{current.message}</div>}
        {current.reply && (
          <div className="text-slate-300">
            <span className="font-medium text-slate-200">শিক্ষকের উত্তর:</span> {current.reply}
          </div>
        )}
      </div>
    );
  }

  const submit = async () => {
    const text = message.trim();
    if (!text) {
      toast.error("কারণ লিখুন।");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/challenges", {
        question_id: questionId,
        attempt_id: attemptId,
        message: text,
      });
      setCurrent(data.challenge);
      setOpen(false);
      toast.success("আপনার চ্যালেঞ্জ জমা হয়েছে।");
      onSubmitted?.(data.challenge);
    } catch (err: any) {
      const found = err?.response?.data?.challenge;
      if (err?.response?.status === 409 && found) {
        setCurrent(found);
        setOpen(false);
        toast.info("এই প্রশ্নটি আগেই চ্যালেঞ্জ করা হয়েছে।");
      } else {
        toast.error(errorMessage(err, "চ্যালেঞ্জ জমা করা যায়নি।"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-rose-300"
      >
        <Flag size={12} /> চ্যালেঞ্জ করুন
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
      <div className="text-xs text-slate-300">
        এই প্রশ্নের উত্তরটি ভুল মনে হচ্ছে? কারণ লিখুন — শিক্ষক দেখবেন।
      </div>
      <Textarea
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="কেন উত্তরটি ভুল বা প্রশ্নটি অস্পষ্ট, লিখুন…"
        maxLength={2000}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "পাঠানো হচ্ছে…" : <><CheckCircle2 size={14} /> জমা দিন</>}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
          <XCircle size={14} /> বাতিল
        </Button>
      </div>
    </div>
  );
}
