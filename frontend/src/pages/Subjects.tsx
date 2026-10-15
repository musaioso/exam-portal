import { useEffect, useState } from "react";
import { api, currentUser } from "../lib/api";
import { Card, Button, Input } from "../components/ui";
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function Subjects() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Record<string, any[]>>({});
  const [newSub, setNewSub] = useState({ name: "", name_bn: "", slug: "", code: "" });
  const [newCh, setNewCh] = useState<Record<string, { number: number; title: string; title_bn: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingSubject, setSavingSubject] = useState(false);
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editSub, setEditSub] = useState({ name: "", name_bn: "", code: "" });
  const [editingChapter, setEditingChapter] = useState<string | null>(null);
  const [editCh, setEditCh] = useState({ number: 0, title: "", title_bn: "" });
  const canManage = currentUser()?.role === "admin" || currentUser()?.role === "teacher";

  const loadSubjects = async () => {
    const { data } = await api.get("/subjects");
    setSubjects(data.subjects);
  };
  useEffect(() => {
    loadSubjects().catch((e) => {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to load subjects";
      setError(status ? `${message} (HTTP ${status})` : message);
    });
  }, []);

  const loadChapters = async (sid: string) => {
    const { data } = await api.get(`/subjects/${sid}/chapters`);
    setChapters(c => ({ ...c, [sid]: data.chapters }));
  };
  const toggle = (sid: string) => {
    if (expanded !== sid) { loadChapters(sid).catch(() => {}); }
    setExpanded(expanded === sid ? null : sid);
  };

  const addSubject = async () => {
    setError(null);
    const slug = newSub.slug.trim() || slugify(newSub.name);
    if (!newSub.name.trim() || !slug) {
      setError("Subject name is required (slug can be auto-generated).");
      return;
    }
    setSavingSubject(true);
    try {
      await api.post("/subjects", { ...newSub, slug });
      setNewSub({ name: "", name_bn: "", slug: "", code: "" });
      await loadSubjects();
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to add subject";
      setError(status ? `${message} (HTTP ${status})` : message);
    } finally {
      setSavingSubject(false);
    }
  };

  const startEditSubject = (s: any) => {
    setEditingSubject(s.id);
    setEditSub({ name: s.name, name_bn: s.name_bn || "", code: s.code || "" });
  };

  const cancelEditSubject = () => {
    setEditingSubject(null);
  };

  const saveEditSubject = async (id: string) => {
    if (!editSub.name.trim()) {
      setError("Subject name is required.");
      return;
    }
    try {
      await api.put(`/subjects/${id}`, editSub);
      setEditingSubject(null);
      await loadSubjects();
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to update subject";
      setError(status ? `${message} (HTTP ${status})` : message);
    }
  };

  const delSubject = async (id: string) => {
    if (!confirm("Delete subject?")) return;
    setError(null);
    try {
      await api.delete(`/subjects/${id}`);
      await loadSubjects();
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to delete subject";
      setError(status ? `${message} (HTTP ${status})` : message);
    }
  };

  const addChapter = async (sid: string) => {
    setError(null);
    const current = newCh[sid] || { number: 1, title: "", title_bn: "" };
    const number = Number.isFinite(current.number) && current.number > 0 ? current.number : 1;
    if (!current.title.trim()) {
      setError("Chapter title is required.");
      return;
    }
    try {
      await api.post(`/subjects/${sid}/chapters`, { ...current, number });
      setNewCh(n => ({ ...n, [sid]: { number: number + 1, title: "", title_bn: "" } }));
      await loadChapters(sid);
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to add chapter";
      setError(status ? `${message} (HTTP ${status})` : message);
    }
  };

  const startEditChapter = (ch: any) => {
    setEditingChapter(ch.id);
    setEditCh({ number: ch.number, title: ch.title, title_bn: ch.title_bn || "" });
  };

  const cancelEditChapter = () => {
    setEditingChapter(null);
  };

  const saveEditChapter = async (id: string, sid: string) => {
    if (!editCh.title.trim()) {
      setError("Chapter title is required.");
      return;
    }
    try {
      await api.put(`/subjects/chapters/${id}`, editCh);
      setEditingChapter(null);
      await loadChapters(sid);
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to update chapter";
      setError(status ? `${message} (HTTP ${status})` : message);
    }
  };

  const delChapter = async (id: string, sid: string) => {
    if (!confirm("Delete chapter?")) return;
    setError(null);
    try {
      await api.delete(`/subjects/chapters/${id}`);
      await loadChapters(sid);
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to delete chapter";
      setError(status ? `${message} (HTTP ${status})` : message);
    }
  };

  const chNumber = (sid: string) => {
    const n = newCh[sid]?.number;
    return Number.isFinite(n) && n! > 0 ? n : 1;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Subjects & Chapters</h1>
      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{error}</div>}
      {canManage && (
        <Card>
          <h2 className="font-semibold mb-3">Add Subject (NCTB 2025)</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input placeholder="Name (English)" value={newSub.name}
              onChange={e => setNewSub(prev => ({ ...prev, name: e.target.value, slug: prev.slug ? prev.slug : slugify(e.target.value) }))} />
            <Input placeholder="Name (Bangla)" value={newSub.name_bn} onChange={e => setNewSub({ ...newSub, name_bn: e.target.value })} />
            <Input placeholder="Slug (e.g. english-1st)" value={newSub.slug} onChange={e => setNewSub({ ...newSub, slug: e.target.value })} />
            <Input placeholder="Code" value={newSub.code} onChange={e => setNewSub({ ...newSub, code: e.target.value })} />
          </div>
          <Button className="mt-3" onClick={addSubject} disabled={savingSubject}>
            <Plus size={16} /> {savingSubject ? "Adding..." : "Add Subject"}
          </Button>
        </Card>
      )}

      <div className="space-y-3">
        {subjects.map(s => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between">
              {editingSubject === s.id ? (
                <div className="flex gap-2 items-center flex-1">
                  <Input className="flex-1" value={editSub.name} onChange={e => setEditSub({ ...editSub, name: e.target.value })} placeholder="Name (English)" />
                  <Input className="flex-1" value={editSub.name_bn} onChange={e => setEditSub({ ...editSub, name_bn: e.target.value })} placeholder="Name (Bangla)" />
                  <Input className="w-24" value={editSub.code} onChange={e => setEditSub({ ...editSub, code: e.target.value })} placeholder="Code" />
                </div>
              ) : (
                <button onClick={() => toggle(s.id)} className="flex items-center gap-2 font-medium">
                  {expanded === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {s.name} <span className="text-slate-500 text-sm">({s.code})</span>
                </button>
              )}
              {canManage && (
                <div className="flex items-center gap-2">
                  {editingSubject === s.id ? (
                    <>
                      <button onClick={() => saveEditSubject(s.id)} className="text-emerald-400 hover:text-emerald-300" aria-label="Save subject">
                        <Check size={16} />
                      </button>
                      <button onClick={cancelEditSubject} className="text-slate-400 hover:text-slate-300" aria-label="Cancel edit">
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => startEditSubject(s)} className="text-sky-400 hover:text-sky-300" aria-label="Edit subject">
                      <Pencil size={16} />
                    </button>
                  )}
                  <button onClick={() => delSubject(s.id)} className="text-rose-400 hover:text-rose-300" aria-label="Delete subject">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
            {expanded === s.id && editingSubject !== s.id && (
              <div className="mt-4 pl-6 space-y-2">
                {canManage && (
                  <div className="flex gap-2 items-end">
                    <Input className="w-20" placeholder="No." type="number" value={chNumber(s.id)}
                      onChange={e => setNewCh(n => ({ ...n, [s.id]: { ...(n[s.id] || {}), number: Number(e.target.value) || 1 } }))} />
                    <Input className="flex-1" placeholder="Chapter title (English)" value={newCh[s.id]?.title ?? ""}
                      onChange={e => setNewCh(n => ({ ...n, [s.id]: { ...(n[s.id] || {}), title: e.target.value } }))} />
                    <Input className="flex-1" placeholder="Chapter title (Bangla)" value={newCh[s.id]?.title_bn ?? ""}
                      onChange={e => setNewCh(n => ({ ...n, [s.id]: { ...(n[s.id] || {}), title_bn: e.target.value } }))} />
                    <Button onClick={() => addChapter(s.id)} aria-label="Add chapter" title="Add chapter">
                      <Plus size={16} />
                    </Button>
                  </div>
                )}
                {(chapters[s.id] || []).map(ch => (
                  <div key={ch.id} className="flex items-center justify-between text-sm py-1 border-b border-slate-700/40">
                    {editingChapter === ch.id ? (
                      <div className="flex gap-2 items-center flex-1">
                        <Input className="w-16" type="number" value={editCh.number} onChange={e => setEditCh({ ...editCh, number: Number(e.target.value) || 1 })} />
                        <Input className="flex-1" value={editCh.title} onChange={e => setEditCh({ ...editCh, title: e.target.value })} placeholder="Chapter title" />
                        <Input className="flex-1" value={editCh.title_bn} onChange={e => setEditCh({ ...editCh, title_bn: e.target.value })} placeholder="Title (Bangla)" />
                        <button onClick={() => saveEditChapter(ch.id, s.id)} className="text-emerald-400 hover:text-emerald-300" aria-label="Save chapter">
                          <Check size={14} />
                        </button>
                        <button onClick={cancelEditChapter} className="text-slate-400 hover:text-slate-300" aria-label="Cancel edit">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span>Ch. {ch.number} — {ch.title} {ch.title_bn && <span className="text-slate-500">({ch.title_bn})</span>}</span>
                        {canManage && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEditChapter(ch)} className="text-sky-400 hover:text-sky-300" aria-label="Edit chapter">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => delChapter(ch.id, s.id)} className="text-rose-400" aria-label="Delete chapter">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </>
                    )}
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