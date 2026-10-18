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
            var theme = saved === "dark" ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", theme);
            document.documentElement.style.colorScheme = theme;
          } catch (e) {
            document.documentElement.setAttribute("data-theme", "light");
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
        /* Buttons must inherit the page stack or Bangla labels fall back to the UA font (Arial). */
        button { font-family: inherit; }
        .drow { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; position: relative; }
        .calbtn { display: inline-flex; align-items: center; justify-content: center; padding: 7px 9px; }
        .calbtn svg { width: 15px; height: 15px; }
        /* Themed calendar popup — same surface as the .tselect menus. */
        .calpop {
          position: fixed; z-index: 100001; width: 252px;
          border-radius: 0.75rem; border: 1px solid color-mix(in srgb, var(--color-slate-600) 80%, transparent);
          background: color-mix(in srgb, var(--color-slate-900) 98%, transparent);
          backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          padding: 8px; font-size: 12px; color: var(--color-slate-200);
        }
        .calhead { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; padding: 0 2px; }
        .calmonth { font-weight: 600; font-size: 12px; }
        .calnav {
          width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
          border-radius: 8px; border: 1px solid transparent; background: transparent;
          color: inherit; cursor: pointer; font-size: 15px; line-height: 1;
        }
        .calnav:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
        .calgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .caldow { text-align: center; font-size: 10px; font-weight: 600; padding: 2px 0; color: var(--color-slate-500); }
        .calday {
          width: 100%; padding: 5px 0; border: 0; border-radius: 8px; background: transparent;
          color: inherit; font-size: 12px; cursor: pointer;
        }
        .calday:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
        .calday.today { box-shadow: inset 0 0 0 1px var(--color-violet-500); }
        .calday.sel { background: color-mix(in srgb, var(--color-violet-500) 25%, transparent); color: var(--color-violet-200); font-weight: 700; }
        .btn-xs {
          padding: 7px 10px; border-radius: 1rem; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
          transition: border-color 0.2s ease, filter 0.2s ease, transform 0.15s ease;
        }
        .btn-xs:hover { border-color: var(--color-violet-400); filter: brightness(1.08); }
        .btn-xs:active { transform: scale(0.985); }
        /* Dropdowns: the native select is visually hidden (kept for its state
           and the input bindings) and replaced by the site's own dropdown
           design — same rounded-2xl button, rotating chevron and portal-style
           menu — so the open menu is ours, not the browser's OS-styled popup. */
        .settings select.tselect-native { position: absolute; inset: 0; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
        .tselect { position: relative; }
        .tselect-btn {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          background: color-mix(in srgb, var(--color-slate-900) 60%, transparent);
          border: 1px solid color-mix(in srgb, var(--color-slate-600) 70%, transparent);
          border-radius: 1rem; padding: 10px 36px 10px 16px; font-size: 14px; text-align: left;
          color: var(--color-slate-100); cursor: pointer;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .tselect-btn:hover { border-color: var(--color-violet-400); }
        .tselect-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-violet-500) 70%, transparent); }
        .tselect.open .tselect-btn { box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-violet-500) 70%, transparent); }
        .tselect-btn .chev { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--color-slate-400); pointer-events: none; transition: transform 0.2s ease; }
        .tselect.open .chev { transform: translateY(-50%) rotate(180deg); }
        .tselect-menu {
          position: fixed; z-index: 100001; max-height: 16rem; overflow: auto;
          border-radius: 0.75rem; border: 1px solid color-mix(in srgb, var(--color-slate-600) 80%, transparent);
          background: color-mix(in srgb, var(--color-slate-900) 98%, transparent);
          backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); padding: 4px 0;
        }
        .tselect-opt {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          text-align: left; padding: 8px 12px; font-size: 14px; cursor: pointer;
          background: none; border: 0; color: var(--color-slate-200); transition: background-color 0.15s ease;
        }
        .tselect-opt:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
        .tselect-opt.active { background: color-mix(in srgb, var(--color-violet-500) 25%, transparent); color: var(--color-violet-200); }
        .tselect-opt .tick { color: var(--color-violet-300); font-size: 12px; }
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
        .header .hrow { display: grid; grid-template-columns: 1fr auto 1fr; gap: 0 4mm; align-items: baseline; }
        .header .hleft { text-align: left; }
        .header .hcenter { text-align: center; }
        .header .hright { text-align: right; }
        .header .h-school { font-size: 12.5pt; font-weight: 700; line-height: 1.05; }
        .header .h-title { font-size: 9.5pt; line-height: 1.1; }
        .header .h-subject { font-size: 8.5pt; line-height: 1.1; }
        .header .h-subject .h-per { color: #444; }
        .header .hline { font-size: 9pt; line-height: 1.2; white-space: nowrap; }
        .header .hline.hwrap { white-space: normal; }
        .header .hleft .f-name { min-width: 22mm; }
        .header .hleft .f-small { min-width: 15mm; }
        .header .hright .f-date { min-width: 18mm; }
        .header .rule { border-bottom: 1.2px solid #000; margin-top: 1px; }
        .fill { border-bottom: 1px dotted #555; display: inline-block; min-width: 60px; }
        .instructions { border: 1px solid #999; border-radius: 3px; padding: 2px 5px; font-size: 8pt; margin: 0 0 3px; background: #fafafa; }
        .qcol { display: grid; grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr)); gap: 1.4mm 6mm; align-items: start; }
        .section { font-size: 11pt; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 1px; margin: 5px 0 3px; break-after: avoid; }
        .hdate-btn {
          margin-left: 6px; padding: 1px 6px; border-radius: 0.5rem; border: 1px solid #999; background: #f6f6f6; color: #000; font-size: 8px; cursor: pointer; vertical-align: middle; line-height: 1.2;
          box-shadow: 0 1px 0 rgba(0,0,0,0.04);
        }
        @media print { .hdate-btn { display: none !important; } }
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
          .tselect-menu { display: none !important; }
          .calpop { display: none !important; }
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
          <label>Date</label><div class="drow">
            <input type="text" id="f-date" placeholder="DD/MM/YYYY" autocomplete="off" inputmode="numeric">
            <button type="button" class="btn-xs" id="dateTodayBtn" title="Set to today">Today</button>
            <button type="button" class="btn-xs calbtn" id="dateCalBtn" title="Pick a date" aria-label="Pick a date" aria-haspopup="dialog"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button>
          </div>
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
        /* Every option already prints its label inside the marker circle, so an
           option text that repeats the label ("ক) অন্তরীণ", "a) Apple" — typed or
           imported that way) would read as "ক) ক) অন্তরীণ". Drop the leading
           label when the question's options consistently carry one; a lone
           coincidence never triggers it. */
        function stripOneLabel(text){
          var s = String(text == null ? '' : text);
          if (!s) return s;
          var seps = ').।:}],;–—-';
          var labs = ['ক','খ','গ','ঘ','ঙ','চ','ছ','জ','a','b','c','d','e','f','g','h'];
          function ws(p){ var c = s.charCodeAt(p); return c === 32 || c === 9 || c === 10 || c === 13 || c === 160; }
          for (var li = 0; li < labs.length; li++) {
            var lab = labs[li], i = 0;
            while (i < s.length && ws(i)) i++;
            var seg = s.substr(i, lab.length), ci = false;
            if (seg !== lab) {
              if (lab.length === 1 && /[A-Za-z]/.test(lab) && seg.toLowerCase() === lab) ci = true;
              else continue;
            }
            var j = i + lab.length, sawWs = false;
            while (j < s.length && ws(j)) { j++; sawWs = true; }
            if (j < s.length && seps.indexOf(s.charAt(j)) >= 0) {
              j++;
              while (j < s.length && ws(j)) j++;
            } else if (ci || !sawWs) {
              continue;
            }
            var body = s.slice(j);
            if (body) return body;
          }
          return s;
        }
        function deLabelOptions(q){
          var opts = (q && q.options) ? q.options : [];
          var cleaned = [], matched = 0;
          for (var i = 0; i < opts.length; i++) {
            var c = stripOneLabel(opts[i]);
            cleaned.push(c);
            if (String(opts[i] == null ? '' : opts[i]) !== c) matched++;
          }
          var on = opts.length > 1 && matched >= 2 && matched * 2 >= opts.length;
          return { on: on, cleaned: on ? cleaned : opts };
        }
        function answerText(q){
          var a = q.answer || '-';
          if (!q.options || !q.options.length) return a;
          var dl = deLabelOptions(q);
          if (!dl.on) return a;
          var idx = q.options.indexOf(q.answer);
          return idx >= 0 ? dl.cleaned[idx] : a;
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
            var texts = deLabelOptions(q).cleaned;
            opts = '<div class="options two-col">' + texts.map(function(o, i){
              return '<div class="opt"><span class="optmark">' + (L[i] || (i + 1)) + '</span><span class="opttext">' + esc(o) + '</span></div>';
            }).join('') + '</div>';
          }
          var marks = S.showMarks ? '<span class="qmarks">[' + (q.marks || 1) + ']</span>' : '';
          return '<div class="q"><div class="qp"><span class="qno">' + qNo(q, n) + '</span><span class="qtext">' + esc(q.prompt) + '</span>' + marks + '</div>' + opts + '</div>';
        }
        function formatDate(s){
          if (!s) return s;
          var m = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
          if (m) return m[3] + '/' + m[2] + '/' + m[1];
          return s;
        }
        function headerHtml(){
          /* Compact header: identity fields (Name, Roll, Class) stack in the
             left column and Date/Time/Marks in the right, so the block is
             exactly as tall as the title stack — no extra rows below. */
          var left = '';
          if (S.showName) left += '<div class="hline">Name: <span class="fill f-name"></span></div>';
          if (S.showRollClass) {
            left += '<div class="hline">Roll: <span class="fill f-small"></span></div>';
            left += '<div class="hline">Class/Sec: <span class="fill f-small"></span></div>';
          }
          var c = '';
          if (S.showSchool) c += '<div class="h-school">' + esc(S.school) + '</div>';
          if (S.showTitle) c += '<div class="h-title">' + esc(S.title) + '</div>';
          var perSubj = (S.showTime && S.showSubject) ? DATA.perSubjectTime : '';
          if (S.showSubject) c += '<div class="h-subject">Subject: <b>' + esc(DATA.subjectLine) + '</b>' + (perSubj ? ' <span class="h-per">' + esc(perSubj) + '</span>' : '') + '</div>';
          var right = '';
          if (S.showDate) right += '<div class="hline">Date: ' + (S.date ? '<b>' + esc(formatDate(S.date)) + '</b>' : '<span class="fill f-date"></span>') + '<button type="button" class="hdate-btn" id="hdatePick" title="Pick a date">Pick</button></div>';
          if (S.showTime) right += '<div class="hline' + (!S.showSubject && DATA.perSubjectTime ? ' hwrap' : '') + '">Time: <b>' + DATA.time + ' minutes</b>' + (!S.showSubject ? esc(DATA.perSubjectTime) : '') + '</div>';
          if (S.showFullMarks) right += '<div class="hline">Full Marks: <b>' + DATA.totalMarks + '</b></div>';
          return '<div class="header"><div class="hrow">' +
            '<div class="hleft">' + left + '</div>' +
            '<div class="hcenter">' + c + '</div>' +
            '<div class="hright">' + right + '</div>' +
            '</div><div class="rule"></div></div>';
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
              an += '<div class="a"><b>' + qNo(q, k) + '</b>' + subj + ' ' + (cl ? '<b>' + cl + ')</b> ' : '') + esc(answerText(q)) + ' ' + (q.explanation ? '<div class="exp">' + esc(q.explanation) + '</div>' : '') + '</div>';
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
        (function(){
          var fd = document.getElementById('f-date');
          if (!fd) return;
          var calBtn = document.getElementById('dateCalBtn');
          var dtBtn = document.getElementById('dateTodayBtn');
          var pop = null, vY = 0, vM = 0;
          var MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
          var DW = ['Su','Mo','Tu','We','Th','Fr','Sa'];
          function pad(n){ return (n < 10 ? '0' : '') + n; }
          function fmt(d){ return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); }
          function parse(v){
            if (!v) return null;
            v = String(v).trim();
            var m = v.match(/^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})$/);
            if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
            m = v.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            return null;
          }
          function setDate(d){
            fd.value = fmt(d);
            fd.dispatchEvent(new Event('input', { bubbles: true }));
          }
          function closeCal(){
            if (!pop) return;
            pop.remove(); pop = null;
            window.removeEventListener('resize', posCal);
            var sc = document.querySelector('.settings');
            if (sc) sc.removeEventListener('scroll', posCal);
          }
          function drawCal(){
            var first = new Date(vY, vM, 1).getDay();
            var daysIn = new Date(vY, vM + 1, 0).getDate();
            var prevDays = new Date(vY, vM, 0).getDate();
            var sel = parse(fd.value), today = new Date();
            var html = '<div class="calhead"><button type="button" class="calnav" data-mv="-1" aria-label="Previous month">&lsaquo;</button>'
              + '<span class="calmonth">' + MN[vM] + ' ' + vY + '</span>'
              + '<button type="button" class="calnav" data-mv="1" aria-label="Next month">&rsaquo;</button></div><div class="calgrid">';
            DW.forEach(function(d){ html += '<span class="caldow">' + d + '</span>'; });
            var i, d, cls;
            for (i = first - 1; i >= 0; i--) html += '<button type="button" class="calday" data-d="' + (prevDays + i + 1) + '" data-mv="-1">' + (prevDays + i + 1) + '</button>';
            for (d = 1; d <= daysIn; d++) {
              cls = 'calday';
              if (sel && sel.getFullYear() === vY && sel.getMonth() === vM && sel.getDate() === d) cls += ' sel';
              else if (today.getFullYear() === vY && today.getMonth() === vM && today.getDate() === d) cls += ' today';
              html += '<button type="button" class="' + cls + '" data-d="' + d + '">' + d + '</button>';
            }
            var lead = (7 - (first + daysIn) % 7) % 7;
            for (i = 1; i <= lead; i++) html += '<button type="button" class="calday" data-d="' + i + '" data-mv="1">' + i + '</button>';
            pop.innerHTML = html + '</div>';
          }
          function posCal(){
            if (!pop) return;
            var r = fd.getBoundingClientRect();
            var w = pop.offsetWidth || 252, h = pop.offsetHeight || 230;
            var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
            var top = r.bottom + 6;
            if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
            pop.style.left = left + 'px';
            pop.style.top = top + 'px';
          }
          window.openPrintDateCal = function(){
            if (pop) { closeCal(); return; }
            var base = parse(fd.value) || new Date();
            vY = base.getFullYear(); vM = base.getMonth();
            pop = document.createElement('div');
            pop.className = 'calpop';
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', 'Pick a date');
            document.body.appendChild(pop);
            drawCal(); posCal();
            window.addEventListener('resize', posCal);
            var sc = document.querySelector('.settings');
            if (sc) sc.addEventListener('scroll', posCal);
          };
          fd.value = S.date ? formatDate(S.date) : '';
          if (calBtn) calBtn.addEventListener('click', function(e){ e.stopPropagation(); window.openPrintDateCal(); });
          if (dtBtn) dtBtn.addEventListener('click', function(){ setDate(new Date()); closeCal(); });
          document.addEventListener('mousedown', function(e){
            if (!pop) return;
            if (pop.contains(e.target) || (calBtn && calBtn.contains(e.target)) || e.target === fd) return;
            closeCal();
          });
          document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeCal(); });
          document.addEventListener('click', function(e){
            if (!pop || !pop.contains(e.target)) return;
            var t = e.target;
            while (t && t !== pop && !(t.classList && (t.classList.contains('calnav') || t.classList.contains('calday')))) t = t.parentNode;
            if (!t || t === pop) return;
              var mv = Number(t.getAttribute('data-mv') || 0);
              if (mv) { vM += mv; if (vM < 0) { vM = 11; vY--; } else if (vM > 11) { vM = 0; vY++; } }
              var dd = t.getAttribute('data-d');
              if (dd && !t.classList.contains('calnav')) {
                setDate(new Date(vY, vM, Number(dd)));
                closeCal();
                return;
              }
              drawCal(); posCal();
          });
        })();
        bind('f-date', 'date', 'text');
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
        (function(){
          /* "Pick" button in the Date cell of the printed header — the header is
             rebuilt on every render, so bind by delegation. */
          document.addEventListener('click', function(e){
            var t = e.target;
            if (!t || !t.closest || !t.closest('#hdatePick')) return;
            var el = document.getElementById('f-date');
            if (!el) return;
            var box = document.querySelector('.settings');
            if (box) box.scrollIntoView({ block: 'nearest' });
            el.focus();
            if (window.openPrintDateCal) window.openPrintDateCal();
          });
        })();
        (function(){
          /* Custom dropdowns replicating the site's own Select component: the
             native select is visually hidden (kept for its value and the bind()
             listeners) and replaced by a themed button opening a portal-style
             listbox, so the open menu is ours instead of the browser's
             OS-styled popup. */
          var tselects = [];
          function enhanceSelect(sel){
            var wrap = document.createElement('div');
            wrap.className = 'tselect';
            /* Grab the field label while the select is still in place — it is
               the accessible name of the custom button. */
            var prev = sel.previousElementSibling;
            var label0 = prev && prev.tagName === 'LABEL' ? prev.textContent.trim() : '';
            sel.parentNode.insertBefore(wrap, sel);
            wrap.appendChild(sel);
            sel.classList.add('tselect-native');
            /* The hidden select leaves the tab order — the button below is the
               real, focusable control (same as the site's Select component). */
            sel.tabIndex = -1;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tselect-btn';
            btn.setAttribute('aria-haspopup', 'listbox');
            btn.setAttribute('aria-expanded', 'false');
            if (label0) btn.setAttribute('aria-label', label0);
            btn.innerHTML = '<span class="tselect-label"></span><svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
            wrap.appendChild(btn);
            var label = btn.querySelector('.tselect-label');
            var menu = null;
            function syncLabel(){
              var o = sel.options[sel.selectedIndex];
              label.textContent = o ? o.textContent : '';
            }
            function close(){
              if (menu){ menu.remove(); menu = null; }
              wrap.classList.remove('open');
              btn.setAttribute('aria-expanded', 'false');
            }
            function open(){
              var r = btn.getBoundingClientRect();
              menu = document.createElement('div');
              menu.className = 'tselect-menu';
              menu.setAttribute('role', 'listbox');
              menu.style.top = (r.bottom + 4) + 'px';
              menu.style.left = r.left + 'px';
              menu.style.width = r.width + 'px';
              for (var i = 0; i < sel.options.length; i++){
                (function(o, idx){
                  var b = document.createElement('button');
                  b.type = 'button';
                  b.setAttribute('role', 'option');
                  var active = idx === sel.selectedIndex;
                  b.className = 'tselect-opt' + (active ? ' active' : '');
                  b.innerHTML = '<span class="to-label"></span>' + (active ? '<span class="tick">&#10003;</span>' : '');
                  b.querySelector('.to-label').textContent = o.textContent;
                  b.addEventListener('click', function(){
                    sel.value = o.value;
                    sel.dispatchEvent(new Event('input', { bubbles: true }));
                    syncLabel();
                    close();
                  });
                  menu.appendChild(b);
                })(sel.options[i], i);
              }
              document.body.appendChild(menu);
              var mr = menu.getBoundingClientRect();
              if (mr.bottom > window.innerHeight - 8 && r.top - 4 > mr.height){
                menu.style.top = (r.top - mr.height - 4) + 'px';
              }
              wrap.classList.add('open');
              btn.setAttribute('aria-expanded', 'true');
            }
            btn.addEventListener('click', function(e){
              e.stopPropagation();
              if (menu) close(); else open();
            });
            tselects.push({ wrap: wrap, close: close, menu: function(){ return menu; } });
            syncLabel();
          }
          var sels = document.querySelectorAll('.settings select');
          for (var i = 0; i < sels.length; i++) enhanceSelect(sels[i]);
          document.addEventListener('mousedown', function(e){
            tselects.forEach(function(t){
              var m = t.menu();
              if (t.wrap.classList.contains('open') && !t.wrap.contains(e.target) && !(m && m.contains(e.target))) t.close();
            });
          });
          document.addEventListener('keydown', function(e){
            if (e.key === 'Escape') tselects.forEach(function(t){ t.close(); });
          });
        })();
        document.getElementById('printBtn').addEventListener('click', function(){
          if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ window.print(); }); }
          else { window.print(); }
        });
        render();
      </script>
      </body></html>`;
}
