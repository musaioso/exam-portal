/**
 * Print preview document builder.
 *
 * Builds the standalone HTML shown in the preview window. The chrome
 * (settings sidebar, stage, buttons) is skinned with the SAME design tokens
 * the website uses (theme.css, inlined below), so the preview follows the
 * site's light/dark theme and green/teal palette. The paper sheet itself
 * stays neutral (white/black) because it is what gets printed.
 *
 * The preview opens at the real URL /print/preview (see PrintPreview.tsx),
 * which reads the staged payload from sessionStorage — no more about:blank.
 */

import themeCss from "../theme.css?inline";

/** Session-storage key carrying the staged payload to the preview tab. */
export const PREVIEW_STORAGE_KEY = "mcq_print_preview";

export interface PrintQuestion {
  prompt: string;
  type: string;
  options: string[];
  marks: number;
  answer: string;
  explanation: string;
  subject: string;
}

export interface PrintGroup {
  name: string;
  time: number;
  questions: PrintQuestion[];
}

export interface PrintDefaults {
  school: string;
  title: string;
  instructions: string;
  columns: number;
  fontSize: number;
  showHeader: boolean;
  showMarks: boolean;
  showAnswers: boolean;
  showInstructions: boolean;
  groupBySubject: boolean;
  labelStyle: string;
  numStyle: string;
  date: string;
  showName: boolean;
  showSchool: boolean;
  showTitle: boolean;
  showSubject: boolean;
  showTime: boolean;
  showFullMarks: boolean;
  showDate: boolean;
  showRollClass: boolean;
  runningTitle: boolean;
  showPageNo: boolean;
  pageNumPos: string;
  pageNumFmt: string;
}

export interface PrintData {
  subjectLine: string;
  time: number;
  perSubjectTime: string;
  totalMarks: number;
  groups: PrintGroup[];
  defaults: PrintDefaults;
}

/** Options may arrive as a real array or as a JSON string (legacy rows). */
export function parseOptions(q: any): string[] {
  try {
    return Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]");
  } catch {
    return [];
  }
}

export function buildPrintHtml(data: PrintData): string {
  const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = data.defaults?.title || "Question Paper";
  const fontsHref =
    "https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <script>
        /* Apply the saved theme before first paint (same boot script as index.html). */
        (function () {
          try {
            var saved = localStorage.getItem("mcq_theme");
            var theme = saved === "light" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", theme);
            document.documentElement.style.colorScheme = theme;
          } catch (e) {
            document.documentElement.setAttribute("data-theme", "dark");
          }
        })();
      </script>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <style>${themeCss}</style>
      <style>
        @page { size: A4; margin: 0.5in 0.5in 0.15in 0.5in; }
        * { box-sizing: border-box; }
        html, body { margin: 0; }
        body {
          min-height: 100vh;
          background: var(--page-bg);
          color: var(--text);
          font-family: "Plus Jakarta Sans", "Noto Serif Bengali", "Segoe UI", system-ui, sans-serif;
        }
        /* Same floating bubbles as the site backdrop. */
        body::before, body::after {
          content: "";
          position: fixed;
          border-radius: 9999px;
          pointer-events: none;
          z-index: 0;
          filter: blur(30px);
          opacity: 0.55;
          animation: bubbleFloat 16s ease-in-out infinite alternate;
        }
        body::before { width: 280px; height: 280px; top: -80px; left: -60px; background: radial-gradient(circle, var(--bubble-1), transparent 65%); }
        body::after { width: 360px; height: 360px; bottom: -120px; right: -90px; background: radial-gradient(circle, var(--bubble-2), transparent 65%); animation-duration: 22s; }
        @keyframes bubbleFloat {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(40px, -30px) scale(1.15); }
        }

        .app { display: grid; grid-template-columns: 300px 1fr; height: 100vh; position: relative; z-index: 1; }
        .settings {
          background: var(--glass-bg);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-right: 1px solid var(--glass-border);
          padding: 14px;
          overflow: auto;
          color: var(--text);
        }
        .settings h2 { font-size: 15px; margin: 0 0 6px; color: var(--color-slate-300); }
        .settings label { display: block; font-size: 11px; margin: 9px 0 3px; color: var(--color-slate-400); letter-spacing: 0.02em; }
        .settings input[type=text], .settings input[type=number], .settings select, .settings textarea {
          width: 100%; padding: 8px 12px; border-radius: 1rem; border: 1px solid var(--border); background: var(--field-bg); color: var(--field-text); font-size: 13px; font-family: inherit;
        }
        /* Native selects + dropdown popups follow the theme, with the same
           rules as index.css so they match the app exactly in both modes:
           themed chevron, app-matched padding, themed popup options. */
        .settings select {
          appearance: none;
          -webkit-appearance: none;
          padding: 10px 34px 10px 14px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238bb39c' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          background-size: 14px 14px;
        }
        html[data-theme="light"] .settings select {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23456b55' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        }
        .settings option, .settings optgroup { background-color: var(--field-bg); color: var(--field-text); color-scheme: dark; }
        html[data-theme="light"] .settings option, html[data-theme="light"] .settings optgroup { color-scheme: light; }
        /* Themed stepper replacing the native (unthemeable) spin buttons. */
        .settings input[type=number] { -moz-appearance: textfield; appearance: textfield; }
        .settings input[type=number]::-webkit-outer-spin-button,
        .settings input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .stepper { display: flex; align-items: stretch; gap: 6px; }
        .stepper input { flex: 1; min-width: 0; text-align: center; }
        .step {
          width: 34px; flex: none; border: 1px solid var(--border); border-radius: 1rem;
          background: var(--surface-2); color: var(--text); font-weight: 700; font-size: 14px; cursor: pointer;
          transition: border-color 0.2s ease, filter 0.2s ease;
        }
        .step:hover { border-color: var(--color-violet-400); filter: brightness(1.12); }
        .settings input:focus, .settings select:focus, .settings textarea:focus {
          outline: none; border-color: var(--color-violet-500); box-shadow: 0 0 0 2px var(--color-violet-500);
        }
        .settings .row { display: flex; align-items: center; gap: 8px; margin: 7px 0; font-size: 13px; color: var(--color-slate-300); }
        .settings .row input { width: auto; }
        .settings .row label, .settings .tog label { cursor: pointer; }
        /* Tick boxes: same skin as the app (index.css), curved a little more.
           appearance:none removes the OS focus rectangle that used to stay
           after a click; the tick is the brand green on the themed field bg. */
        .settings input[type=checkbox] {
          appearance: none;
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          flex: none;
          border: 1.5px solid var(--color-slate-600);
          border-radius: 0.5rem;
          background-color: var(--field-bg);
          background-repeat: no-repeat;
          background-position: center;
          background-size: 0.75rem 0.75rem;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .settings input[type=checkbox]:hover { border-color: var(--color-indigo-400); }
        .settings input[type=checkbox]:checked {
          background-color: var(--color-indigo-500);
          border-color: var(--color-indigo-500);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23ffffff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.4 8.6l3 3 6.2-7'/%3E%3C/svg%3E");
        }
        .settings input[type=checkbox]:focus, .settings input[type=checkbox]:focus-visible { outline: none; box-shadow: none; }
        .settings .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .btn {
          width: 100%; margin-top: 14px; padding: 10px 12px; border: 0; border-radius: 1rem;
          background: linear-gradient(to right, var(--color-violet-500), var(--color-fuchsia-500), var(--color-cyan-400));
          color: #fff; font-weight: 600; font-size: 14px; cursor: pointer;
          box-shadow: 0 10px 22px -10px var(--color-fuchsia-500);
          transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }
        .btn:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 14px 26px -10px var(--color-fuchsia-500); }
        .btn:active { transform: translateY(0) scale(0.985); }
        .btn2 {
          width: 100%; margin-top: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 1rem;
          background: var(--surface-2); color: var(--text); font-weight: 600; font-size: 13px; cursor: pointer;
          transition: border-color 0.2s ease, filter 0.2s ease;
        }
        .btn2:hover { border-color: var(--color-violet-400); filter: brightness(1.12); }
        .sect { font-size: 11px; font-weight: 700; color: var(--color-slate-300); margin: 12px 0 4px; border-top: 1px solid var(--glass-border); padding-top: 8px; }
        .tog { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 12px; }
        .tog label { display: flex; align-items: center; gap: 5px; margin: 0; color: var(--color-slate-300); font-size: 12px; }
        .hint { font-size: 11px; color: var(--color-slate-500); margin-top: 10px; line-height: 1.5; }
        .stage { overflow: auto; padding: 18px; position: relative; z-index: 1; }
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

        /* Bubbly scrollbar, same as the site. */
        * { scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) var(--scroll-track); }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: var(--scroll-track); }
        ::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
        ::-webkit-scrollbar-corner { background: transparent; }

        @media print {
          body { background: #fff !important; min-height: 0; }
          body::before, body::after { display: none !important; }
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
            <div><label>Font size (pt)</label><div class="stepper"><button type="button" class="step" id="fs-minus" aria-label="Decrease font size">&minus;</button><input type="number" id="f-fs" min="7" max="14" step="0.5"><button type="button" class="step" id="fs-plus" aria-label="Increase font size">+</button></div></div>
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
        /* Load webfonts dynamically so they can never block first paint. */
        (function(){
          var fl = document.createElement('link');
          fl.rel = 'stylesheet';
          fl.href = ${JSON.stringify(fontsHref)};
          document.head.appendChild(fl);
        })();
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
        (function(){
          /* Themed +/- buttons replace the native number spinners; they drive
             the same field, so the existing input binding re-renders. */
          var fsField = document.getElementById('f-fs');
          function nudge(delta){
            var min = Number(fsField.min), max = Number(fsField.max);
            var v = Number(fsField.value) + delta;
            fsField.value = Math.min(max, Math.max(min, v));
            fsField.dispatchEvent(new Event('input', { bubbles: true }));
          }
          document.getElementById('fs-minus').addEventListener('click', function(){ nudge(-0.5); });
          document.getElementById('fs-plus').addEventListener('click', function(){ nudge(0.5); });
        })();
        document.getElementById('printBtn').addEventListener('click', function(){
          if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ window.print(); }); }
          else { window.print(); }
        });
        render();
      </script>
      </body></html>`;
}
