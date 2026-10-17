import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { Button, Input } from "../components/ui";
import { AuthField, AuthShell } from "../components/AuthShell";
import { BookOpen, CircleAlert, Eye, EyeOff, GraduationCap, LogIn, ShieldCheck } from "lucide-react";

/**
 * The three seeded accounts. Each one gets a one-tap button so you can jump
 * straight into a role without typing (or remembering) any credentials.
 */
const DEMO = [
  { role: "Admin", blurb: "Full control", email: "admin@mcq.local", password: "admin123", icon: ShieldCheck },
  { role: "Teacher", blurb: "Build papers", email: "teacher@mcq.local", password: "teacher123", icon: GraduationCap },
  { role: "Student", blurb: "Take exams", email: "student@mcq.local", password: "student123", icon: BookOpen },
];

export default function Login() {
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
    <AuthShell title="Welcome back" subtitle="Sign in as a teacher or student to continue.">
      <div>
        <div className="mb-2 pl-4 text-xs font-medium tracking-wide text-slate-400">
          One-tap demo sign in
        </div>
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
        <span className="whitespace-nowrap text-[10px] uppercase tracking-wider text-slate-500">
          or use your own account
        </span>
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
    </AuthShell>
  );
}
