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

  useEffect(() => { api.get("/subjects").then(r => setSubjects(r.data.subjects)); }, []);
  useEffect(() => {
    if (subjectId) api.get(`/subjects/${subjectId}/chapters`).then(r => setChapters(r.data.chapters));
    else setChapters([]);
  }, [subjectId]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (subjectId) params.set("subject_id", subjectId);
    if (chapterId) params.set("chapter_id", chapterId);
    api.get(`/questions?${params.toString()}`).then(r => setQuestions(r.data.questions));
  }, [subjectId, chapterId]);

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);

  const selectedQs = questions.filter(q => selected.includes(q.id));
  const totalMarks = selectedQs.reduce((s, q) => s + (q.marks || 1), 0);

  const print = () => {
    const esc = (s: any) => String(s ?? "").replace(/</g, "&lt;");
    const qHtml = selectedQs.map((q, idx) => {
      let opts = "";
      if (q.type === "mcq") {
        const options = Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]");
        opts = `<ol type="A" style="margin:6px 0 6px 24px;">${options.map((o: string) => `<li>${esc(o)}</li>`).join("")}</ol>`;
      }
      return `<div class="q">
        <div class="qp"><b>${idx + 1}.</b> ${esc(q.prompt)} <span class="marks">[${q.marks}]</span></div>
        ${opts}
      </div>`;
    }).join("");

    const ansHtml = selectedQs.map((q, idx) => {
      return `<div class="a"><b>${idx + 1}.</b> ${esc(q.answer || "-")} ${q.explanation ? `<div class="exp">${esc(q.explanation)}</div>` : ""}</div>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali&display=swap" rel="stylesheet">
      <style>
        body { font-family: "Times New Roman", serif; margin: 30px; color: #000; }
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
      <div>${qHtml}</div>
      ${includeAnswers ? `<div class="answers"><h2>Answer Key & Mark Scheme</h2>${ansHtml}</div>` : ""}
      <script>window.onload=()=>{window.print();}</script>
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
          <Field label="Time (min)"><Input type="number" value={time} onChange={e=>setTime(Number(e.target.value))} /></Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeAnswers} onChange={e=>setIncludeAnswers(e.target.checked)} /> Include answer key & mark scheme
          </label>
          <div className="text-sm text-slate-400">Selected: {selected.length} questions · {totalMarks} marks</div>
          <Button onClick={print} disabled={selected.length===0} className="w-full"><Printer size={16}/> Print / Save PDF</Button>
        </Card>

        <Card className="lg:col-span-2">
          <div className="text-sm font-medium mb-2">Select questions</div>
          <div className="max-h-[60vh] overflow-auto space-y-1">
            {questions.map(q => (
              <label key={q.id} className="flex items-start gap-2 text-sm py-1 border-b border-slate-700/30">
                <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} className="mt-1" />
                <div className="flex-1">
                  <div className="truncate">{q.prompt}</div>
                  <div className="text-xs text-slate-500">{q.type.toUpperCase()} · {q.marks}m</div>
                </div>
              </label>
            ))}
            {questions.length === 0 && <div className="text-slate-500 text-xs">No questions. Adjust filters.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}