import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card, Input, Field, Select } from "../components/ui";

export default function Register() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student", grade: "", section: "" });
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try {
      await api.post("/auth/register", form);
      nav("/login");
    } catch (x: any) { setErr(x?.response?.data?.error || "Failed"); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold mb-4">Create account</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={e=>set("name",e.target.value)} required /></Field>
          <Field label="Email"><Input value={form.email} onChange={e=>set("email",e.target.value)} type="email" required /></Field>
          <Field label="Password"><Input value={form.password} onChange={e=>set("password",e.target.value)} type="password" required /></Field>
          <Field label="Role">
            <Select value={form.role} onChange={e=>set("role",e.target.value)}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
            </Select>
          </Field>
          {form.role === "student" && <>
            <Field label="Grade"><Input value={form.grade} onChange={e=>set("grade",e.target.value)} /></Field>
            <Field label="Section"><Input value={form.section} onChange={e=>set("section",e.target.value)} /></Field>
          </>}
          {err && <div className="text-rose-400 text-sm">{err}</div>}
          <Button className="w-full" type="submit">Create account</Button>
        </form>
      </Card>
    </div>
  );
}