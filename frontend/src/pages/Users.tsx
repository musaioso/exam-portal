import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Card, Button, Input, Field, cn } from "../components/ui";
import { Check, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", grade: "", section: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** The student just created, so their brand-new PIN can be shown big. */
  const [fresh, setFresh] = useState<{ name: string; pin: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState("");

  const load = async () => {
    const { data } = await api.get("/users");
    setUsers(data.users);
  };
  useEffect(() => { load(); }, []);

  // Dashboard quick action lands on /users?new=1 — open the add-student form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setShow(true);
    }
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { data } = await api.post("/users/students", form);
      setFresh({ name: data.user.name, pin: data.user.pin });
      setForm({ name: "", grade: "", section: "" });
      setShow(false);
      load();
    } catch (x: any) {
      setErr(x?.response?.data?.error || "ছাত্র তৈরি করা যায়নি। আবার চেষ্টা করুন।");
    }
    setBusy(false);
  };

  const resetPin = async (id: string) => {
    const student = users.find((u) => u.id === id);
    const name = student?.name || "ছাত্র";
    const ask = student?.pin
      ? `${name}-এর জন্য নতুন PIN বানাবেন? পুরোনো PIN আর কাজ করবে না।`
      : `${name}-কে একটা ৪ সংখ্যার PIN বানিয়ে দেবেন? এরপর সে নাম আর PIN দিয়ে ঢুকতে পারবে।`;
    if (!confirm(ask)) return;
    const { data } = await api.post(`/users/${id}/reset-pin`);
    setFresh({ name, pin: data.pin });
    setRevealed((r) => ({ ...r, [id]: true }));
    load();
  };

  const copyPin = async (pin: string, key: string) => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setErr("কপি করা যায়নি — PIN টা হাতে লিখে নিন।");
    }
  };

  const del = async (id: string) => {
    const student = users.find((u) => u.id === id);
    if (!confirm(`${student?.name || "এই ইউজার"}-কে মুছে ফেলবেন?`)) return;
    await api.delete(`/users/${id}`);
    load();
  };

  const sorted = [...users].sort((a, b) => {
    const sa = a.role === "student" ? 0 : 1;
    const sb = b.role === "student" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return String(a.name).localeCompare(String(b.name));
  });
  const studentCount = users.filter((u) => u.role === "student").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="text-sm text-slate-400">
            {studentCount > 0
              ? `${studentCount} জন ছাত্র — ইমেইল ছাড়াই নাম আর ৪ সংখ্যার PIN দিয়ে ঢুকবে।`
              : "ছাত্ররা ইমেইল ছাড়াই নাম আর ৪ সংখ্যার PIN দিয়ে ঢুকবে।"}
          </p>
        </div>
        <Button onClick={() => setShow(!show)}>
          <Plus size={16} /> Add Student
        </Button>
      </div>

      {show && (
        <Card hover={false}>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="যেমন: Ifaz Ahmed" required />
            </Field>
            <Field label="Class">
              <Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="যেমন: 8" />
            </Field>
            <Field label="Section">
              <Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="যেমন: A" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={busy}>
                <Plus size={16} /> {busy ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-400">
            ইমেইল বা পাসওয়ার্ড লাগবে না — সিস্টেম নিজেই একটা ৪ সংখ্যার PIN বানিয়ে দেবে, ছাত্রকে সেটাই জানাবেন।
          </p>
          {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
        </Card>
      )}

      {fresh && (
        <Card hover={false} className="border-emerald-500/40">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate-300">
                <b>{fresh.name}</b>-এর PIN তৈরি হয়েছে
              </div>
              <div className="mt-1.5 font-mono text-3xl font-bold tracking-[0.3em] text-emerald-300">{fresh.pin}</div>
              <p className="mt-1.5 text-xs text-slate-400">
                লিখে রাখুন বা ছাত্রকে জানিয়ে দিন। লগইনে সে নাম চেপে এই PIN দেবে — পরে এখান থেকে আবার দেখতে পারবেন।
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => copyPin(fresh.pin, "fresh")}>
                {copied === "fresh" ? <Check size={15} /> : <Copy size={15} />} {copied === "fresh" ? "Copied" : "Copy PIN"}
              </Button>
              <Button variant="ghost" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card hover={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 text-left">Name</th>
                <th className="text-left">PIN</th>
                <th className="text-left">Class</th>
                <th className="text-left">Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => (
                <tr key={u.id} className="border-t border-slate-700/40">
                  <td className="py-2.5">
                    {u.name}
                    {u.role !== "student" && u.email && <div className="text-[11px] text-slate-500">{u.email}</div>}
                  </td>
                  <td>
                    {u.role === "student" ? (
                      u.pin ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono tracking-[0.2em] text-slate-200">{revealed[u.id] ? u.pin : "••••"}</span>
                          <IconBtn
                            title={revealed[u.id] ? "PIN লুকান" : "PIN দেখান"}
                            onClick={() => setRevealed((r) => ({ ...r, [u.id]: !r[u.id] }))}
                          >
                            {revealed[u.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                          </IconBtn>
                          <IconBtn title="PIN কপি করুন" onClick={() => copyPin(u.pin, u.id)}>
                            {copied === u.id ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
                          </IconBtn>
                          <IconBtn title="নতুন PIN বানান" onClick={() => resetPin(u.id)}>
                            <RefreshCw size={13} />
                          </IconBtn>
                        </div>
                      ) : (
                        // Students added before PINs existed (or by an earlier admin) still need one.
                        <button
                          type="button"
                          onClick={() => resetPin(u.id)}
                          className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-600/50 bg-ink/5 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-indigo-400/60 hover:bg-indigo-500/10 hover:text-slate-100"
                        >
                          <KeyRound size={13} /> PIN দিন
                        </button>
                      )
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td>{u.grade ? `${u.grade}${u.section ? ` · ${u.section}` : ""}` : "—"}</td>
                  <td>
                    <Badge>{u.role}</Badge>
                  </td>
                  <td className="text-right">
                    {u.role === "student" && (
                      <button
                        type="button"
                        title="মুছে ফেলুন"
                        aria-label="মুছে ফেলুন"
                        onClick={() => del(u.id)}
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-slate-600/50 bg-ink/5 text-rose-400 transition hover:border-rose-400/60 hover:bg-rose-500/10"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                    এখনো কেউ নেই — উপরে Add Student চেপে নাম আর ক্লাস দিয়ে যোগ করুন।
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-slate-600/50 bg-ink/5 text-slate-400",
        "transition hover:border-indigo-400/60 hover:bg-ink/10 hover:text-slate-100"
      )}
    >
      {children}
    </button>
  );
}
