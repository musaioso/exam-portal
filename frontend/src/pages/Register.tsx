import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Input } from "../components/ui";
import { AuthField, AuthShell } from "../components/AuthShell";
import { CircleAlert, Eye, EyeOff, UserPlus } from "lucide-react";

export default function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api.post("/auth/register", { ...form, role: "teacher" });
      nav("/login");
      return;
    } catch (x: any) {
      setErr(x?.response?.data?.error || "Could not create the account. Please try again.");
    }
    setBusy(false);
  };

  return (
    <AuthShell
      title="Create a teacher account"
      subtitle="ছাত্রদের অ্যাকাউন্ট শিক্ষক নিজেই বানাবেন — Add Student থেকে, শুধু নাম আর ক্লাস দিয়ে।"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField label="Full name">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Ifaz Ahmed" required />
        </AuthField>

        <AuthField label="Email">
          <Input value={form.email} onChange={(e) => set("email", e.target.value)} type="email" autoComplete="email" placeholder="you@school.edu.bd" required />
        </AuthField>

        <AuthField label="Password">
          <div className="relative">
            <Input
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Choose a password"
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

        <Button type="submit" className="w-full" disabled={busy}>
          <UserPlus size={16} /> {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <div className="mt-5 rounded-2xl border border-slate-600/40 bg-ink/5 px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
        <b className="text-slate-300">ছাত্রদের জন্য নয়:</b> ছাত্ররা রেজিস্টার করবে না। শিক্ষক <b>Students → Add Student</b> থেকে নাম আর ক্লাস
        দিয়ে যোগ করবেন, তারপর ছাত্র লগইন পেজে নিজের নাম চেপে ৪ সংখ্যার PIN দিয়ে ঢুকবে।
      </div>

      <p className="mt-5 text-center text-xs text-slate-400">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-indigo-300 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
