import { useEffect, useState } from "react";
import { CheckCircle2, Flag, MessageSquare, XCircle } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { optionLabel, sourcePage } from "../lib/labels";
import { useAuth } from "../lib/auth-context";
import { Badge, Button, Card, Input, Textarea } from "../components/ui";
import { useToast } from "../components/Toast";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  accepted: "Accepted",
  rejected: "Rejected",
};

const STATUS_CLASS: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  accepted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function statusBadge(status: string) {
  return <Badge className={STATUS_CLASS[status] || STATUS_CLASS.open}>{STATUS_LABEL[status] || status}</Badge>;
}

const when = (value: any) => (value ? new Date(value).toLocaleString() : "");

/**
 * One page for both sides of a challenge: students read their own history and
 * the teacher's reply; staff get the inbox and resolve items.
 */
export default function Challenges() {
  const { user } = useAuth();
  const toast = useToast();
  const isStaff = user?.role === "admin" || user?.role === "teacher";

  const [challenges, setChallenges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async (statusValue = status, searchValue = search) => {
    setLoading(true);
    setError("");
    try {
      if (isStaff) {
        const qs = new URLSearchParams();
        if (statusValue) qs.set("status", statusValue);
        if (searchValue.trim()) qs.set("q", searchValue.trim());
        const { data } = await api.get(`/challenges?${qs.toString()}`);
        setChallenges(data.challenges || []);
      } else {
        const { data } = await api.get("/challenges/mine");
        setChallenges(data.challenges || []);
      }
    } catch (err: any) {
      setError(errorMessage(err, "Could not load challenges."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isStaff) {
      void load();
      return;
    }
    // Typing in the search box should not fire a request per keystroke.
    const t = setTimeout(() => { void load(status, search); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, status, search]);

  const resolve = async (id: string, next: "accepted" | "rejected") => {
    setSaving(id);
    try {
      await api.put(`/challenges/${id}`, { status: next, reply: replies[id] || "" });
      toast.success(next === "accepted" ? "Challenge accepted." : "Challenge rejected.");
      await load();
    } catch (err: any) {
      toast.error(errorMessage(err, "Could not resolve that challenge."));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Flag size={20} className="text-rose-300" /> Challenges
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {isStaff
              ? "Questions students believe are wrong. Answer them here; changing a key or a score stays manual."
              : "প্রশ্নের উত্তর নিয়ে আপনার আপত্তি এবং শিক্ষকের উত্তর এখানে দেখুন।"}
          </p>
        </div>
        {isStaff && <div className="text-xs text-slate-500">{challenges.length} shown</div>}
      </div>

      {isStaff && (
        <Card hover={false} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => (
              <Button
                key={s.value}
                variant={status === s.value ? "primary" : "outline"}
                className="px-3 py-1.5 text-xs"
                onClick={() => setStatus(s.value)}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <Input
            placeholder="Search student, question or exam"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Card>
      )}

      {error && <Card hover={false} className="border border-rose-500/40 text-sm text-rose-200">{error}</Card>}

      {loading ? (
        <Card hover={false} className="text-sm text-slate-400">Loading…</Card>
      ) : challenges.length === 0 ? (
        <Card hover={false} className="text-sm text-slate-400">
          {isStaff
            ? status === "open"
              ? "No open challenges."
              : "No challenges match these filters."
            : "আপনি এখনো কোনো প্রশ্ন চ্যালেঞ্জ করেননি।"}
        </Card>
      ) : isStaff ? (
        <div className="space-y-3">
          {challenges.map((c) => {
            const page = sourcePage(c);
            const options: string[] = Array.isArray(c.question_options) ? c.question_options : [];
            return (
              <Card key={c.id} hover={false} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {c.student_name}
                      {c.student_email && <span className="ml-2 text-xs font-normal text-slate-500">{c.student_email}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.exam_title || "Standalone practice"} · {when(c.created_at)}
                    </div>
                  </div>
                  {statusBadge(c.status)}
                </div>

                <div>
                  <div className="text-sm">{c.question_prompt}</div>
                  {page && <div className="mt-0.5 text-[11px] text-cyan-300/80">বইয়ের পৃষ্ঠা {page}</div>}
                </div>

                {options.length > 0 && (
                  <div className="space-y-1">
                    {options.map((o, i) => {
                      const key = c.question_answer != null &&
                        String(o).trim().toLowerCase() === String(c.question_answer).trim().toLowerCase();
                      return (
                        <div
                          key={i}
                          className={
                            key
                              ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300"
                              : "rounded-lg border border-slate-700/40 px-2.5 py-1.5 text-xs text-slate-400"
                          }
                        >
                          <span className="mr-1.5 opacity-70">{optionLabel(c.question_prompt, i)}.</span>
                          {o}
                          {key && <span className="ml-2 text-[10px] uppercase tracking-wide">Key</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {c.question_explanation && (
                  <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-2.5 py-1.5 text-xs text-slate-300">
                    <span className="font-medium text-indigo-200">Explanation:</span> {c.question_explanation}
                  </div>
                )}

                <div className="rounded-xl border border-slate-700/50 bg-ink/5 px-3 py-2 text-xs text-slate-300">
                  <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                    <MessageSquare size={12} /> {c.student_name}'s reason
                  </div>
                  {c.message}
                </div>

                {c.status === "open" ? (
                  <div className="space-y-2">
                    <Textarea
                      rows={2}
                      placeholder="Reply (optional)"
                      value={replies[c.id] ?? ""}
                      onChange={(e) => setReplies((r) => ({ ...r, [c.id]: e.target.value }))}
                      maxLength={2000}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => resolve(c.id, "accepted")} disabled={saving === c.id}>
                        <CheckCircle2 size={14} /> Accept
                      </Button>
                      <Button variant="outline" onClick={() => resolve(c.id, "rejected")} disabled={saving === c.id}>
                        <XCircle size={14} /> Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  c.reply && (
                    <div className="text-xs text-slate-300">
                      <span className="font-medium text-slate-200">Your reply:</span> {c.reply}
                    </div>
                  )
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {challenges.map((c) => {
            const page = sourcePage(c);
            return (
              <Card key={c.id} hover={false} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{c.question_prompt}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[page ? `বইয়ের পৃষ্ঠা ${page}` : "", c.exam_title || "স্বাধীন অনুশীলন", when(c.created_at)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {statusBadge(c.status)}
                </div>
                <div className="text-xs text-slate-400">
                  <span className="font-medium text-slate-300">আপনার কারণ:</span> {c.message}
                </div>
                {c.reply && (
                  <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-xs text-slate-300">
                    <span className="font-medium text-indigo-200">শিক্ষকের উত্তর:</span> {c.reply}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
