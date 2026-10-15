import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, Button, Select, Field, Input } from "../components/ui";
import { Printer } from "lucide-react";

export default function Print() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("Question Paper");
  const [school, setSchool] = useState("School Name");
  const [time, setTime] = useState(30);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [includeMarks, setIncludeMarks] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => { api.get("/subjects").then(r => setSubjects(r.data.subjects)); }, []);
  useEffect(() => {
    if (subjectId) api.get(`/subjects/${subjectId}/chapters`).then(r => setChapters(r.data.chapters));
    else setChapters([]);
    setChapterId("");
  }, [subjectId]);
  useEffect(() => {
    api.get("/questions").then(r => setQuestions(r.data.questions));
  }, []);

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);

  const selectedQs = questions.filter(q => selected.includes(q.id));
  const totalMarks = selectedQs.reduce((s, q) => s + (q.marks || 1), 0);

  const filteredQuestions = questions.filter(q => {
    if (subjectId && q.subject_id !== subjectId) return false;
    if (chapterId && q.chapter_id !== chapterId) return false;
    if (filterType && q.type !== filterType) return false;
    if (filterDifficulty && q.difficulty !== filterDifficulty) return false;
    if (search.trim() && !(q.prompt || "").toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });
  const allVisibleSelected = filteredQuestions.length > 0 && filteredQuestions.every(q => selected.includes(q.id));
  const toggleSelectAllVisible = () => {
    const visibleIds = new Set(filteredQuestions.map(q => q.id));
    if (allVisibleSelected) setSelected(s => s.filter(id => !visibleIds.has(id)));
    else setSelected(s => Array.from(new Set([...s, ...filteredQuestions.map(q => q.id)])));
  };
  const clearSelection = () => setSelected([]);

  const print = () => {
    const esc = (s: any) => String(s ?? "").replace(/</g, "&lt;");
    const qHtml = selectedQs.map((q, idx) => {
      let opts = "";
      if (q.type === "mcq") {
        const options = Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]");
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        opts = `<div class="options two-col">${options.map((o: string, i: number) => `
          <div class="opt"><span class="optmark">${letters[i] || i + 1}</span><span class="opttext">${esc(o)}</span></div>`).join("")}</div>`;
      }
      const marks = includeMarks ? ` <span class="marks">[${q.marks}]</span>` : "";
      return `<div class="q">
        <div class="qp"><b>${idx + 1}.</b> ${esc(q.prompt)}${marks}</div>
        ${opts}
      </div>`;
    }).join("");

    const ansHtml = selectedQs.map((q, idx) => {
      return `<div class="a"><b>${idx + 1}.</b> ${esc(q.answer || "-")} ${q.explanation ? `<div class="exp">${esc(q.explanation)}</div>` : ""}</div>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        @page {
          size: A4;
          margin: 0.5in 0.5in 0.15in 0.5in;
          @top-left-corner {
            content: counter(page);
            font-family: "Noto Serif Bengali", "Times New Roman", serif;
            font-size: 10pt;
            color: #333;
            padding: 4mm;
          }
          @top-right-corner {
            content: counter(page);
            font-family: "Noto Serif Bengali", "Times New Roman", serif;
            font-size: 10pt;
            color: #333;
            padding: 4mm;
          }
        }
        body {
          font-family: "Noto Serif Bengali", "Plus Jakarta Sans", serif !important;
          margin: 0;
          color: #000;
        }
        @media print {
          body { font-family: "Noto Serif Bengali", "Plus Jakarta Sans", serif !important; }
        }
        .qcol {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6mm 8mm;
          align-items: start;
        }
        .q {
          break-inside: avoid;
          page-break-inside: avoid;
          margin-bottom: 10px;
        }
        .options.two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2px 8px;
          margin-top: 4px;
        }
        .opt {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          break-inside: avoid;
        }
        .optmark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          min-width: 18px;
          border: 1px solid #000;
          border-radius: 50%;
          font-size: 10pt;
          line-height: 1;
        }
        .opttext { flex: 1; }
        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 16px; }
        .header h1 { margin: 0; font-size: 20px; }
        .meta { display: flex; justify-content: space-between; margin: 8px 0 16px; font-size: 13px; }
        .q { margin-bottom: 14px; break-inside: avoid; }
        .qp { line-height: 1.5; }
        .marks { float: right; font-size: 12px; color: #444; }
        .answers { page-break-before: always; }
        .a { margin-bottom: 10px; font-size: 13px; }
        .exp { font-size: 11px; color: #555; margin-left: 16px; }
        ol { margin: 0; }
      </style></head><body>
      <div class="header">
        <h1>${esc(school)}</h1>
        <div style="font-size:14px; margin-top:4px;">${esc(title)}</div>
      </div>
      <div class="meta">
        <span>Subject: ${esc(subjects.find(s=>s.id===subjectId)?.name || "")}</span>
        <span>Time: ${time} minutes</span>
        <span>Full Marks: ${totalMarks}</span>
      </div>
      <div class="qcol">${qHtml}</div>
      ${includeAnswers ? `<div class="answers"><h2>Answer Key & Mark Scheme</h2>${ansHtml}</div>` : ""}
      <script>window.onload=()=>{ if (document.fonts && document.fonts.ready) { document.fonts.ready.then(() => window.print()); } else { window.print(); } };</script>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Print Question Paper</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="space-y-3">
          <Field label="School / Institute"><Input value={school} onChange={e=>setSchool(e.target.value)} /></Field>
          <Field label="Paper Title"><Input value={title} onChange={e=>setTitle(e.target.value)} /></Field>
          <Field label="Subject">
            <Select value={subjectId} onChange={e=>setSubjectId(e.target.value)}>
              <option value="">All subjects</option>
              {subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Chapter">
            <Select value={chapterId} onChange={e=>setChapterId(e.target.value)}>
              <option value="">All chapters</option>
              {chapters.map(c=><option key={c.id} value={c.id}>Ch.{c.number} {c.title}</option>)}
            </Select>
          </Field>
          <Field label="Question Type">
            <Select value={filterType} onChange={e=>setFilterType(e.target.value)}>
              <option value="">All types</option>
              <option value="mcq">MCQ</option>
              <option value="short">Short</option>
              <option value="long">Long</option>
            </Select>
          </Field>
          <Field label="Difficulty">
            <Select value={filterDifficulty} onChange={e=>setFilterDifficulty(e.target.value)}>
              <option value="">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
          <Field label="Search question">
            <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="keyword..." />
          </Field>
          <Field label="Time (min)"><Input type="number" value={time} onChange={e=>setTime(Number(e.target.value))} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeAnswers} onChange={e=>setIncludeAnswers(e.target.checked)} /> Include answer key & mark scheme
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeMarks} onChange={e=>setIncludeMarks(e.target.checked)} /> Show marks per question
          </label>
          <div className="text-sm text-slate-400">Selected: {selected.length} questions · {totalMarks} marks</div>
          <Button onClick={print} disabled={selected.length===0} className="w-full"><Printer size={16}/> Print / Save PDF</Button>
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-sm font-medium">Select questions ({filteredQuestions.length} shown)</div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} /> Select all shown
              </label>
              <Button variant="ghost" onClick={clearSelection} className="text-xs px-2 py-1">Clear</Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-auto space-y-1">
            {filteredQuestions.map(q => (
              <label key={q.id} className="flex items-start gap-2 text-sm py-1 border-b border-slate-700/30">
                <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{q.prompt}</div>
                  <div className="text-xs text-slate-500">{q.type.toUpperCase()} · {q.marks}m{q.difficulty ? ` · ${q.difficulty}` : ""}</div>
                </div>
              </label>
            ))}
            {filteredQuestions.length === 0 && <div className="text-slate-500 text-xs">No questions. Adjust filters.</div>}
          </div>
          <div className="text-xs text-slate-400 mt-2">Selected total: {selected.length} questions (all subjects) · printing marks shown/hidden per settings.</div>
        </Card>
      </div>
    </div>
  );
}