import { useEffect, useMemo, useState } from "react";
import { api, currentUser } from "../lib/api";
import { Card, Button, Input, cn } from "../components/ui";
import { confirmDialog } from "../components/Dialog";
import { Plus, Trash2, ChevronRight, Pencil, Check, X } from "lucide-react";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Normalise a chapter title so trivial differences don't create "different" chapters. */
function normaliseTitle(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export default function Subjects() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Record<string, any[]>>({});
  const [newSub, setNewSub] = useState({ name: "", name_bn: "", slug: "", code: "" });
  const [newCh, setNewCh] = useState<Record<string, { number: number; title: string; title_bn: string }>>({});
  // canonical chapter id chosen for each duplicate group (keyed by normalised title)
  const [mergeCanonical, setMergeCanonical] = useState<Record<string, string>>({});
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
    const list = data.chapters || [];
    setChapters(c => ({ ...c, [sid]: list }));
    // Pick a sensible default canonical for each duplicate group: the chapter
    // with the most questions, ties broken by lowest number.
    const groups = new Map<string, any[]>();
    for (const ch of list) {
      const key = normaliseTitle(ch.title);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ch);
    }
    setMergeCanonical((prev) => {
      const next = { ...prev };
      for (const [key, arr] of groups) {
        if (arr.length < 2) continue;
        if (next[key]) continue;
        const sorted = [...arr].sort((a, b) => (b.question_count || 0) - (a.question_count || 0) || (a.number || 0) - (b.number || 0));
        next[key] = sorted[0].id;
      }
      return next;
    });
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
    const ok = await confirmDialog({
      title: "Delete this subject?",
      message: "This can't be undone.",
      confirmLabel: "Delete subject",
      tone: "danger",
    });
    if (!ok) return;
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

  const deleteSubjectQuestions = async (sid: string, name: string) => {
    // Fetch all questions of this subject (all pages) and bulk-delete.
    const ids: string[] = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams();
      params.set("subject_id", sid);
      params.set("pageSize", "500");
      params.set("page", String(page));
      const { data } = await api.get(`/questions?${params.toString()}`);
      const rows = data.questions || [];
      ids.push(...rows.map((q: any) => q.id));
      if (rows.length < 500 || ids.length >= (data.total ?? 0)) break;
      page++;
    }
    if (ids.length === 0) {
      setError(`No questions found for ${name}.`);
      return;
    }
    const ok = await confirmDialog({
      title: `Delete all ${ids.length} questions of "${name}"?`,
      message: "This can't be undone. Exams using these questions will be updated automatically.",
      confirmLabel: "Delete all",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await api.post("/questions/bulk-delete", { ids });
      await loadSubjects();
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to delete questions";
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
    const ok = await confirmDialog({
      title: "Delete this chapter?",
      message: "This can't be undone.",
      confirmLabel: "Delete chapter",
      tone: "danger",
    });
    if (!ok) return;
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

  const mergeChapters = async (sid: string, canonicalId: string, duplicateIds: string[]) => {
    setError(null);
    try {
      const { data } = await api.post(`/subjects/${sid}/chapters/merge`, { canonical_id: canonicalId, duplicate_ids: duplicateIds });
      if (!data?.ok || (data.deleted ?? 0) < duplicateIds.length) {
        setError(`Merge incomplete: moved ${data?.moved_questions ?? 0} questions, deleted ${data?.deleted ?? 0}/${duplicateIds.length} chapters.`);
      }
      await loadChapters(sid);
    } catch (e: any) {
      const status = e?.response?.status;
      const message = e?.response?.data?.error || e?.message || "Failed to merge chapters";
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
      {error && <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{error}</div>}
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
                <button
                  onClick={() => toggle(s.id)}
                  aria-expanded={expanded === s.id}
                  className="group flex items-center gap-2 font-medium"
                >
                  <ChevronRight
                    size={16}
                    className={cn(
                      "shrink-0 text-slate-400 transition-transform duration-200 ease-out group-hover:text-slate-200",
                      expanded === s.id && "rotate-90"
                    )}
                  />
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
                {(() => {
                  const list = chapters[s.id] || [];
                  const groupsMap = new Map<string, any[]>();
                  for (const ch of list) {
                    const key = normaliseTitle(ch.title);
                    if (!groupsMap.has(key)) groupsMap.set(key, []);
                    groupsMap.get(key)!.push(ch);
                  }
                  const dupGroups = [...groupsMap.entries()].filter(([, arr]) => arr.length > 1);
                  if (dupGroups.length === 0) return null;
                  return (
                    <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
                      <div className="text-sm font-medium text-amber-200">
                        Duplicate chapters detected ({dupGroups.length} group{dupGroups.length > 1 ? "s" : ""})
                      </div>
                      {dupGroups.map(([key, arr]) => {
                        const canonical = mergeCanonical[key] || arr[0].id;
                        const dupIds = arr.map((c: any) => c.id).filter((id: string) => id !== canonical);
                        return (
                          <div key={key} className="space-y-2 rounded-xl border border-amber-500/30 bg-slate-900/40 p-3">
                            <div className="text-xs text-slate-300">
                              “{arr[0].title}” — {arr.length} entries
                            </div>
                            <div className="space-y-1">
                              {arr.map((ch: any) => (
                                <div key={ch.id} className="flex items-center justify-between text-xs text-slate-200">
                                  <span>Ch. {ch.number} — {ch.title} <span className="text-slate-500">({ch.question_count ?? 0} questions)</span></span>
                                  {ch.id === canonical && <span className="text-emerald-400">canonical</span>}
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-slate-400">Merge into:</span>
                              <select
                                className="rounded-xl bg-slate-900/60 border border-slate-600/70 px-3 py-1.5 text-xs text-slate-100"
                                value={canonical}
                                onChange={(e) => setMergeCanonical((m) => ({ ...m, [key]: e.target.value }))}
                              >
                                {arr.map((ch: any) => (
                                  <option key={ch.id} value={ch.id}>Ch. {ch.number} — {ch.title} ({ch.question_count ?? 0} q)</option>
                                ))}
                              </select>
                              <Button
                                variant="outline"
                                onClick={() => mergeChapters(s.id, canonical, dupIds)}
                                disabled={dupIds.length === 0}
                              >
                                Merge {dupIds.length} duplicate{dupIds.length === 1 ? "" : "s"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
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
                {canManage && (
                  <div className="pt-2">
                    <Button variant="danger" onClick={() => deleteSubjectQuestions(s.id, s.name)}>
                      <Trash2 size={14} /> Delete all questions of this subject
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}