import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Card, Button, Skeleton, cn } from "../components/ui";
import {
  Activity, ArrowRight, Award, BookOpen, BookPlus, CalendarDays, ChartColumn, CircleAlert,
  ClipboardList, Clock, FilePlus2, FileQuestion, Flame, GraduationCap, ListChecks, Percent,
  PlayCircle, Printer, RotateCcw, Sparkles, Target, TrendingUp, Trophy, UserPlus, Users,
} from "lucide-react";

/* A pass is 33% or more — the standard NCTB mark. */
const PASS_MARK = 33;

function timeAgo(ts?: number | null) {
  if (!ts) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

/** Percentage of an attempt, or null when it has not been marked yet. */
function percent(score?: number | null, total?: number | null): number | null {
  if (score == null || total == null || total <= 0) return null;
  return Math.round((score / total) * 100);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                       */
/* -------------------------------------------------------------------------- */

function StatTile({ label, value, icon: Icon, tone, hint, loading }: {
  label: string; value: ReactNode; icon: any; tone: string; hint?: string; loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-400">{label}</div>
          {loading ? (
            <Skeleton className="h-8 w-14 mt-2" />
          ) : (
            <div className="text-3xl font-bold mt-1 tabular-nums">{value}</div>
          )}
          {hint && !loading && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
        </div>
        <span className={cn("shrink-0 rounded-xl p-2", tone)}>
          <Icon size={22} className="card-icon" />
        </span>
      </div>
    </Card>
  );
}

function Panel({ title, icon: Icon, action, children, className }: {
  title: string; icon?: any; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          {Icon && <Icon size={16} className="text-indigo-300" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Meter({ label, value, max, tone = "from-indigo-500 to-cyan-400" }: {
  label: string; value: number; max: number; tone?: string;
}) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-slate-300 truncate">{label}</span>
        <span className="text-slate-400 tabular-nums shrink-0">{value}</span>
      </div>
      <div className="h-2 w-full rounded-full meter-track overflow-hidden">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", tone)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint, to, cta }: {
  icon: any; title: string; hint: string; to?: string; cta?: string;
}) {
  const nav = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
      <span className="rounded-2xl bg-ink/5 p-3">
        <Icon size={22} className="text-slate-400" />
      </span>
      <div className="text-sm font-medium text-slate-200">{title}</div>
      <p className="text-xs text-slate-400 max-w-xs">{hint}</p>
      {to && cta && (
        <Button variant="outline" className="mt-2" onClick={() => nav(to)}>
          {cta} <ArrowRight size={14} />
        </Button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    in_progress: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    submitted: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    graded: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  };
  const label: Record<string, string> = {
    in_progress: "In progress",
    submitted: "Submitted",
    graded: "Graded",
  };
  return (
    <span className={cn("inline-block px-2 py-0.5 text-[11px] rounded-full border whitespace-nowrap", map[status] || "bg-ink/5 text-slate-300 border-slate-600/40")}>
      {label[status] || status}
    </span>
  );
}

/** Score chip: green when a pass, rose when below the pass mark. */
function ScoreChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-slate-500">—</span>;
  return (
    <span className={cn(
      "text-sm font-semibold tabular-nums",
      value >= PASS_MARK ? "text-emerald-300" : "text-rose-300",
    )}>
      {value}%
    </span>
  );
}

/** Last 7 days of attempts, as simple bars. */
function ActivityChart({ days }: { days: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const total = days.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div className="flex items-end gap-2 h-28">
        {days.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            <span className="text-[10px] text-slate-400 tabular-nums h-3 leading-3">{d.value || ""}</span>
            <div className="w-full flex-1 flex items-end rounded-md meter-track overflow-hidden">
              <div
                className="w-full rounded-md bg-gradient-to-t from-indigo-500 to-cyan-400 transition-all duration-500"
                style={{ height: `${Math.max(d.value > 0 ? 8 : 0, Math.round((d.value / max) * 100))}%` }}
                title={`${d.label}: ${d.value}`}
              />
            </div>
            <span className="text-[10px] text-slate-500">{d.label}</span>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-400 mt-3">{total} attempt{total === 1 ? "" : "s"} in the last 7 days</div>
    </div>
  );
}

/** Tiny score trend line for the student dashboard. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 34;
  const pad = 4;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const clamped = Math.min(100, Math.max(0, v)) / 100;
      return `${(i * step).toFixed(2)},${(pad + (1 - clamped) * (h - pad * 2)).toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-10 text-indigo-400">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isStudent = user?.role === "student";

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ subjects: any[]; questions: any[]; exams: any[]; users: any[]; attempts: any[] }>({
    subjects: [], questions: [], exams: [], users: [], attempts: [],
  });
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [s, q, e, u, a] = await Promise.all([
          api.get("/subjects"),
          api.get("/questions"),
          api.get("/exams"),
          isStudent ? Promise.resolve({ data: { users: [] } }) : api.get("/users"),
          api.get(isStudent ? "/exams/attempts/mine" : "/exams/attempts"),
        ]);
        if (!alive) return;
        setData({
          subjects: s.data.subjects || [],
          questions: q.data.questions || [],
          exams: e.data.exams || [],
          users: u.data.users || [],
          attempts: a.data.attempts || [],
        });
      } catch {
        /* keep whatever loaded; the empty states explain what to do */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isStudent]);

  const { subjects, questions, exams, users, attempts } = data;

  /* ---------------------------------------------------------------- shared */
  const publishedExams = useMemo(() => exams.filter((e: any) => e.is_published), [exams]);
  const draftExams = useMemo(() => exams.filter((e: any) => !e.is_published), [exams]);
  const examTitle = useMemo(() => {
    const m = new Map<string, string>();
    exams.forEach((e: any) => m.set(e.id, e.title));
    return (id: string) => m.get(id) || `Exam ${String(id).slice(0, 8)}`;
  }, [exams]);

  /* --------------------------------------------------------------- teacher */
  const mix = useMemo(() => {
    const type = { mcq: 0, short: 0, long: 0 };
    const difficulty = { easy: 0, medium: 0, hard: 0 };
    questions.forEach((q: any) => {
      if (q.type in type) type[q.type as keyof typeof type] += 1;
      const d = (q.difficulty || "medium") as keyof typeof difficulty;
      if (d in difficulty) difficulty[d] += 1;
    });
    return { type, difficulty };
  }, [questions]);

  const questionCoverage = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((q: any) => counts.set(q.subject_id, (counts.get(q.subject_id) || 0) + 1));
    return subjects
      .map((s: any) => ({ id: s.id, name: s.name, count: counts.get(s.id) || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [subjects, questions]);

  const teacherStats = useMemo(() => {
    const marked = attempts.filter((a: any) => a.status !== "in_progress");
    const percents = marked.map((a: any) => percent(a.score, a.total) ?? 0);
    return {
      marked: marked.length,
      average: average(percents),
      passRate: marked.length ? Math.round((percents.filter((p) => p >= PASS_MARK).length / marked.length) * 100) : null,
      pending: attempts.filter((a: any) => a.status === "submitted").length,
      active: attempts.filter((a: any) => a.status === "in_progress").length,
    };
  }, [attempts]);

  const activityDays = useMemo(() => {
    const days: Array<{ key: string; label: string; value: number }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ key: d.toDateString(), label: d.toLocaleDateString("en-US", { weekday: "short" }), value: 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    attempts.forEach((a: any) => {
      const hit = byKey.get(new Date(a.started_at).toDateString());
      if (hit) hit.value += 1;
    });
    return days;
  }, [attempts]);

  const recentActivity = useMemo(
    () => [...attempts].sort((a: any, b: any) => b.started_at - a.started_at).slice(0, 6),
    [attempts],
  );

  /* --------------------------------------------------------------- student */
  const studentStats = useMemo(() => {
    const active = attempts.filter((a: any) => a.status === "in_progress");
    const finished = attempts
      .filter((a: any) => a.status !== "in_progress")
      .sort((a: any, b: any) => (a.submitted_at || a.started_at) - (b.submitted_at || b.started_at));
    const percents = finished.map((a: any) => percent(a.score, a.total) ?? 0);
    return {
      active,
      finished: [...finished].reverse(),
      trend: percents,
      average: average(percents),
      best: percents.length ? Math.max(...percents) : null,
    };
  }, [attempts]);

  const latestAttemptByExam = useMemo(() => {
    const m = new Map<string, any>();
    attempts.forEach((a: any) => {
      const prev = m.get(a.exam_id);
      if (!prev || a.started_at > prev.started_at) m.set(a.exam_id, a);
    });
    return m;
  }, [attempts]);

  const startExam = async (examId: string) => {
    setStarting(examId);
    try {
      const { data: res } = await api.post(`/exams/${examId}/start`);
      nav(`/take-exam/${res.attempt.id}`);
    } catch {
      setStarting(null);
    }
  };

  /* ------------------------------------------------------------------ view */
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const firstName = (user?.name || "").split(" ")[0] || user?.name || "";
  const subtitle = isStudent
    ? "Student portal · track your practice and pick up where you left off"
    : "NCTB 2025 · English Version · a live look at your question bank and classes";

  const teacherActions = [
    { label: "New Exam", to: "/exams?new=1", icon: ClipboardList },
    { label: "Add Question", to: "/questions?new=1", icon: FilePlus2 },
    { label: "Add Subject", to: "/subjects", icon: BookPlus },
    { label: "Add Student", to: "/users?new=1", icon: UserPlus },
    { label: "Print Paper", to: "/print", icon: Printer },
  ];

  const tiles = isStudent
    ? [
        { label: "Exams taken", value: studentStats.finished.length, icon: ClipboardList, tone: "bg-cyan-500/15 text-cyan-300", hint: `${publishedExams.length} paper${publishedExams.length === 1 ? "" : "s"} available` },
        { label: "Average score", value: studentStats.average == null ? "—" : `${studentStats.average}%`, icon: Percent, tone: "bg-indigo-500/15 text-indigo-300", hint: studentStats.average == null ? "No results yet" : (studentStats.average >= PASS_MARK ? "Above the pass mark" : "Below the pass mark") },
        { label: "Best score", value: studentStats.best == null ? "—" : `${studentStats.best}%`, icon: Trophy, tone: "bg-amber-500/15 text-amber-300", hint: "Personal best" },
        { label: "In progress", value: studentStats.active.length, icon: Clock, tone: "bg-emerald-500/15 text-emerald-300", hint: studentStats.active.length ? "Waiting to be finished" : "Nothing to resume" },
      ]
    : [
        { label: "Subjects", value: subjects.length, icon: BookOpen, tone: "bg-cyan-500/15 text-cyan-300", hint: `${questions.length} question${questions.length === 1 ? "" : "s"} in the bank` },
        { label: "Questions", value: questions.length, icon: FileQuestion, tone: "bg-indigo-500/15 text-indigo-300", hint: `${mix.type.mcq} MCQ · ${mix.type.short} short · ${mix.type.long} long` },
        { label: "Exams", value: exams.length, icon: ClipboardList, tone: "bg-emerald-500/15 text-emerald-300", hint: `${publishedExams.length} published · ${draftExams.length} draft` },
        { label: "Students", value: users.filter((u: any) => u.role === "student").length, icon: Users, tone: "bg-amber-500/15 text-amber-300", hint: `${users.length} account${users.length === 1 ? "" : "s"} in total` },
      ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{greeting()}, {firstName}</h1>
          <p className="text-slate-400 text-sm">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <CalendarDays size={14} className="text-indigo-300" />
          {today}
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <StatTile key={t.label} {...t} loading={loading} />
        ))}
      </div>

      {isStudent ? (
        <>
          {/* Resume an unfinished paper */}
          {studentStats.active.length > 0 && (
            <Panel title="Pick up where you left off" icon={PlayCircle}>
              <div className="space-y-3">
                {studentStats.active.map((a: any) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{examTitle(a.exam_id)}</div>
                      <div className="text-xs text-slate-400">
                        Started {timeAgo(a.started_at)} · {Object.keys(a.answers || {}).length} answer{Object.keys(a.answers || {}).length === 1 ? "" : "s"} saved
                      </div>
                    </div>
                    <Button onClick={() => nav(`/take-exam/${a.id}`)}>
                      <RotateCcw size={15} /> Continue
                    </Button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Available exams */}
            <Panel
              title="Available exams"
              icon={ClipboardList}
              action={<Link to="/exams" className="text-xs text-indigo-300 hover:underline">View all</Link>}
            >
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : publishedExams.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="No exams published yet"
                  hint="Once your teacher publishes a paper it will show up here, ready to start."
                />
              ) : (
                <div className="space-y-2">
                  {publishedExams.slice(0, 5).map((e: any) => {
                    const last = latestAttemptByExam.get(e.id);
                    const active = last?.status === "in_progress";
                    const done = last && !active;
                    return (
                      <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-600/40 px-4 py-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{e.title}</div>
                          <div className="text-xs text-slate-400">
                            {e.total_marks} marks · {e.duration_minutes} min
                            {done && <> · scored <ScoreChip value={percent(last.score, last.total)} /></>}
                          </div>
                        </div>
                        {active ? (
                          <Button onClick={() => nav(`/take-exam/${last.id}`)}>
                            <RotateCcw size={15} /> Continue
                          </Button>
                        ) : (
                          <Button
                            variant={done ? "outline" : "primary"}
                            disabled={starting === e.id}
                            onClick={() => startExam(e.id)}
                          >
                            <PlayCircle size={15} /> {starting === e.id ? "Starting…" : done ? "Retake" : "Start"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* My progress */}
            <Panel
              title="My progress"
              icon={TrendingUp}
              action={<Link to="/results" className="text-xs text-indigo-300 hover:underline">All results</Link>}
            >
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : studentStats.finished.length === 0 ? (
                <EmptyState
                  icon={Target}
                  title="No results yet"
                  hint="Finish an exam and your score, average and best mark will appear right here."
                  to="/exams"
                  cta="Browse exams"
                />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Average", value: studentStats.average == null ? "—" : `${studentStats.average}%`, icon: Percent },
                      { label: "Best", value: studentStats.best == null ? "—" : `${studentStats.best}%`, icon: Trophy },
                      { label: "Passed", value: `${studentStats.finished.filter((a: any) => (percent(a.score, a.total) ?? 0) >= PASS_MARK).length}/${studentStats.finished.length}`, icon: Award },
                    ].map((m) => (
                      <div key={m.label} className="rounded-2xl bg-ink/5 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <m.icon size={12} className="text-indigo-300" /> {m.label}
                        </div>
                        <div className="text-lg font-semibold tabular-nums mt-0.5">{m.value}</div>
                      </div>
                    ))}
                  </div>

                  {studentStats.trend.length > 1 && (
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Score trend (oldest → newest)</div>
                      <Sparkline values={studentStats.trend} />
                    </div>
                  )}

                  <div className="space-y-2">
                    {studentStats.finished.slice(0, 5).map((a: any) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-600/40 px-4 py-2.5">
                        <div className="min-w-0">
                          <div className="text-sm truncate">{examTitle(a.exam_id)}</div>
                          <div className="text-[11px] text-slate-400">
                            <Clock size={11} className="inline -mt-0.5" /> {timeAgo(a.submitted_at || a.started_at)} <StatusPill status={a.status} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <ScoreChip value={percent(a.score, a.total)} />
                          <div className="text-[11px] text-slate-500 tabular-nums">{a.score ?? 0}/{a.total ?? 0}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </>
      ) : (
        <>
          {/* Quick actions */}
          <Panel title="Quick actions" icon={Sparkles}>
            <div className="flex flex-wrap gap-2">
              {teacherActions.map((a) => (
                <Button key={a.label} variant="outline" className="whitespace-nowrap" onClick={() => nav(a.to)}>
                  <a.icon size={15} /> {a.label}
                </Button>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* Coverage per subject */}
            <Panel
              title="Questions per subject"
              icon={ChartColumn}
              action={<Link to="/questions" className="text-xs text-indigo-300 hover:underline">Question bank</Link>}
            >
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : questionCoverage.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No subjects yet"
                  hint="Create your first subject, then start filling it with questions chapter by chapter."
                  to="/subjects"
                  cta="Add a subject"
                />
              ) : (
                <div className="space-y-3">
                  {questionCoverage.slice(0, 8).map((s) => (
                    <Meter
                      key={s.id}
                      label={s.name}
                      value={s.count}
                      max={Math.max(1, ...questionCoverage.map((c) => c.count))}
                      tone={s.count === 0 ? "from-rose-500 to-pink-500" : "from-indigo-500 to-cyan-400"}
                    />
                  ))}
                  {questionCoverage.some((s) => s.count === 0) && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
                      <CircleAlert size={12} className="text-rose-300" />
                      {questionCoverage.filter((s) => s.count === 0).length} subject(s) still have no questions.
                    </p>
                  )}
                </div>
              )}
            </Panel>

            {/* Question mix */}
            <Panel
              title="Question bank mix"
              icon={ListChecks}
              action={<span className="text-xs text-slate-400">{questions.length} total</span>}
            >
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : questions.length === 0 ? (
                <EmptyState
                  icon={FileQuestion}
                  title="The bank is empty"
                  hint="Add MCQ, short and long questions — the mix here helps you keep papers balanced."
                  to="/questions?new=1"
                  cta="Add a question"
                />
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">By type</div>
                    {[
                      { label: "MCQ", value: mix.type.mcq, tone: "from-indigo-500 to-cyan-400" },
                      { label: "Short", value: mix.type.short, tone: "from-indigo-500 to-cyan-400" },
                      { label: "Long", value: mix.type.long, tone: "from-indigo-500 to-cyan-400" },
                    ].map((r) => (
                      <Meter key={r.label} label={r.label} value={r.value} max={Math.max(1, questions.length)} tone={r.tone} />
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">By difficulty</div>
                    {[
                      { label: "Easy", value: mix.difficulty.easy, tone: "from-emerald-500 to-emerald-400" },
                      { label: "Medium", value: mix.difficulty.medium, tone: "from-amber-500 to-amber-300" },
                      { label: "Hard", value: mix.difficulty.hard, tone: "from-rose-500 to-pink-500" },
                    ].map((r) => (
                      <Meter key={r.label} label={r.label} value={r.value} max={Math.max(1, questions.length)} tone={r.tone} />
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {/* Recent attempts */}
            <Panel
              title="Recent activity"
              icon={Activity}
              className="xl:col-span-2"
              action={<Link to="/results" className="text-xs text-indigo-300 hover:underline">All results</Link>}
            >
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : recentActivity.length === 0 ? (
                <EmptyState
                  icon={GraduationCap}
                  title="No attempts yet"
                  hint="As soon as students start your published exams their attempts will show up here."
                  to="/exams"
                  cta="Go to exams"
                />
              ) : (
                <div className="-mx-2">
                  {recentActivity.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-ink/5 transition">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-white text-xs font-semibold flex items-center justify-center">
                          {String(a.student_name || "?").trim().charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm truncate">
                            <span className="font-medium">{a.student_name}</span>
                            <span className="text-slate-400"> · {a.exam_title || examTitle(a.exam_id)}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2">
                            <Clock size={11} /> {timeAgo(a.started_at)} <StatusPill status={a.status} />
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <ScoreChip value={percent(a.score, a.total)} />
                        <div className="text-[11px] text-slate-500 tabular-nums">{a.score ?? 0}/{a.total ?? 0}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Performance + weekly chart */}
            <div className="space-y-4">
              <Panel title="Class snapshot" icon={Target}>
                {loading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : teacherStats.marked === 0 ? (
                  <p className="text-xs text-slate-400">No marked attempts yet — averages, pass rate and grading load will appear here.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-ink/5 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Percent size={12} className="text-indigo-300" /> Average</div>
                      <div className="text-xl font-semibold tabular-nums mt-0.5">{teacherStats.average}%</div>
                    </div>
                    <div className="rounded-2xl bg-ink/5 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Flame size={12} className="text-indigo-300" /> Pass rate</div>
                      <div className="text-xl font-semibold tabular-nums mt-0.5">{teacherStats.passRate}%</div>
                    </div>
                    <div className="rounded-2xl bg-ink/5 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><GraduationCap size={12} className="text-indigo-300" /> Marked</div>
                      <div className="text-xl font-semibold tabular-nums mt-0.5">{teacherStats.marked}</div>
                    </div>
                    <div className="rounded-2xl bg-ink/5 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><CircleAlert size={12} className="text-indigo-300" /> To grade</div>
                      <div className="text-xl font-semibold tabular-nums mt-0.5">{teacherStats.pending}</div>
                    </div>
                  </div>
                )}
                {!loading && teacherStats.pending > 0 && (
                  <p className="text-[11px] text-amber-300 mt-3 flex items-center gap-1.5">
                    <CircleAlert size={12} /> {teacherStats.pending} attempt(s) waiting for manual grading.
                  </p>
                )}
                {!loading && teacherStats.active > 0 && (
                  <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5">
                    <Clock size={12} /> {teacherStats.active} attempt(s) in progress right now.
                  </p>
                )}
              </Panel>

              <Panel title="Last 7 days" icon={TrendingUp}>
                {loading ? (
                  <Skeleton className="h-28 w-full" />
                ) : (
                  <ActivityChart days={activityDays} />
                )}
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
