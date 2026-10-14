import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, Button, Input, Field, Textarea, Select, Badge } from "../components/ui";
import { Plus, Trash2, Filter } from "lucide-react";

const empty = { subject_id: "", chapter_id: "", type: "mcq", difficulty: "medium", prompt: "", options: ["", "", "", ""], answer: "", explanation: "", marks: 1 };

export default function Questions() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [filterType, setFilterType] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => { api.get("/subjects").then(r => setSubjects(r.data.subjects)); }, []);
  useEffect(() => {
    if (selectedSubject) api.get(`/subjects/${selectedSubject}/chapters`).then(r => setChapters(r.data.chapters));
    else setChapters([]);
  }, [selectedSubject]);
  const loadQuestions = async () => {
    const params = new URLSearchParams();
    if (selectedSubject) params.set("subject_id", selectedSubject);
    if (filterType) params.set("type", filterType);
    const { data } = await api.get(`/questions?${params.toString()}`);
    setQuestions(data.questions);
  };
  useEffect(() => { loadQuestions(); }, [selectedSubject, filterType]);

  const reset = () => { setForm(empty); setEditing(null); setShowForm(false); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    if (payload.type === "mcq") payload.options = payload.options.filter((o: string) => o.trim() !== "");
    else payload.options = undefined;
    if (editing) await api.put(`/questions/${editing}`, payload);
    else await api.post("/questions", payload);
    reset(); loadQuestions();
  };

  const edit = (q: any) => {
    setForm({
      subject_id: q.subject_id, chapter_id: q.chapter_id || "",
      type: q.type, difficulty: q.difficulty, prompt: q.prompt,
      options: q.options || ["", "", "", ""], answer: q.answer || "",
      explanation: q.explanation || "", marks: q.marks,
    });
    setEditing(q.id); setShowForm(true);
  };

  const del = async (id: string) => {
    if (!confirm("Delete question?")) return;
    await api.delete(`/questions/${id}`); loadQuestions();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Question Bank</h1>
        <Button onClick={() => { reset(); setShowForm(true); }}><Plus size={16}/> New Question</Button>
      </div>

      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Subject">
            <Select value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)}>
              <option value="">All subjects</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">All types</option>
              <option value="mcq">MCQ</option>
              <option value="short">Short</option>
              <option value="long">Long</option>
            </Select>
          </Field>
        </div>
      </Card>

      {showForm && (
        <Card>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Subject">
                <Select value={form.subject_id} onChange={e => setForm({ ...form, subject_id: e.target.value })} required>
                  <option value="">Select subject</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Chapter">
                <Select value={form.chapter_id} onChange={e => setForm({ ...form, chapter_id: e.target.value })}>
                  <option value="">No chapter / all</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>Ch.{c.number} {c.title}</option>)}
                </Select>
              </Field>
              <Field label="Type">
                <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="mcq">MCQ</option>
                  <option value="short">Short</option>
                  <option value="long">Long</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Difficulty">
                <Select value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>
              <Field label="Marks"><Input type="number" value={form.marks} onChange={e=>setForm({...form,marks:Number(e.target.value)})} /></Field>
            </div>
            <Field label="Question prompt"><Textarea rows={3} value={form.prompt} onChange={e=>setForm({...form,prompt:e.target.value})} required /></Field>
            {form.type === "mcq" && (
              <div className="space-y-2">
                <div className="text-xs text-slate-300">Options (select correct answer below)</div>
                {form.options.map((o: string, i: number) => (
                  <div key={i} className="flex gap-2">
                    <Input value={o} onChange={e => { const opts=[...form.options]; opts[i]=e.target.value; setForm({...form,options:opts}); }} placeholder={`Option ${i+1}`} />
                  </div>
                ))}
                <Field label="Correct Answer (must match an option exactly)">
                  <Input value={form.answer} onChange={e=>setForm({...form,answer:e.target.value})} placeholder="Type correct option text" />
                </Field>
              </div>
            )}
            {form.type !== "mcq" && (
              <Field label="Model Answer / Key Points"><Textarea rows={3} value={form.answer} onChange={e=>setForm({...form,answer:e.target.value})} /></Field>
            )}
            <Field label="Explanation (optional)"><Textarea rows={2} value={form.explanation} onChange={e=>setForm({...form,explanation:e.target.value})} /></Field>
            <div className="flex gap-2">
              <Button type="submit">{editing ? "Update" : "Save"} Question</Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {questions.map(q => {
          const sub = subjects.find(s => s.id === q.subject_id);
          return (
            <Card key={q.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge>{q.type.toUpperCase()}</Badge>
                    <Badge className="bg-slate-700/40 text-slate-300 border-slate-600">{q.difficulty}</Badge>
                    <span className="text-xs text-slate-500">{sub?.name} · {q.marks} mark(s)</span>
                  </div>
                  <div className="text-sm">{q.prompt}</div>
                  {q.options && (
                    <ul className="text-xs text-slate-400 mt-2 space-y-0.5 ml-4">
                      {(Array.isArray(q.options)?q.options:JSON.parse(q.options)).map((o: string, i: number) => <li key={i}>• {o} {q.answer === o && <span className="text-emerald-400">(correct)</span>}</li>)}
                    </ul>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => edit(q)}>Edit</Button>
                  <Button variant="ghost" onClick={() => del(q.id)}><Trash2 size={14}/></Button>
                </div>
              </div>
            </Card>
          );
        })}
        {questions.length === 0 && <div className="text-slate-500 text-sm">No questions yet.</div>}
      </div>
    </div>
  );
}