import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Card, Button, Input, Field, Select, Badge } from "../components/ui";
import { Plus, Trash2, PlayCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Exams() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", subject_id: "", duration_minutes: 30, question_ids: [] as string[] });
  const [availableQs, setAvailableQs] = useState<any[]>([]);

  const load = async () => {
    const { data } = await api.get("/exams");
    setExams(data.exams);
  };
  useEffect(() => { load(); api.get("/subjects").then(r => setSubjects(r.data.subjects)); }, []);

  useEffect(() => {
    if (form.subject_id) {
      api.get(`/questions?subject_id=${form.subject_id}`).then(r => setAvailableQs(r.data.questions));
    } else setAvailableQs([]);
  }, [form.subject_id]);

  const toggleQ = (id: string) => {
    setForm(f => ({
      ...f,
      question_ids: f.question_ids.includes(id) ? f.question_ids.filter((x:string)=>x!==id) : [...f.question_ids, id],
    }));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post("/exams", form);
    setShowForm(false);
    setForm({ title: "", subject_id: "", duration_minutes: 30, question_ids: [] });
    load();
  };

  const publish = async (id: string, val: boolean) => {
    await api.put(`/exams/${id}/${val ? "publish" : "unpublish"}`);
    load();
  };
  const del = async (id: string) => {
    if (!confirm("Delete exam?")) return;
    await api.delete(`/exams/${id}`); load();
  };

  const start = async (id: string) => {
    const { data } = await api.post(`/exams/${id}/start`);
    nav(`/take-exam/${data.attempt.id}`);
  };

  const isTeacher = user?.role === "admin" || user?.role === "teacher";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Exams</h1>
        {isTeacher && <Button onClick={() => setShowForm(!showForm)}><Plus size={16}/> New Exam</Button>}
      </div>

      {showForm && (
        <Card>
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Title"><Input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required /></Field>
              <Field label="Subject">
                <Select value={form.subject_id} onChange={e=>setForm({...form,subject_id:e.target.value})} required>
                  <option value="">Select</option>
                  {subjects.map(s=> <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Duration (min)"><Input type="number" value={form.duration_minutes} onChange={e=>setForm({...form,duration_minutes:Number(e.target.value)})} /></Field>
            </div>
            <div className="text-sm font-medium text-slate-300">Select questions ({form.question_ids.length})</div>
            <div className="max-h-64 overflow-auto border border-slate-700 rounded-xl p-2 space-y-1">
              {availableQs.map(q => (
                <label key={q.id} className="flex items-center gap-2 text-sm py-1">
                  <input type="checkbox" checked={form.question_ids.includes(q.id)} onChange={() => toggleQ(q.id)} />
                  <span className="truncate">{q.prompt}</span>
                  <Badge className="ml-auto">{q.type}</Badge>
                </label>
              ))}
              {availableQs.length === 0 && <div className="text-slate-500 text-xs p-2">Select a subject with questions.</div>}
            </div>
            <div className="flex gap-2">
              <Button type="submit">Create Exam</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {exams.filter(e => isTeacher || e.is_published).map(e => {
          const sub = subjects.find(s => s.id === e.subject_id);
          return (
            <Card key={e.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-slate-500">{sub?.name} · {e.total_marks} marks · {e.duration_minutes} min · {Array.isArray(e.question_ids)?e.question_ids.length:JSON.parse(e.question_ids).length} questions</div>
                  <div className="mt-1">{e.is_published ? <Badge>Published</Badge> : <Badge className="bg-slate-700/40 text-slate-400 border-slate-600">Draft</Badge>}</div>
                </div>
                <div className="flex gap-2">
                  {!isTeacher && e.is_published && <Button onClick={() => start(e.id)}><PlayCircle size={16}/> Start</Button>}
                  {isTeacher && <>
                    <Button variant="outline" onClick={() => publish(e.id, !e.is_published)}>{e.is_published ? "Unpublish" : "Publish"}</Button>
                    <Button variant="ghost" onClick={() => del(e.id)}><Trash2 size={14}/></Button>
                  </>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}