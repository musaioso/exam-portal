import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { Button, Input, Skeleton, cn } from "../components/ui";
import { AuthField, AuthShell } from "../components/AuthShell";
import {
  ArrowLeft,
  BookOpen,
  CircleAlert,
  Delete as Backspace,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  LogIn,
  Search,
  ShieldCheck,
} from "lucide-react";

/**
 * The three seeded accounts, handy for trying the site out. Each one gets a
 * button so you can jump straight into a role without typing any credentials.
 */
const DEMO = [
  { role: "Admin", blurb: "Full control", email: "admin@mcq.local", password: "admin123", icon: ShieldCheck },
  { role: "Teacher", blurb: "Build papers", email: "teacher@mcq.local", password: "teacher123", icon: GraduationCap },
  { role: "Student", blurb: "Take exams", email: "student@mcq.local", password: "student123", icon: BookOpen },
];

interface Student {
  id: string;
  name: string;
  grade: string | null;
  section: string | null;
}

type Tab = "student" | "staff";

export default function Login() {
  // Students sign in far more often than teachers, so their tab is the default —
  // but once a teacher has used the staff tab we keep that choice.
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("mcq_login_tab") === "staff" ? "staff" : "student"));

  const switchTab = (next: Tab) => {
    setTab(next);
    localStorage.setItem("mcq_login_tab", next);
  };

  return (
    <AuthShell
      top={<RoleTabs tab={tab} onChange={switchTab} />}
      title={tab === "student" ? "নিজের নাম বেছে নিন" : "Welcome back"}
      subtitle={
        tab === "student"
          ? "নাম চাপুন, তারপর ৪ সংখ্যার PIN দিন।"
          : "Sign in as a teacher or admin to continue."
      }
    >
      {tab === "student" ? <StudentSignIn /> : <StaffSignIn />}
    </AuthShell>
  );
}

function RoleTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items = [
    { key: "student" as Tab, label: "ছাত্র · Student", icon: BookOpen },
    { key: "staff" as Tab, label: "শিক্ষক · Admin", icon: ShieldCheck },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-600/50 bg-ink/5 p-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-xl px-2 py-2 text-xs font-semibold transition",
            tab === it.key
              ? "bg-gradient-to-r from-indigo-500/90 to-cyan-400/90 text-white shadow-lg shadow-indigo-500/20"
              : "text-slate-400 hover:bg-ink/10 hover:text-slate-200"
          )}
        >
          <it.icon size={15} />
          {it.label}
        </button>
      ))}
    </div>
  );
}

function classLabel(s: { grade: string | null; section: string | null }) {
  const grade = String(s.grade || "").trim();
  const section = String(s.section || "").trim();
  if (!grade && !section) return "";
  const cls = grade ? (/^[0-9]+$/.test(grade) ? `Class ${grade}` : grade) : "";
  return [cls, section && `Sec ${section}`].filter(Boolean).join(" · ");
}

function Initial({ name, size = 9 }: { name: string; size?: number }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-indigo-500/15 font-semibold text-indigo-300",
        size === 9 ? "h-9 w-9 text-sm" : "h-10 w-10 text-base"
      )}
    >
      {name.trim().charAt(0)}
    </span>
  );
}

/** Pick your name, then type a 4-digit PIN. No email, no password, no typing. */
function StudentSignIn() {
  const nav = useNavigate();
  const { loginStudent } = useAuth();

  const [students, setStudents] = useState<Student[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Student | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // The keypad can fire faster than React re-renders, so the digits live in a ref.
  const pinRef = useRef("");
  const setPinValue = (v: string) => {
    pinRef.current = v;
    setPin(v);
  };

  useEffect(() => {
    let alive = true;
    api
      .get("/auth/students")
      .then(({ data }) => alive && setStudents(data.students || []))
      .catch(() => {
        if (!alive) return;
        setStudents([]);
        setLoadErr("ছাত্রদের তালিকা আনা যায়নি। ইন্টারনেট চেক করে আবার চেষ্টা করুন।");
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const list = students || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.grade || "").toLowerCase().includes(q) ||
        String(s.section || "").toLowerCase().includes(q)
    );
  }, [students, query]);

  const submit = async (value: string, student: Student | null = picked) => {
    if (!student || value.length !== 4 || busy) return;
    setErr("");
    setBusy(true);
    try {
      await loginStudent(student.id, value);
      nav("/dashboard");
      return;
    } catch (x: any) {
      setErr(x?.response?.data?.error || "PIN মেলেনি। আবার চেষ্টা করুন।");
      setPinValue("");
    }
    setBusy(false);
  };

  const addDigit = (d: string) => {
    if (busy || !picked) return;
    setErr("");
    const next = (pinRef.current + d).slice(0, 4);
    setPinValue(next);
    if (next.length === 4) void submit(next);
  };

  const backspace = () => {
    if (busy) return;
    setErr("");
    setPinValue(pinRef.current.slice(0, -1));
  };

  const choose = (s: Student) => {
    setPicked(s);
    setPinValue("");
    setErr("");
  };

  const stepBack = () => {
    setPicked(null);
    setPinValue("");
    setErr("");
  };

  // A physical keyboard is faster than tapping, so support both.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        addDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Escape") {
        e.preventDefault();
        stepBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (picked) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-600/50 bg-ink/5 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Initial name={picked.name} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-100">{picked.name}</div>
              {classLabel(picked) && <div className="text-[11px] text-slate-400">{classLabel(picked)}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={stepBack}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-xl px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-ink/10 hover:text-slate-200"
          >
            <ArrowLeft size={13} /> অন্য ছাত্র
          </button>
        </div>

        <div className="flex justify-center gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "grid h-12 w-11 place-items-center rounded-2xl border text-xl font-semibold transition",
                i < pin.length
                  ? "border-indigo-400/70 bg-indigo-500/15 text-slate-100"
                  : "border-slate-600/50 bg-ink/5 text-slate-500",
                !busy && i === pin.length && "border-indigo-400/80 ring-2 ring-indigo-500/30"
              )}
            >
              {i < pin.length ? "•" : ""}
            </span>
          ))}
        </div>

        {err && (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-rose-300" />
            <span>{err}</span>
          </div>
        )}

        <Keypad onDigit={addDigit} onBack={backspace} disabled={busy} />

        <p className="text-center text-[11px] text-slate-500">
          {busy ? "একটু অপেক্ষা করুন…" : "PIN ভুলে গেলে শিক্ষকের কাছে নতুন PIN চান।"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {students === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : loadErr ? (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
          <CircleAlert size={14} className="mt-0.5 shrink-0 text-rose-300" />
          <span>{loadErr}</span>
        </div>
      ) : students.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-5 text-center">
          <p className="text-sm font-medium text-amber-200">এখনো কোনো ছাত্র যোগ করা হয়নি</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
            শিক্ষক <b>Add Student</b> থেকে শুধু নাম আর ক্লাস দিয়ে ছাত্র যোগ করবেন — তারপর এখানে নাম দেখা যাবে।
          </p>
        </div>
      ) : (
        <>
          {students.length > 8 && (
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="নাম খুঁজুন" className="pl-10" />
            </div>
          )}
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => choose(s)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-slate-600/50 bg-ink/5 px-3 py-2.5 text-left transition hover:border-indigo-400/60 hover:bg-indigo-500/10"
              >
                <Initial name={s.name} size={10} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-100">{s.name}</span>
                  {classLabel(s) && <span className="block text-[11px] text-slate-400">{classLabel(s)}</span>}
                </span>
                <KeyRound size={15} className="shrink-0 text-slate-500" />
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">“{query}” নামে কেউ পাওয়া যায়নি।</p>
            )}
          </div>
        </>
      )}

      <p className="pt-1 text-center text-[11px] text-slate-500">
        শিক্ষক বা অ্যাডমিন? উপরের <b>শিক্ষক · Admin</b> ট্যাব থেকে ইমেইল দিয়ে ঢুকুন।
      </p>
    </div>
  );
}

function Keypad({ onDigit, onBack, disabled }: { onDigit: (d: string) => void; onBack: () => void; disabled?: boolean }) {
  const key =
    "cursor-pointer rounded-2xl border border-slate-600/50 bg-ink/5 py-2.5 text-base font-semibold text-slate-100 transition hover:border-indigo-400/60 hover:bg-indigo-500/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" disabled={disabled} onClick={() => onDigit(d)} className={key}>
          {d}
        </button>
      ))}
      <span aria-hidden="true" />
      <button type="button" disabled={disabled} onClick={() => onDigit("0")} className={key}>
        0
      </button>
      <button type="button" disabled={disabled} onClick={onBack} aria-label="Backspace" className={cn(key, "grid place-items-center text-slate-300")}>
        <Backspace size={18} />
      </button>
    </div>
  );
}

/** Email + password, for teachers and admins. */
function StaffSignIn() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState("");
  // Which control is working: "form" for the submit button, otherwise a role name.
  const [busy, setBusy] = useState<string | null>(null);

  const signIn = async (mail: string, pass: string, source: string) => {
    setErr("");
    setBusy(source);
    try {
      await login(mail.trim(), pass);
      nav("/dashboard");
      return;
    } catch (x: any) {
      setErr(x?.response?.data?.error || "Sign in failed. Please check your email and password.");
    }
    setBusy(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void signIn(email, password, "form");
  };

  const useDemo = (d: typeof DEMO[number]) => {
    // Fill the fields too, so it is obvious which account was used.
    setEmail(d.email);
    setPassword(d.password);
    void signIn(d.email, d.password, d.role);
  };

  return (
    <>
      <div>
        <div className="mb-2 pl-4 text-xs font-medium tracking-wide text-slate-400">One-tap demo sign in</div>
        <div className="grid grid-cols-3 gap-2">
          {DEMO.map((d) => (
            <button
              key={d.role}
              type="button"
              title={`${d.email} / ${d.password}`}
              disabled={busy !== null}
              onClick={() => useDemo(d)}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl border border-slate-600/50 bg-ink/5 px-2 py-3 text-center text-slate-300 transition hover:border-indigo-400/60 hover:bg-indigo-500/10 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <d.icon size={17} className="text-indigo-300" />
              <span className="text-xs font-semibold">{busy === d.role ? "Signing in…" : d.role}</span>
              <span className="hidden text-[10px] text-slate-400 sm:block">{d.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-600/40" />
        <span className="whitespace-nowrap text-[10px] uppercase tracking-wider text-slate-500">or use your own account</span>
        <span className="h-px flex-1 bg-slate-600/40" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField label="Email">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            placeholder="you@school.edu.bd"
            required
          />
        </AuthField>

        <AuthField label="Password">
          <div className="relative">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-12"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-xl text-slate-400 transition hover:bg-ink/10 hover:text-slate-100"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </AuthField>

        {err && (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
            <CircleAlert size={14} className="mt-0.5 shrink-0 text-rose-300" />
            <span>{err}</span>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy !== null}>
          <LogIn size={16} /> {busy === "form" ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-slate-400">
        New here?{" "}
        <Link to="/register" className="font-medium text-indigo-300 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
