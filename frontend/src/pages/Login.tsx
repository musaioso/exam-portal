import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { Button, Card, Input, Field } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("teacher@mcq.local");
  const [password, setPassword] = useState("teacher123");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try { await login(email, password); nav("/dashboard"); }
    catch (x: any) { setErr(x?.response?.data?.error || "Login failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-2xl font-bold mb-3">M</div>
          <h1 className="text-2xl font-semibold">MCQ Studio</h1>
          <p className="text-sm text-slate-400">NCTB 2025 · English Version</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email"><Input value={email} onChange={e=>setEmail(e.target.value)} type="email" required /></Field>
          <Field label="Password"><Input value={password} onChange={e=>setPassword(e.target.value)} type="password" required /></Field>
          {err && <div className="text-rose-400 text-sm">{err}</div>}
          <Button className="w-full" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</Button>
        </form>
        <div className="mt-4 text-xs text-slate-500 text-center space-y-1">
          <div>Admin: admin@mcq.local / admin123</div>
          <div>Teacher: teacher@mcq.local / teacher123</div>
          <div>Student: student@mcq.local / student123</div>
        </div>
      </Card>
    </div>
  );
}