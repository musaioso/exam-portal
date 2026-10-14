import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, Button, Input, Field, Select } from "../components/ui";
import { Plus, Trash2 } from "lucide-react";

export default function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", grade: "", section: "" });
  const [show, setShow] = useState(false);

  const load = async () => {
    const { data } = await api.get("/users");
    setUsers(data.users);
  };
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/users/students", form);
    setForm({ name: "", email: "", password: "", grade: "", section: "" });
    setShow(false); load();
  };
  const del = async (id: string) => {
    if (!confirm("Delete user?")) return;
    await api.delete(`/users/${id}`); load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Students</h1>
        <Button onClick={() => setShow(!show)}><Plus size={16}/> Add Student</Button>
      </div>
      {show && (
        <Card>
          <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Name"><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required /></Field>
            <Field label="Email"><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})} type="email" required /></Field>
            <Field label="Password"><Input value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required /></Field>
            <Field label="Grade"><Input value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})} /></Field>
            <Field label="Section"><Input value={form.section} onChange={e=>setForm({...form,section:e.target.value})} /></Field>
            <div className="flex items-end"><Button type="submit">Create</Button></div>
          </form>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs">
            <tr><th className="text-left py-2">Name</th><th>Email</th><th>Role</th><th>Grade</th><th></th></tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-slate-700/40">
                <td className="py-2">{u.name}</td>
                <td>{u.email}</td>
                <td><span className="text-xs">{u.role}</span></td>
                <td>{u.grade ? `${u.grade} ${u.section||""}` : "-"}</td>
                <td className="text-right">
                  {u.role === "student" && <button onClick={()=>del(u.id)} className="text-rose-400"><Trash2 size={14}/></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}