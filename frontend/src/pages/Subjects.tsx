import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, Button, Input, Field, Textarea } from "../components/ui";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";

export default function Subjects() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Record<string, any[]>>({});
  const [newSub, setNewSub] = useState({ name: "", name_bn: "", slug: "", code: "" });
  const [newCh, setNewCh] = useState<Record<string, { number: number; title: string; title_bn: string }>>({});

  const loadSubjects = async () => {
    const { data } = await api.get("/subjects");
    setSubjects(data.subjects);
  };
  useEffect(() => { loadSubjects(); }, []);

  const loadChapters = async (sid: string) => {
    const { data } = await api.get(`/subjects/${sid}/chapters`);
    setChapters(c => ({ ...c, [sid]: data.chapters }));
  };
  const toggle = (sid: string) => {
    if (expanded !== sid) { loadChapters(sid); }
    setExpanded(expanded === sid ? null : sid);
  };

  const addSubject = async () => {
    if (!newSub.name || !newSub.slug) return;
    await api.post("/subjects", newSub);
    setNewSub({ name: "", name_bn: "", slug: "", code: "" });
    loadSubjects();
  };

  const delSubject = async (id: string) => {
    if (!confirm("Delete subject?")) return;
    await api.delete(`/subjects/${id}`);
    loadSubjects();
  };

  const addChapter = async (sid: string) => {
    const c = newCh[sid] || { number: 1, title: "", title_bn: "" };
    if (!c.title) return;
    await api.post(`/subjects/${sid}/chapters`, c);
    setNewCh(n => ({ ...n, [sid]: { number: c.number + 1, title: "", title_bn: "" } }));
    loadChapters(sid);
  };

  const delChapter = async (id: string, sid: string) => {
    if (!confirm("Delete chapter?")) return;
    await api.delete(`/subjects/chapters/${id}`);
    loadChapters(sid);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Subjects & Chapters</h1>
      <Card>
        <h2 className="font-semibold mb-3">Add Subject (NCTB 2025)</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input placeholder="Name (English)" value={newSub.name} onChange={e=>setNewSub({...newSub,name:e.target.value})} />
          <Input placeholder="Name (Bangla)" value={newSub.name_bn} onChange={e=>setNewSub({...newSub,name_bn:e.target.value})} />
          <Input placeholder="Slug (e.g. english-1st)" value={newSub.slug} onChange={e=>setNewSub({...newSub,slug:e.target.value})} />
          <Input placeholder="Code" value={newSub.code} onChange={e=>setNewSub({...newSub,code:e.target.value})} />
        </div>
        <Button className="mt-3" onClick={addSubject}><Plus size={16}/> Add Subject</Button>
      </Card>

      <div className="space-y-3">
        {subjects.map(s => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between">
              <button onClick={() => toggle(s.id)} className="flex items-center gap-2 font-medium">
                {expanded === s.id ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                {s.name} <span className="text-slate-500 text-sm">({s.code})</span>
              </button>
              <button onClick={() => delSubject(s.id)} className="text-rose-400 hover:text-rose-300"><Trash2 size={16}/></button>
            </div>
            {expanded === s.id && (
              <div className="mt-4 pl-6 space-y-2">
                <div className="flex gap-2 items-end">
                  <Input className="w-20" placeholder="No." type="number" value={newCh[s.id]?.number ?? 1}
                    onChange={e=>setNewCh(n=>({...n,[s.id]:{...(n[s.id]||{}),number:Number(e.target.value)}}))} />
                  <Input className="flex-1" placeholder="Chapter title (English)" value={newCh[s.id]?.title ?? ""}
                    onChange={e=>setNewCh(n=>({...n,[s.id]:{...(n[s.id]||{}),title:e.target.value}}))} />
                  <Input className="flex-1" placeholder="Chapter title (Bangla)" value={newCh[s.id]?.title_bn ?? ""}
                    onChange={e=>setNewCh(n=>({...n,[s.id]:{...(n[s.id]||{}),title_bn:e.target.value}}))} />
                  <Button onClick={() => addChapter(s.id)}><Plus size={16}/></Button>
                </div>
                {(chapters[s.id] || []).map(ch => (
                  <div key={ch.id} className="flex items-center justify-between text-sm py-1 border-b border-slate-700/40">
                    <span>Ch. {ch.number} — {ch.title} {ch.title_bn && <span className="text-slate-500">({ch.title_bn})</span>}</span>
                    <button onClick={() => delChapter(ch.id, s.id)} className="text-rose-400"><Trash2 size={14}/></button>
                  </div>
                ))}
                {!(chapters[s.id]?.length) && <div className="text-xs text-slate-500">No chapters yet.</div>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}