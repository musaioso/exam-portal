import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Badge, Button, Card, Skeleton, cn } from "../components/ui";
import {
  Award, BookOpen, Check, ClipboardList, Copy, Eye, EyeOff, Flame, GraduationCap, LogOut,
  Percent, Trophy,
} from "lucide-react";
import { badges as badgeDefs, streakDays, subjectBreakdown } from "../lib/progress";

const initials = (name?: string) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join("") || "?";

const since = (ts?: number | null) =>
  ts ? new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * "My account": who you are, the PIN you sign in with, and the progress made so
 * far. Students get the whole picture; a teacher just gets their card.
 */
export default function Profile() {
  const { user, logout } = useAuth();
  const isStudent = user?.role === "student";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [board, setBoard] = useState<{ me: any; total: number } | null>(null);

  const [showPin, setShowPin] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const meRes = await api.get("/me");
        if (!alive) return;
        setMe(meRes.data.user);

        if (isStudent) {
          const [at, s, e, b] = await Promise.all([
            api.get("/exams/attempts/mine"),
            api.get("/subjects"),
            api.get("/exams"),
            api.get("/exams/leaderboard"),
          ]);
          if (!alive) return;
          setAttempts(at.data.attempts || []);
          setSubjects(s.data.subjects || []);
          setExams(e.data.exams || []);
          setBoard(b.data);
        }
      } catch {
        if (alive) setError("তথ্য আনা যায়নি — একটু পরে আবার চেষ্টা করুন।");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isStudent]);

  const copyPin = async () => {
    if (!me?.pin) return;
    try {
      await navigator.clipboard.writeText(String(me.pin));
      setCopied("pin");
      setTimeout(() => setCopied(""), 1600);
    } catch {
      /* clipboard blocked — the PIN is visible on screen anyway */
    }
  };

  if (loading)
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  if (error)
    return (
      <div className="max-w-3xl mx-auto">
        <Card hover={false} className="text-center py-10 text-sm text-slate-400">{error}</Card>
      </div>
    );

  const finished = attempts.filter(a => a.status !== "in_progress" && Number(a.total) > 0);
  const percents = finished.map(a => (Number(a.score) / Number(a.total)) * 100);
  const average = percents.length ? Math.round(percents.reduce((s, p) => s + p, 0) / percents.length) : null;
  const best = percents.length ? Math.round(Math.max(...percents)) : null;
  const streak = streakDays(attempts);
  const badgeList = badgeDefs({ attempts, streak, passed: percents.filter(p => p >= 33).length });
  const badgeEarned = badgeList.filter(b => b.earned).length;
  const subjectStats = subjectBreakdown(attempts, exams, subjects);

  const stats = isStudent
    ? [
        { label: "পরীক্ষা", value: attempts.length, icon: ClipboardList, tone: "text-cyan-300" },
        { label: "গড়", value: average == null ? "—" : `${average}%`, icon: Percent, tone: "text-indigo-300" },
        { label: "সেরা", value: best == null ? "—" : `${best}%`, icon: Trophy, tone: "text-amber-300" },
        { label: "স্ট্রিক", value: `${streak} দিন`, icon: Flame, tone: "text-rose-300" },
      ]
    : [];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Who you are */}
      <Card hover={false} className="!p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-indigo-500/15 text-2xl font-bold text-indigo-200">
            {initials(me?.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold truncate">{me?.name || "—"}</h1>
              <Badge
                className={
                  me?.role === "student"
                    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                    : "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                }
              >
                {me?.role === "student" ? "ছাত্র" : me?.role === "teacher" ? "শিক্ষক" : "অ্যাডমিন"}
              </Badge>
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {me?.email}
              {me?.grade || me?.section ? (
                <>
                  {" · "}
                  ক্লাস {me.grade || "—"}
                  {me.section ? ` · সেকশন ${me.section}` : ""}
                </>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">যোগ দিয়েছেন {since(me?.created_at)}</div>
          </div>
          <Button variant="outline" onClick={logout} className="shrink-0">
            <LogOut size={15} /> লগআউট
          </Button>
        </div>
      </Card>

      {isStudent && (
        <>
          {/* The PIN they sign in with */}
          <Card hover={false} className="!p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">সাইন-ইন PIN</div>
                <p className="text-xs text-slate-400">এই পিন দিয়েই আপনি লগইন করেন — কাউকে দেবেন না।</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-2xl border border-slate-600/50 bg-ink/5 px-4 py-2 font-mono text-lg tracking-[0.3em]">
                  {showPin ? (me?.pin ?? "—") : "••••"}
                </div>
                <Button variant="ghost" onClick={() => setShowPin(v => !v)} title={showPin ? "লুকান" : "দেখুন"}>
                  {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </Button>
                <Button variant="ghost" onClick={copyPin} title="কপি করুন">
                  {copied === "pin" ? <Check size={16} className="text-emerald-300" /> : <Copy size={16} />}
                </Button>
              </div>
            </div>
          </Card>

          {/* Numbers */}
          {stats.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map(s => (
                <div key={s.label} className="rounded-2xl border border-slate-600/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <s.icon size={12} className={s.tone} /> {s.label}
                  </div>
                  <div className="mt-0.5 text-xl font-semibold tabular-nums">{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Badges */}
          <Card hover={false} className="!p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">ব্যাজ</div>
              <div className="text-xs text-slate-400 tabular-nums">{badgeEarned}/{badgeList.length}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {badgeList.map(b => (
                <div
                  key={b.id}
                  title={b.hint}
                  className={cn(
                    "rounded-2xl border px-2 py-3 text-center",
                    b.earned ? "border-amber-500/35 bg-amber-500/10" : "border-slate-600/40 opacity-45"
                  )}
                >
                  <b.icon size={18} className={cn("mx-auto", b.earned ? "text-amber-300" : "text-slate-400")} />
                  <div className="mt-1 text-[11px] leading-tight">{b.label}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Per subject */}
          <Card hover={false} className="!p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BookOpen size={15} className="text-indigo-300" /> বিষয়ভিত্তিক ফলাফল
              </div>
              {board?.me && (
                <Link to="/dashboard" className="text-xs text-indigo-300 hover:underline">
                  র‍্যাংক #{board.me.rank}
                </Link>
              )}
            </div>
            {subjectStats.length === 0 ? (
              <p className="text-sm text-slate-400">এখনো কোনো পরীক্ষার ফলাফল নেই।</p>
            ) : (
              <div className="space-y-2.5">
                {subjectStats.map(s => (
                  <div key={s.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-300">
                        {s.average}% <span className="text-[11px] text-slate-500">· {s.attempts}×</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-700/50 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          s.average >= 80 ? "bg-emerald-400" : s.average >= 50 ? "bg-amber-500" : "bg-rose-400"
                        )}
                        style={{ width: `${Math.max(3, s.average)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {finished.length > 0 && (
            <div className="text-center text-xs text-slate-500">
              <GraduationCap size={13} className="mr-1 inline -mt-0.5" />
              সব ফলাফল দেখতে{" "}
              <Link to="/results" className="text-indigo-300 hover:underline">
                Results
              </Link>
              {" · "}
              <Award size={13} className="mx-1 inline -mt-0.5" />
              ভুলগুলো আবার করতে Results থেকে যেকোনো পরীক্ষার রিভিউতে যান।
            </div>
          )}
        </>
      )}
    </div>
  );
}
