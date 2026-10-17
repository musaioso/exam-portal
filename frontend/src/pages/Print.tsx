import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Card, Button, Select, Field, Input, Textarea } from "../components/ui";
import { Printer, FileText } from "lucide-react";

type Mode = "exam" | "manual";

export default function Print() {
  const [params, setParams] = useSearchParams();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);

  const initialExam = params.get("exam") || "";
  const [mode, setMode] = useState<Mode>(initialExam ? "exam" : "manual");
  const [examId, setExamId] = useState(initialExam);
  const [exam, setExam] = useState<any>(null);

  // manual picking
  const [chapters, setChapters] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  // paper settings
  const [title, setTitle] = useState("Question Paper");
  const [school, setSchool] = useState("School Name");
  const [time, setTime] = useState(30);
  const [columns, setColumns] = useState<1 | 2>(2);
  const [groupBySubject, setGroupBySubject] = useState(true);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [includeMarks, setIncludeMarks] = useState(true);
  const [showInstructions, setShowInstructions] = useState(true);
  const [instructions, setInstructions] = useState("Answer all questions. Marks are shown on the right side.");

  // manual filters
  const [filterType, setFilterType] = useState("");
  const [filterDifficulty, setFilterDifficulty] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/subjects").then(r => setSubjects(r.data.subjects || []));
    api.get("/exams").then(r => setExams(r.data.exams || []));
    api.get("/questions").then(r => setQuestions(r.data.questions || []));
  }, []);

  useEffect(() => {
    if (subjectId) api.get(`/subjects/${subjectId}/chapters`).then(r => setChapters(r.data.chapters || []));
    else setChapters([]);
    setChapterId("");
  }, [subjectId]);

  // Load the selected exam
  useEffect(() => {
    if (mode !== "exam" || !examId) { setExam(null); return; }
    api.get(`/exams/${examId}`).then(r => {
      const e = r.data.exam;
      setExam(e);
      setTitle(e.title || "Question Paper");
      setTime(e.duration_minutes || 30);
      setSelected(Array.isArray(e.question_ids) ? e.question_ids : []);
    }).catch(() => setExam(null));
    const next = new URLSearchParams(params);
    next.set("exam", examId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, examId]);

  const byId = useMemo(() => {
    const m: Record<string, any> = {};
    for (const q of questions) m[q.id] = q;
    return m;
  }, [questions]);

  const subjectName = (id?: string) => subjects.find(s => s.id === id)?.name || "Subject";

  // ordered selected questions
  const orderedSelected = useMemo(
    () => selected.map(id => byId[id]).filter(Boolean),
    [selected, byId]
  );
  const totalMarks = orderedSelected.reduce((s, q) => s + (q.marks || 1), 0);

  const subjectTimeMap = useMemo(() => {
    const m: Record<string, number> = {};
    if (exam && Array.isArray(exam.subject_times)) {
      for (const t of exam.subject_times) m[t.subject_id] = t.minutes;
    }
    return m;
  }, [exam]);

  // distinct subjects among printed questions
  const printedSubjects = useMemo(() => {
    const ids = Array.from(new Set(orderedSelected.map(q => q.subject_id).filter(Boolean)));
    const preferred: string[] = exam && Array.isArray(exam.subject_ids) ? exam.subject_ids : [];
    const ordered: string[] = [];
    for (const id of preferred) if (ids.includes(id)) ordered.push(id);
    for (const id of ids) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  }, [orderedSelected, exam]);
  const isMultiSubject = printedSubjects.length > 1;

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

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

  const buildPrint = () => {
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const parseOptions = (q: any) => {
      try { return Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]"); }
      catch { return []; }
    };
    const mkQ = (q: any) => ({
      prompt: q.prompt,
      type: q.type,
      options: parseOptions(q),
      marks: q.marks || 1,
      answer: q.answer || "",
      explanation: q.explanation || "",
      subject: subjectName(q.subject_id),
    });

    const subjectLine = isMultiSubject
      ? printedSubjects.map(subjectName).join(", ")
      : subjectName(printedSubjects[0] || exam?.subject_id);
    const perSubjectTime = isMultiSubject && printedSubjects.some(s => subjectTimeMap[s])
      ? ` (${printedSubjects.map(s => `${subjectName(s)} ${subjectTimeMap[s] || 0}m`).join(" · ")})`
      : "";

    const groups = (groupBySubject && isMultiSubject)
      ? printedSubjects
          .map(sid => ({ name: subjectName(sid), time: subjectTimeMap[sid] || 0, questions: orderedSelected.filter(q => q.subject_id === sid).map(mkQ) }))
          .filter(g => g.questions.length)
      : [{ name: subjectLine, time: 0, questions: orderedSelected.map(mkQ) }];

    const data = {
      subjectLine, time, perSubjectTime, totalMarks,
      groups,
      defaults: {
        school, title, instructions,
        columns, fontSize: 9, showHeader: true,
        showMarks: includeMarks, showAnswers: includeAnswers,
        showInstructions, groupBySubject, labelStyle: "auto", numStyle: "auto",
        date: new Date().toLocaleDateString("en-GB"),
        showName: true, showSchool: true, showTitle: true, showSubject: true,
        showTime: true, showFullMarks: true, showDate: true, showRollClass: false,
        runningTitle: true,
        showPageNo: true, pageNumPos: "alternate", pageNumFmt: "num",
      },
    };
    const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        @page { size: A4; margin: 0.5in 0.5in 0.15in 0.5in; }
        * { box-sizing: border-box; }
        html, body { margin: 0; }
        body { background: #0b1220; color: #e5e7eb; font-family: "Plus Jakarta Sans", system-ui, sans-serif; }
        .app { display: grid; grid-template-columns: 300px 1fr; height: 100vh; }
        .settings { background: #101a2e; border-right: 1px solid #1f2b45; padding: 14px; overflow: auto; }
        .settings h2 { font-size: 15px; margin: 0 0 6px; }
        .settings label { display: block; font-size: 12px; margin: 9px 0 3px; color: #9fb0cc; }
        .settings input[type=text], .settings input[type=number], .settings select, .settings textarea {
          width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid #2b3a58; background: #0b1220; color: #e5e7eb; font-size: 13px; font-family: inherit;
        }
        .settings .row { display: flex; align-items: center; gap: 8px; margin: 7px 0; font-size: 13px; }
        .settings .row input { width: auto; }
        .settings .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .btn { width: 100%; margin-top: 14px; padding: 10px; border: 0; border-radius: 10px; background: #4f46e5; color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; }
        .btn:hover { background: #4338ca; }
        .btn2 { width: 100%; margin-top: 8px; padding: 8px; border: 1px solid #2b3a58; border-radius: 10px; background: #16233d; color: #cdd8ee; font-weight: 600; font-size: 13px; cursor: pointer; }
        .btn2:hover { background: #1e2f52; }
        .sect { font-size: 11px; font-weight: 700; color: #cdd8ee; margin: 12px 0 4px; border-top: 1px solid #1f2b45; padding-top: 8px; }
        .tog { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 12px; }
        .tog label { display: flex; align-items: center; gap: 5px; margin: 0; color: #cdd8ee; }
        .tog input { width: auto; }
        .hint { font-size: 11px; color: #7c8aa8; margin-top: 10px; line-height: 1.5; }
        .stage { overflow: auto; padding: 18px; }
        .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; color: #000; padding: 12.7mm 12.7mm 3.81mm; box-shadow: 0 4px 24px rgba(0,0,0,.5); }
        .paper { font-family: "Noto Serif Bengali", "Plus Jakarta Sans", "Nirmala UI", serif; font-size: var(--fs, 9pt); line-height: 1.22; color: #000; }
        .header { margin-bottom: 1px; }
        .header .hrow { display: grid; grid-template-columns: 1fr auto 1fr; gap: 4mm; align-items: baseline; }
        .header .hleft { text-align: left; }
        .header .hcenter { text-align: center; }
        .header .hright { text-align: right; }
        .header .h-school { font-size: 12.5pt; font-weight: 700; line-height: 1.1; }
        .header .h-title { font-size: 9.5pt; line-height: 1.15; }
        .header .h-subject { font-size: 8.5pt; line-height: 1.15; }
        .header .h-meta { font-size: 8.5pt; line-height: 1.15; }
        .header .hname, .header .hdate { font-size: 9pt; }
        .header .hleft .fill { min-width: 32mm; }
        .header .hright .fill { min-width: 26mm; }
        .header .rule { border-bottom: 1.2px solid #000; margin-top: 1px; }
        .studentinfo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 9pt; margin: 1px 0 3px; }
        .fill { border-bottom: 1px dotted #555; display: inline-block; min-width: 60px; }
        .instructions { border: 1px solid #999; border-radius: 3px; padding: 2px 5px; font-size: 8pt; margin: 0 0 3px; background: #fafafa; }
        .qcol { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 1.4mm 6mm; align-items: start; }
        .section { font-size: 11pt; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 1px; margin: 5px 0 3px; break-after: avoid; }
        .sectime { font-size: 8.5pt; font-weight: normal; color: #444; }
        .q { break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.4mm; }
        .qp { display: grid; grid-template-columns: auto 1fr auto; gap: 0 3px; align-items: start; }
        .qno { font-weight: 700; }
        .qmarks { white-space: nowrap; font-size: 8pt; color: #333; }
        .options { margin-top: 1px; }
        .options.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 4mm; }
        .opt { display: grid; grid-template-columns: auto 1fr; gap: 3px; break-inside: avoid; page-break-inside: avoid; }
        .optmark { display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; border: 1px solid #000; border-radius: 50%; font-size: 7.5pt; line-height: 1; }
        .answers { break-before: page; page-break-before: always; margin-top: 4px; }
        .answers h2 { font-size: 12pt; border-bottom: 1.2px solid #000; padding-bottom: 2px; margin: 0 0 5px; }
        .anscol { columns: 2; column-gap: 6mm; }
        .a { font-size: 9pt; break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.5mm; }
        .ansubj { color: #555; font-size: 8pt; }
        .exp { font-size: 8pt; color: #555; margin-left: 12px; }
        @media print {
          body { background: #fff; }
          .app { display: block; height: auto; }
          .settings { display: none !important; }
          .stage { overflow: visible; padding: 0; }
          .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
        }
      </style><style id="pagestyle"></style></head>
      <body>
      <div class="app">
        <aside class="settings">
          <h2>Print settings</h2>
          <label>School / Institute</label><input type="text" id="f-school">
          <label>Paper title</label><input type="text" id="f-title">
          <label>Date</label><input type="text" id="f-date">
          <div class="grid2">
            <div><label>Columns</label><select id="f-cols"><option value="2">2 columns</option><option value="1">1 column</option></select></div>
            <div><label>Font size (pt)</label><input type="number" id="f-fs" min="7" max="14" step="0.5"></div>
          </div>
          <label>Option labels</label>
          <select id="f-labels"><option value="auto">Auto (Bangla ক, English a)</option><option value="bangla">ক খ গ ঘ</option><option value="english">a b c d</option></select>
          <label>Question numbers</label>
          <select id="f-num"><option value="auto">Auto (Bangla ১, English 1)</option><option value="bangla">১ ২ ৩ ৪</option><option value="english">1 2 3 4</option></select>
          <div class="row"><input type="checkbox" id="f-header"><label for="f-header" style="margin:0">Show header block</label></div>
          <div class="sect">Header items</div>
          <div class="tog">
            <label><input type="checkbox" id="t-name"> Name</label>
            <label><input type="checkbox" id="t-date"> Date</label>
            <label><input type="checkbox" id="t-school"> School</label>
            <label><input type="checkbox" id="t-title"> Paper title</label>
            <label><input type="checkbox" id="t-subject"> Subject</label>
            <label><input type="checkbox" id="t-time"> Time</label>
            <label><input type="checkbox" id="t-marks"> Full marks</label>
            <label><input type="checkbox" id="t-rollclass"> Roll &amp; Class</label>
            <label><input type="checkbox" id="t-runningtitle"> Margin title</label>
          </div>
          <div class="sect">Page numbers</div>
          <div class="tog">
            <label><input type="checkbox" id="t-pageno"> Show page numbers</label>
          </div>
          <label>Page number position</label>
          <select id="f-pagenumpos">
            <option value="alternate">Alternate (1 right, 2 left)</option>
            <option value="both">Both corners</option>
            <option value="left">Left only</option>
            <option value="right">Right only</option>
          </select>
          <label>Page number format</label>
          <select id="f-pagenumfmt">
            <option value="num">Number only</option>
            <option value="of">Page X / Y</option>
          </select>
          <div class="row"><input type="checkbox" id="f-marks"><label for="f-marks" style="margin:0">Show marks per question</label></div>
          <div class="row"><input type="checkbox" id="f-instr"><label for="f-instr" style="margin:0">Show instructions box</label></div>
          <label>Instructions</label><textarea id="f-instrtext" rows="2"></textarea>
          <div class="row"><input type="checkbox" id="f-group"><label for="f-group" style="margin:0">Group by subject</label></div>
          <div class="row"><input type="checkbox" id="f-answers"><label for="f-answers" style="margin:0">Include answer key</label></div>
          <button class="btn2" id="shuffleBtn">⇄ Shuffle options</button>
          <button class="btn2" id="resetBtn">↺ Reset option order</button>
          <button class="btn" id="printBtn">Print / Save PDF</button>
          <div class="hint">Chrome print dialog: Destination <b>Save as PDF</b>, Paper size <b>A4</b>, Margins <b>Default</b>.</div>
        </aside>
        <main class="stage"><div class="sheet"><div class="paper" id="paper"></div></div></main>
      </div>
      <script>
        var DATA = ${dataJson};
        var S = Object.assign({}, DATA.defaults);
        DATA.groups.forEach(function(g){ g.questions.forEach(function(q){ q._orig = (q.options || []).slice(); }); });
        var paper = document.getElementById('paper');
        function esc(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        function isBangla(s){ s = String(s || ''); for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0x0980 && c <= 0x09FF) return true; } return false; }
        function bnDigits(n){ return String(n).replace(/\\d/g, function(x){ return '০১২৩৪৫৬৭৮৯'[+x]; }); }
        function qNo(q, n){
          var useBn = S.numStyle === 'bangla' || (S.numStyle !== 'english' && isBangla(q.prompt));
          return (useBn ? bnDigits(n) : String(n)) + '.';
        }
        function labels(prompt, style){
          if (style === 'bangla') return ['ক','খ','গ','ঘ','ঙ','চ','ছ','জ'];
          if (style === 'english') return ['a','b','c','d','e','f','g','h'];
          return isBangla(prompt) ? ['ক','খ','গ','ঘ','ঙ','চ','ছ','জ'] : ['a','b','c','d','e','f','g','h'];
        }
        function correctLetter(q){
          if (q.type !== 'mcq' || !q.options) return '';
          var idx = q.options.indexOf(q.answer);
          if (idx < 0) return '';
          var L = labels(q.prompt, S.labelStyle);
          return L[idx] || String(idx + 1);
        }
        function safeCss(s){ return String(s || '').split('"').join("'").split(String.fromCharCode(92)).join(' ').split(String.fromCharCode(10)).join(' ').split(String.fromCharCode(13)).join(' '); }
        function pageCss(){
          var css = '';
          if (S.runningTitle) css += '@page { @top-center { content: "' + safeCss(S.title) + '"; font-size: 8pt; color: #666; } }';
          if (S.showPageNo) {
            var fmt = S.pageNumFmt === 'of' ? '"Page " counter(page) " / " counter(pages)' : 'counter(page)';
            var box = 'content: ' + fmt + '; font-size: 8pt; color: #222;';
            var pos = S.pageNumPos || 'alternate';
            if (pos === 'left') css += '@page { @top-left-corner { ' + box + ' padding: 1.5mm 0 0 1.5mm; } }';
            else if (pos === 'right') css += '@page { @top-right-corner { ' + box + ' padding: 1.5mm 1.5mm 0 0; } }';
            else if (pos === 'both') css += '@page { @top-left-corner { ' + box + ' padding: 1.5mm 0 0 1.5mm; } @top-right-corner { ' + box + ' padding: 1.5mm 1.5mm 0 0; } }';
            else {
              css += '@page :right { @top-right-corner { ' + box + ' padding: 1.5mm 1.5mm 0 0; } }';
              css += '@page :left { @top-left-corner { ' + box + ' padding: 1.5mm 0 0 1.5mm; } }';
            }
          }
          return css;
        }
        function qHtml(q, n){
          var L = labels(q.prompt, S.labelStyle), opts = '';
          if (q.type === 'mcq' && q.options && q.options.length) {
            opts = '<div class="options two-col">' + q.options.map(function(o, i){
              return '<div class="opt"><span class="optmark">' + (L[i] || (i + 1)) + '</span><span class="opttext">' + esc(o) + '</span></div>';
            }).join('') + '</div>';
          }
          var marks = S.showMarks ? '<span class="qmarks">[' + (q.marks || 1) + ']</span>' : '';
          return '<div class="q"><div class="qp"><span class="qno">' + qNo(q, n) + '</span><span class="qtext">' + esc(q.prompt) + '</span>' + marks + '</div>' + opts + '</div>';
        }
        function headerHtml(){
          var left = S.showName ? '<div class="hname">Name: <span class="fill"></span></div>' : '';
          var c = '';
          if (S.showSchool) c += '<div class="h-school">' + esc(S.school) + '</div>';
          if (S.showTitle) c += '<div class="h-title">' + esc(S.title) + '</div>';
          if (S.showSubject) c += '<div class="h-subject">Subject: <b>' + esc(DATA.subjectLine) + '</b></div>';
          var meta = [];
          if (S.showTime) meta.push('Time: <b>' + DATA.time + ' minutes</b>' + esc(DATA.perSubjectTime));
          if (S.showFullMarks) meta.push('Full Marks: <b>' + DATA.totalMarks + '</b>');
          if (meta.length) c += '<div class="h-meta">' + meta.join(' &nbsp;&middot;&nbsp; ') + '</div>';
          var right = S.showDate ? '<div class="hdate">Date: ' + (S.date ? '<b>' + esc(S.date) + '</b>' : '<span class="fill"></span>') + '</div>' : '';
          var html = '<div class="header"><div class="hrow">' +
            '<div class="hleft">' + left + '</div>' +
            '<div class="hcenter">' + c + '</div>' +
            '<div class="hright">' + right + '</div>' +
            '</div><div class="rule"></div></div>';
          if (S.showRollClass) html += '<div class="studentinfo"><span>Roll: <span class="fill"></span></span><span>Class/Sec: <span class="fill"></span></span></div>';
          return html;
        }
        function shuffleAll(){
          var qs = [];
          DATA.groups.forEach(function(g){ g.questions.forEach(function(q){ if (q.type === 'mcq' && q.options && q.options.length > 1) qs.push(q); }); });
          var seq = [], last = -1, run = 0, used = {}, seen = {};
          qs.forEach(function(q){
            var n = q.options.length, arr = q.options.slice(), correctText = q.answer, ci = arr.indexOf(correctText);
            var cands = []; for (var p = 0; p < n; p++) cands.push(p);
            function build(){
              var o = arr.filter(function(x){ return x !== correctText; });
              for (var i = o.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = o[i]; o[i] = o[j]; o[j] = t; }
              if (ci >= 0) o.splice(target, 0, correctText);
              return o;
            }
            function bad(p){
              if (p === last && run >= 2) return true;
              var s = seq.concat([p]), L = s.length;
              for (var per = 2; per <= 4; per++) {
                if (L >= 2 * per) {
                  var good = true;
                  for (var k = 0; k < per; k++) { if (s[L - 1 - k] !== s[L - 1 - k - per]) { good = false; break; } }
                  if (good) return true;
                }
              }
              return false;
            }
            var filt = cands.filter(function(p){ return !bad(p); });
            if (!filt.length) filt = cands.filter(function(p){ return !(p === last && run >= 2); });
            if (!filt.length) filt = cands;
            filt.sort(function(a, b){ var da = used[a] || 0, db = used[b] || 0; if (da !== db) return da - db; return Math.random() - 0.5; });
            var target = filt[0];
            var newArr = build(), sig = JSON.stringify(newArr), tries = 0;
            while ((seen[sig] || 0) >= 2 && tries < 8) { newArr = build(); sig = JSON.stringify(newArr); tries++; }
            seen[sig] = (seen[sig] || 0) + 1;
            q.options = newArr;
            seq.push(target);
            used[target] = (used[target] || 0) + 1;
            if (target === last) run++; else { last = target; run = 1; }
          });
          render();
        }
        function resetOrder(){
          DATA.groups.forEach(function(g){ g.questions.forEach(function(q){ if (q._orig) q.options = q._orig.slice(); }); });
          render();
        }
        function render(){
          paper.style.setProperty('--fs', S.fontSize + 'pt');
          paper.style.setProperty('--cols', S.columns);
          var html = '';
          if (S.showHeader) html += headerHtml();
          if (S.showInstructions && S.instructions && S.instructions.trim()) html += '<div class="instructions"><b>Instructions:</b> ' + esc(S.instructions) + '</div>';
          if (S.groupBySubject && DATA.groups.length > 1) {
            var n = 0;
            DATA.groups.forEach(function(g){
              html += '<h3 class="section">' + esc(g.name) + (g.time ? ' <span class="sectime">(' + g.time + ' min)</span>' : '') + '</h3>';
              html += '<div class="qcol">' + g.questions.map(function(q){ n++; return qHtml(q, n); }).join('') + '</div>';
            });
          } else {
            var all = [];
            DATA.groups.forEach(function(g){ g.questions.forEach(function(q){ all.push(q); }); });
            html += '<div class="qcol">' + all.map(function(q, i){ return qHtml(q, i + 1); }).join('') + '</div>';
          }
          if (S.showAnswers) {
            var an = '', k = 0;
            DATA.groups.forEach(function(g){ g.questions.forEach(function(q){
              k++;
              var subj = DATA.groups.length > 1 ? ' <span class="ansubj">[' + esc(q.subject || '') + ']</span>' : '';
              var cl = correctLetter(q);
              an += '<div class="a"><b>' + qNo(q, k) + '</b>' + subj + ' ' + (cl ? '<b>' + cl + ')</b> ' : '') + esc(q.answer || '-') + ' ' + (q.explanation ? '<div class="exp">' + esc(q.explanation) + '</div>' : '') + '</div>';
            }); });
            html += '<div class="answers"><h2>Answer Key &amp; Mark Scheme</h2><div class="anscol">' + an + '</div></div>';
          }
          paper.innerHTML = html;
          var pgs = document.getElementById('pagestyle');
          if (pgs) pgs.textContent = pageCss();
        }
        function bind(id, key, kind){
          var el = document.getElementById(id);
          if (!el) return;
          var h = function(){
            if (kind === 'bool') S[key] = el.checked;
            else if (kind === 'num') S[key] = Number(el.value);
            else S[key] = el.value;
            render();
          };
          el.addEventListener('input', h);
          el.addEventListener('change', h);
        }
        document.getElementById('f-school').value = S.school || '';
        document.getElementById('f-title').value = S.title || '';
        document.getElementById('f-date').value = S.date || '';
        document.getElementById('f-fs').value = S.fontSize;
        document.getElementById('f-cols').value = String(S.columns);
        document.getElementById('f-labels').value = S.labelStyle || 'auto';
        document.getElementById('f-num').value = S.numStyle || 'auto';
        document.getElementById('f-header').checked = S.showHeader !== false;
        document.getElementById('f-marks').checked = !!S.showMarks;
        document.getElementById('f-instr').checked = !!S.showInstructions;
        document.getElementById('f-instrtext').value = S.instructions || '';
        document.getElementById('f-group').checked = !!S.groupBySubject;
        document.getElementById('f-answers').checked = !!S.showAnswers;
        document.getElementById('t-name').checked = S.showName !== false;
        document.getElementById('t-school').checked = S.showSchool !== false;
        document.getElementById('t-title').checked = S.showTitle !== false;
        document.getElementById('t-subject').checked = S.showSubject !== false;
        document.getElementById('t-time').checked = S.showTime !== false;
        document.getElementById('t-marks').checked = S.showFullMarks !== false;
        document.getElementById('t-date').checked = S.showDate !== false;
        document.getElementById('t-rollclass').checked = !!S.showRollClass;
        document.getElementById('t-runningtitle').checked = S.runningTitle !== false;
        document.getElementById('t-pageno').checked = S.showPageNo !== false;
        document.getElementById('f-pagenumpos').value = S.pageNumPos || 'alternate';
        document.getElementById('f-pagenumfmt').value = S.pageNumFmt || 'num';
        bind('f-school', 'school', 'text');
        bind('f-title', 'title', 'text');
        bind('f-date', 'date', 'text');
        bind('f-fs', 'fontSize', 'num');
        bind('f-cols', 'columns', 'num');
        bind('f-labels', 'labelStyle', 'sel');
        bind('f-num', 'numStyle', 'sel');
        bind('f-header', 'showHeader', 'bool');
        bind('f-marks', 'showMarks', 'bool');
        bind('f-instr', 'showInstructions', 'bool');
        bind('f-instrtext', 'instructions', 'text');
        bind('f-group', 'groupBySubject', 'bool');
        bind('f-answers', 'showAnswers', 'bool');
        bind('t-name', 'showName', 'bool');
        bind('t-school', 'showSchool', 'bool');
        bind('t-title', 'showTitle', 'bool');
        bind('t-subject', 'showSubject', 'bool');
        bind('t-time', 'showTime', 'bool');
        bind('t-marks', 'showFullMarks', 'bool');
        bind('t-date', 'showDate', 'bool');
        bind('t-rollclass', 'showRollClass', 'bool');
        bind('t-runningtitle', 'runningTitle', 'bool');
        bind('t-pageno', 'showPageNo', 'bool');
        bind('f-pagenumpos', 'pageNumPos', 'sel');
        bind('f-pagenumfmt', 'pageNumFmt', 'sel');
        document.getElementById('shuffleBtn').addEventListener('click', function(){ shuffleAll(); });
        document.getElementById('resetBtn').addEventListener('click', function(){ resetOrder(); });
        document.getElementById('printBtn').addEventListener('click', function(){
          if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ window.print(); }); }
          else { window.print(); }
        });
        render();
      </script>
      </body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  };

  const loadExamIntoManual = (id: string) => {
    setMode("exam");
    setExamId(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Print Question Paper</h1>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => { setMode("exam"); }}
            className={`px-3 py-1.5 rounded-xl border ${mode === "exam" ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-300 hover:bg-ink/5"}`}
          >
            From a ready exam
          </button>
          <button
            type="button"
            onClick={() => { setMode("manual"); setExam(null); setSelected([]); setTitle("Question Paper"); }}
            className={`px-3 py-1.5 rounded-xl border ${mode === "manual" ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-300 hover:bg-ink/5"}`}
          >
            Pick questions manually
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="space-y-3">
          {mode === "exam" && (
            <Field label="Ready exam">
              <Select value={examId} onChange={e => setExamId(e.target.value)} placeholder="Select an exam...">
                <option value="">Select an exam...</option>
                {exams.map(ex => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title} · {(Array.isArray(ex.subject_ids) ? ex.subject_ids.length : 1)} subject(s) · {ex.total_marks}m
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="School / Institute"><Input value={school} onChange={e => setSchool(e.target.value)} /></Field>
          <Field label="Paper Title"><Input value={title} onChange={e => setTitle(e.target.value)} /></Field>

          {mode === "manual" && (
            <>
              <Field label="Subject">
                <Select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                  <option value="">All subjects</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Chapter">
                <Select value={chapterId} onChange={e => setChapterId(e.target.value)}>
                  <option value="">All chapters</option>
                  {chapters.map(c => <option key={c.id} value={c.id}>Ch.{c.number} {c.title}</option>)}
                </Select>
              </Field>
              <Field label="Question Type">
                <Select value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="">All types</option>
                  <option value="mcq">MCQ</option>
                  <option value="short">Short</option>
                  <option value="long">Long</option>
                </Select>
              </Field>
              <Field label="Difficulty">
                <Select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value)}>
                  <option value="">All difficulties</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>
              <Field label="Search question">
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="keyword..." />
              </Field>
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Time (min)"><Input type="number" value={time} onChange={e => setTime(Number(e.target.value))} /></Field>
            <Field label="Columns">
              <Select value={String(columns)} onChange={e => setColumns(Number(e.target.value) === 1 ? 1 : 2)}>
                <option value="2">2 columns</option>
                <option value="1">1 column</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={groupBySubject} onChange={e => setGroupBySubject(e.target.checked)} /> Group by subject (multi-subject)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeAnswers} onChange={e => setIncludeAnswers(e.target.checked)} /> Include answer key &amp; mark scheme
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeMarks} onChange={e => setIncludeMarks(e.target.checked)} /> Show marks per question
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInstructions} onChange={e => setShowInstructions(e.target.checked)} /> Include instructions box
          </label>
          {showInstructions && (
            <Field label="Instructions">
              <Textarea rows={2} value={instructions} onChange={e => setInstructions(e.target.value)} />
            </Field>
          )}

          {exam && (
            <div className="text-xs text-slate-400 rounded-xl border border-slate-700 p-2 space-y-1">
              <div className="flex items-center gap-1 text-slate-300"><FileText size={13} /> {exam.title}</div>
              <div>{exam.is_published ? "Published" : "Draft"} · {exam.duration_minutes} min · {exam.total_marks} marks</div>
              {isMultiSubject && (
                <div>
                  {printedSubjects.map(s => (
                    <div key={s}>• {subjectName(s)}: {orderedSelected.filter(q => q.subject_id === s).length} q{subjectTimeMap[s] ? ` · ${subjectTimeMap[s]} min` : ""}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-sm text-slate-400">Selected: {selected.length} questions · {totalMarks} marks{isMultiSubject ? ` · ${printedSubjects.length} subjects` : ""}</div>
          <Button onClick={buildPrint} disabled={selected.length === 0} className="w-full"><Printer size={16} /> Preview &amp; Print</Button>
          <div className="text-xs text-slate-500">Opens a preview window where you can adjust settings, then print/save as PDF.</div>
        </Card>

        <Card className="lg:col-span-2">
          {mode === "exam" ? (
            exam ? (
              <>
                <div className="text-sm font-medium mb-2">Exam questions ({selected.length} selected of {exam.question_ids.length})</div>
                <div className="max-h-[60vh] overflow-auto space-y-1">
                  {selected.map((id, i) => {
                    const q = byId[id];
                    if (!q) return null;
                    return (
                      <label key={id} className="flex items-start gap-2 text-sm py-1 border-b border-slate-700/30">
                        <input type="checkbox" checked onChange={() => toggle(id)} className="mt-1" />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{i + 1}. {q.prompt}</div>
                          <div className="text-xs text-slate-500">{subjectName(q.subject_id)} · {String(q.type).toUpperCase()} · {q.marks}m{q.difficulty ? ` · ${q.difficulty}` : ""}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="text-xs text-slate-400 mt-2">Uncheck any question to leave it out of the print copy.</div>
              </>
            ) : (
              <div className="text-slate-400 text-sm">Select a ready exam from the left to load its questions.</div>
            )
          ) : (
            <>
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
                      <div className="text-xs text-slate-500">{subjectName(q.subject_id)} · {q.type.toUpperCase()} · {q.marks}m{q.difficulty ? ` · ${q.difficulty}` : ""}</div>
                    </div>
                  </label>
                ))}
                {filteredQuestions.length === 0 && <div className="text-slate-500 text-xs">No questions. Adjust filters.</div>}
              </div>
              <div className="text-xs text-slate-400 mt-2">Selected total: {selected.length} questions · {totalMarks} marks.</div>
            </>
          )}
        </Card>
      </div>

      {mode === "manual" && exams.length > 0 && (
        <div className="text-xs text-slate-500">
          Tip: to print a ready exam, switch to <button className="text-indigo-300 underline" onClick={() => setMode("exam")}>From a ready exam</button> and pick one.
          {exams[0] && <span> Or open <button className="text-indigo-300 underline" onClick={() => loadExamIntoManual(exams[0].id)}>{exams[0].title}</button>.</span>}
        </div>
      )}
    </div>
  );
}
