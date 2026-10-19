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

/**
 * Device-local default print settings (localStorage).
 *
 * The Print page writes what it knows (school, title, instructions, the four
 * paper toggles, columns) and the preview writes the formatting choices it
 * owns (font size, label/number style, page numbers, header items...). Both
 * merge into the same object, so each remembers its own fields and the shared
 * ones (columns, answer key, marks, instructions) stay in step: what you set
 * once becomes the default for the next paper.
 */
export const PRINT_PREFS_KEY = "mcq_print_prefs";

export function readPrintPrefs(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(PRINT_PREFS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function writePrintPrefs(patch: Record<string, any>): void {
  try {
    localStorage.setItem(
      PRINT_PREFS_KEY,
      JSON.stringify(Object.assign({}, readPrintPrefs(), patch)),
    );
  } catch {
    /* storage unavailable (private mode) — defaults simply don't persist */
  }
}

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
  /* Space & look controls owned by the preview only (the Print page does not
     send them, so the preview falls back to its own DEF values below, then to
     the device's saved prefs). */
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  fontFamily?: string;
  lineHeight?: number;
  qgap?: number;
  cgap?: number;
  ansCols?: number;
  showExplanation?: boolean;
  qPageNo?: boolean;
  showBreaks?: boolean;
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
        /* The A4 content-box margins are emitted dynamically by pageCss() from
           the sidebar controls; only the paper size is fixed here. */
        @page { size: A4; }
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
        /* Compact themed control row: Shuffle options / Shuffle questions /
           Reset share one line instead of two full-width buttons. */
        .btnrow { display: flex; gap: 6px; margin-top: 10px; }
        .btnsm {
          flex: 1 1 0; min-width: 0; padding: 8px 4px; border: 1px solid var(--border); border-radius: 1rem;
          background: var(--surface-2); color: var(--text); font-size: 12px; font-weight: 600; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap;
          transition: border-color 0.2s ease, filter 0.2s ease, transform 0.15s ease;
        }
        .btnsm:hover { border-color: var(--color-violet-400); filter: brightness(1.12); }
        .btnsm:active { transform: scale(0.97); }
        .settings .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .grid4 input { padding: 6px 4px; text-align: center; font-size: 12px; }
        .sect { font-size: 11px; font-weight: 700; color: var(--color-slate-300); margin: 12px 0 4px; border-top: 1px solid var(--glass-border); padding-top: 8px; }
        .tog { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 12px; }
        .tog label { display: flex; align-items: center; gap: 5px; margin: 0; color: var(--color-slate-300); font-size: 12px; }
        .hint { font-size: 11px; color: var(--color-slate-500); margin-top: 10px; line-height: 1.5; }
        .pginfo { margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--color-slate-300); }
        .stage { overflow: auto; padding: 18px; position: relative; z-index: 1; }
        /* ---- Real A4 pages ---------------------------------------------------
           The sheet is a stack of EXACT A4 page boxes (.pg), each padded with
           the chosen margins on screen and framed by the same @page margins
           when printed, so what you see — including the break lines between
           pages — is what the printer will do. Questions are packed into them
           down-then-across by the renderer. */
        .sheet { width: auto; min-height: 0; margin: 0 auto; }
        .pg {
          position: relative; width: 210mm; min-height: 297mm; margin: 0 auto;
          background: #fff; color: #000; padding: var(--mT, 12mm) var(--mR, 12.7mm) var(--mB, 11mm) var(--mL, 12mm);
          box-shadow: 0 4px 24px rgba(0,0,0,.5);
        }
        /* Guides off: pages butt together into one continuous white sheet.
           Guides on: pages separate with a labelled dashed rule (screen only). */
        .paper:not(.guides) .pg { box-shadow: none; }
        .prow { display: flex; align-items: flex-start; gap: var(--cg, 6mm); }
        .pcol { flex: 1 1 0; min-width: 0; }
        .pgbr {
          display: none; width: 210mm; margin: 5mm auto; align-items: center; gap: 10px;
          color: var(--color-violet-400); font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
        }
        .paper.guides .pgbr { display: flex; }
        .pgbr span { white-space: nowrap; }
        .pgbr::before, .pgbr::after { content: ""; flex: 1; border-top: 1.5px dashed color-mix(in srgb, var(--color-violet-500) 65%, transparent); }
        /* Offscreen measuring box: same width as a real column, so the packer
           works from true heights (after the automatic option layout). */
        .pmeas { position: absolute; left: -20000px; top: 0; visibility: hidden; height: auto; pointer-events: none; }
        /* One type scale: every size below is relative to --fs, so the font-size
           control grows the whole sheet (headings, marks, answer key) evenly.
           The family and the leading come from the sidebar controls too. */
        .paper { font-family: var(--pfont, "Noto Serif Bengali", "Plus Jakarta Sans", "Nirmala UI", serif); font-size: var(--fs, 11pt); line-height: var(--lh, 1.35); color: #000; }
        .header { margin-bottom: 1.6mm; }
        .header .hrow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr); gap: 0 4mm; align-items: baseline; }
        .header .hleft { text-align: left; }
        .header .hcenter { text-align: center; min-width: 0; }
        .header .hright { text-align: right; }
        .header .h-school { font-size: 1.3em; font-weight: 700; line-height: 1.08; overflow-wrap: break-word; }
        .header .h-title { font-size: 1.05em; font-weight: 600; line-height: 1.14; overflow-wrap: break-word; }
        .header .h-subject { font-size: 0.98em; line-height: 1.14; overflow-wrap: break-word; }
        .header .h-subject .h-per { color: #333; }
        .header .hline { font-size: 0.98em; line-height: 1.3; white-space: nowrap; }
        .header .hline.hwrap { white-space: normal; }
        .header .hleft .f-name { min-width: 22mm; }
        .header .hleft .f-small { min-width: 15mm; }
        .header .hright .f-date { min-width: 18mm; }
        .header .rule { border-bottom: 1.2px solid #000; margin-top: 1.5mm; }
        .fill { border-bottom: 1px dotted #555; display: inline-block; min-width: 60px; }
        .instructions { border: 1px solid #999; border-radius: 3px; padding: 3px 6px; font-size: 0.9em; line-height: 1.4; margin: 0 0 2mm; background: #fafafa; }
        /* Columns are explicit .prow/.pcol boxes packed page by page (see the
           renderer), so the screen shows exactly what the printer will do. */
        .section { font-size: 1.12em; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 1px; margin: 2mm 0 1.5mm; break-after: avoid; page-break-after: avoid; }
        .hdate-btn {
          margin-left: 6px; padding: 1px 6px; border-radius: 0.5rem; border: 1px solid #999; background: #f6f6f6; color: #000; font-size: 8px; cursor: pointer; vertical-align: middle; line-height: 1.2;
          box-shadow: 0 1px 0 rgba(0,0,0,0.04);
        }
        @media print { .hdate-btn { display: none !important; } }
        .q { break-inside: avoid; page-break-inside: avoid; margin-bottom: var(--qgap, 2.2mm); }
        .qp { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0 0.6mm; align-items: start; }
        .qno { font-weight: 700; min-width: 4.2mm; }
        .qmarks { white-space: nowrap; font-size: 0.88em; color: #222; }
        /* Right-hand group of the question row: marks plus the printed page
           chip ("p3") that says which A4 sheet this question lands on. */
        .qright { display: flex; align-items: baseline; justify-content: flex-end; gap: 0.6mm; white-space: nowrap; }
        /* Bracketed page ref inside the answer key — points at the page where
           that question is printed; independent of the explanation block. */
        .anspno { font-size: 0.86em; font-weight: 700; color: #444; white-space: nowrap; }
        .options { margin-top: 0.8mm; }
        .options.two-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.4mm 4mm; }
        .options.one-col .opt + .opt { margin-top: 0.4mm; }
        .opt { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 0.6mm; align-items: start; break-inside: avoid; page-break-inside: avoid; }
        .opttext { overflow-wrap: break-word; }
        /* The bubble scales with the body font, so it stays a comfortable
           ~4mm tick target at 11pt and shrinks with the font-size control. */
        .optmark { display: inline-flex; align-items: center; justify-content: center; width: 1.3em; height: 1.3em; margin-top: 0.12em; border: 1.2px solid #000; border-radius: 50%; font-size: 0.78em; line-height: 1; font-weight: 600; }
        /* The answer key is packed into its own pages (see the renderer), so the
           old break-before/column rules are gone; only the heading remains. */
        .anshead { font-size: 1.18em; border-bottom: 1.2px solid #000; padding-bottom: 2px; margin: 0 0 1.5mm; break-after: avoid; page-break-after: avoid; }
        .a { font-size: 0.98em; break-inside: avoid; page-break-inside: avoid; margin-bottom: 1.8mm; }
        .ansubj { color: #444; font-size: 0.85em; }
        .exp { font-size: 0.88em; color: #333; margin-left: 4mm; }

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
          /* Each .pg becomes exactly one physical page: the @page margins frame
             it (screen .pg padding drops out) and a forced break follows, so the
             packed pages — and their numbers — survive the PDF unchanged. */
          .pg { width: auto; min-height: 0; height: auto; margin: 0; padding: 0; box-shadow: none; break-after: page; page-break-after: always; }
          .pg:last-child { break-after: auto; page-break-after: auto; }
          .pgbr { display: none !important; }
        }

        @media screen and (max-width: 768px) {
          .app { grid-template-columns: 1fr; height: auto; }
          .settings { border-right: 0; border-bottom: 1px solid var(--glass-border); max-height: 55vh; }
          .stage { padding: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
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
          <div class="sect">Page margins (mm)</div>
          <div class="grid4">
            <div><label for="m-top">Top</label><input type="number" id="m-top" min="0" max="40" step="0.5"></div>
            <div><label for="m-right">Right</label><input type="number" id="m-right" min="0" max="40" step="0.5"></div>
            <div><label for="m-bottom">Bottom</label><input type="number" id="m-bottom" min="0" max="40" step="0.5"></div>
            <div><label for="m-left">Left</label><input type="number" id="m-left" min="0" max="40" step="0.5"></div>
          </div>
          <div class="sect">Text &amp; spacing</div>
          <label for="f-font">Body font</label>
          <select id="f-font"><option value="serif">Book (Noto Serif Bengali)</option><option value="sans">Modern (Jakarta Sans)</option><option value="times">Classic (Times)</option><option value="arial">Plain (Arial)</option></select>
          <div class="grid2">
            <div><label for="f-lh">Line height</label><input type="number" id="f-lh" min="1" max="2" step="0.05"></div>
            <label>Question gap (mm)</label><input type="number" id="f-qgap" min="0" max="8" step="0.5" value="1.8">
          </div>
          <div class="grid2">
            <div><label for="f-cgap">Column gap (mm)</label><input type="number" id="f-cgap" min="0" max="14" step="1"></div>
            <div><label for="f-anscols">Answer key columns</label><select id="f-anscols"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
          </div>
          <label>Fit more per page</label>
          <div class="btnrow">
            <button class="btnsm" type="button" id="dens-compact" title="Tight margins and spacing — most questions per sheet">Compact</button>
            <button class="btnsm" type="button" id="dens-standard" title="Balanced defaults">Standard</button>
            <button class="btnsm" type="button" id="dens-spacious" title="Roomier spacing">Spacious</button>
          </div>
          <label>Option labels</label>
          <select id="f-labels"><option value="auto">Auto (Bangla ক, English a)</option><option value="bangla">ক খ গ ঘ</option><option value="english">a b c d</option></select>
          <label>Question numbers</label>
          <select id="f-num"><option value="auto">Auto (Bangla ১, English 1)</option><option value="bangla">১ ২ ৩ ৪</option><option value="english">1 2 3 4</option></select>
          <div class="row"><input type="checkbox" id="f-qpgno"><label for="f-qpgno" style="margin:0">Page no. on each answer</label></div>
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
          <div class="row"><input type="checkbox" id="f-exp"><label for="f-exp" style="margin:0">Explanation after answer</label></div>
          <div class="row"><input type="checkbox" id="f-breaks"><label for="f-breaks" style="margin:0">Show page breaks (screen only)</label></div>
          <div class="btnrow">
            <button class="btnsm" id="shuffleBtn" type="button" title="Shuffle option order — never repeats an arrangement or answer pattern">⇄ Options</button>
            <button class="btnsm" id="shuffleQBtn" type="button" title="Shuffle the question order">⇅ Questions</button>
            <button class="btnsm" id="resetBtn" type="button" title="Restore the original option and question order">↺ Reset</button>
          </div>
          <button class="btn" id="printBtn">Print / Save PDF</button>
          <div class="row" style="justify-content:space-between">
            <span class="hint" style="margin:0">Settings are remembered on this device.</span>
            <button class="btn-xs" id="forgetBtn" type="button" title="Clear saved defaults and reload the paper with the site defaults">Forget defaults</button>
          </div>
          <div class="pginfo" id="pginfo"></div>
          <div class="hint">Chrome print dialog: Destination <b>Save as PDF</b>, Paper size <b>A4</b>, Margins <b>Default</b>.</div>
        </aside>
        <main class="stage"><div class="sheet"><div class="paper" id="paper"></div></div></main>
      </div>
      <script>
        var DATA = ${dataJson};
        /* Preview-owned defaults for the space/typography controls; the staged
           payload (Print page) only ever sends its own keys, so these fill the
           rest and the device prefs below can still override everything. */
        var DEF = {
          columns: 2, fontSize: 11,
          marginTop: 12, marginRight: 12.7, marginBottom: 11, marginLeft: 12,
          fontFamily: 'serif', lineHeight: 1.35, qgap: 1.8, cgap: 6, ansCols: 2,
          showExplanation: true, qPageNo: true, showBreaks: true
        };
        var S = Object.assign({}, DEF, DATA.defaults);
        /* Device defaults: formatting the Print page never controls (font size,
           label styles, header items, page numbers) is remembered per device and
           re-applied over the staged payload, so every paper starts from the
           same look. The shared paper toggles (columns, answer key, marks,
           instructions) are also saved so preview-side tweaks carry back to the
           Print page, which reads the same object. Date and paper title are
           per-paper and are never restored. */
        var PREF_KEY = 'mcq_print_prefs';
        var PREF_RESTORE = ['fontSize','labelStyle','numStyle','showHeader','showName','showSchool','showTitle','showSubject','showTime','showFullMarks','showDate','showRollClass','runningTitle','showPageNo','pageNumPos','pageNumFmt','marginTop','marginRight','marginBottom','marginLeft','fontFamily','lineHeight','qgap','cgap','ansCols','showExplanation','qPageNo','showBreaks'];
        var PREF_SAVE = ['school','instructions','columns','groupBySubject','showMarks','showAnswers','showInstructions'].concat(PREF_RESTORE);
        (function(){
          try {
            var p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
            for (var i = 0; i < PREF_RESTORE.length; i++) {
              var k = PREF_RESTORE[i];
              if (p[k] !== undefined && p[k] !== null) S[k] = p[k];
            }
          } catch (e) {}
        })();
        function savePrefs(){
          try {
            var cur = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
            var out = {};
            for (var i = 0; i < PREF_SAVE.length; i++) out[PREF_SAVE[i]] = S[PREF_SAVE[i]];
            localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(cur, out)));
          } catch (e) {}
        }
        /* Remember the ORIGINAL option order (for Reset) and the ORIGINAL
           question order per group (also for Reset, once questions shuffle). */
        DATA.groups.forEach(function(g){ g._origQ = g.questions.slice(); g.questions.forEach(function(q){ q._orig = (q.options || []).slice(); }); });
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
          /* One @page rule carrying the user's margins (which also frame the
             running title and page numbers below, printed in the margin area). */
          var g = geo();
          var css = '@page { size: A4; margin: ' + g.mT + 'mm ' + g.mR + 'mm ' + g.mB + 'mm ' + g.mL + 'mm; }';
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
          var right = '';
          /* MCQ papers never print marks beside the question (the header's Full
             Marks already covers them) and never a page chip — the answer key
             carries the page reference instead. */
          if (S.showMarks && q.type !== 'mcq') right += '<span class="qmarks">[' + (q.marks || 1) + ']</span>';
          right = right ? '<span class="qright">' + right + '</span>' : '';
          return '<div class="q" data-qn="' + n + '"><div class="qp"><span class="qno">' + qNo(q, n) + '</span><span class="qtext">' + esc(q.prompt) + '</span>' + right + '</div>' + opts + '</div>';
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
        /* Shuffle every MCQ's options while actively fighting visible patterns
           in the answer-key column: no run of the same position twice+, no
           period-2/3/4 repetition at the tail, positions handed out to the
           least-used first, identical arrangements capped (and a question may
           never repeat the arrangement of the one above it). */
        function shuffleAll(){
          var qs = [];
          DATA.groups.forEach(function(g){ g.questions.forEach(function(q){ if (q.type === 'mcq' && q.options && q.options.length > 1) qs.push(q); }); });
          var seq = [], last = -1, run = 0, used = {}, seen = {}, lastSig = '';
          qs.forEach(function(q){
            var n = q.options.length, arr = q.options.slice(), correctText = q.answer, ci = arr.indexOf(correctText);
            var cands = []; for (var p = 0; p < n; p++) cands.push(p);
            function build(){
              /* Pull the correct option out BY POSITION (not by text): two
                 options with identical text must never collapse into one. */
              var o = arr.slice(), correctVal = null;
              if (ci >= 0) correctVal = o.splice(ci, 1)[0];
              for (var i = o.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = o[i]; o[i] = o[j]; o[j] = t; }
              if (ci >= 0) o.splice(target, 0, correctVal);
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
            while (((seen[sig] || 0) >= 2 || sig === lastSig) && tries < 12) { newArr = build(); sig = JSON.stringify(newArr); tries++; }
            seen[sig] = (seen[sig] || 0) + 1;
            lastSig = sig;
            q.options = newArr;
            seq.push(target);
            used[target] = (used[target] || 0) + 1;
            if (target === last) run++; else { last = target; run = 1; }
          });
          render();
        }
        /* Shuffle the question order within each group (subject grouping stays
           intact; numbering and the answer key re-derive from the new order). */
        function shuffleQuestions(){
          DATA.groups.forEach(function(g){
            var a = g.questions;
            for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
          });
          render();
        }
        function resetOrder(){
          DATA.groups.forEach(function(g){
            g.questions.forEach(function(q){ if (q._orig) q.options = q._orig.slice(); });
            if (g._origQ) g.questions = g._origQ.slice();
          });
          render();
        }
        /* Option layout, automatic: if any option wraps onto a second line in
           the two-column grid it drops back to one column, so long Bangla
           options keep a comfortable measure instead of a cramped one. Runs on
           the live sheet or on an offscreen measuring box of the same width. */
        function autoOptions(root){
          var lists = (root || paper).querySelectorAll('.options.two-col');
          for (var i = 0; i < lists.length; i++) {
            var kids = lists[i].children, wraps = false;
            for (var j = 0; j < kids.length; j++) {
              var t = kids[j].querySelector ? kids[j].querySelector('.opttext') : null;
              if (!t) continue;
              var cs = window.getComputedStyle(t);
              var lh = parseFloat(cs.lineHeight);
              if (!(lh > 0)) lh = parseFloat(cs.fontSize) * 1.35;
              if (t.getBoundingClientRect().height > lh * 1.45) { wraps = true; break; }
            }
            if (wraps) { lists[i].classList.remove('two-col'); lists[i].classList.add('one-col'); }
          }
        }
        /* ---- Page geometry ---------------------------------------------------
           Everything is derived from the sidebar controls: printable content
           width/height in mm (297 - top - bottom), the question columns and
           the answer-key columns. Margins are clamped so a typo can never
           produce an unprintable sheet. */
        function geo(){
          function m(v, d){ v = Number(v); if (!(v >= 0)) v = d; return Math.min(v, 50); }
          var mT = m(S.marginTop, 12), mR = m(S.marginRight, 12.7), mB = m(S.marginBottom, 11), mL = m(S.marginLeft, 12);
          var cw = 210 - mL - mR, ch = 297 - mT - mB;
          var cols = Number(S.columns) === 1 ? 1 : 2;
          var cg = Number(S.cgap); if (!(cg >= 0)) cg = 6;
          var ac = Number(S.ansCols); if (ac !== 1 && ac !== 3) ac = 2;
          return { mT: mT, mR: mR, mB: mB, mL: mL, cw: cw, ch: ch, cols: cols, cg: cg, colW: (cw - cg * (cols - 1)) / cols, ac: ac };
        }
        function fontStack(v){
          if (v === 'sans') return '"Plus Jakarta Sans", "Noto Serif Bengali", "Segoe UI", system-ui, sans-serif';
          if (v === 'times') return '"Times New Roman", "Noto Serif Bengali", Georgia, serif';
          if (v === 'arial') return 'Arial, "Noto Serif Bengali", "Segoe UI", sans-serif';
          return '"Noto Serif Bengali", "Plus Jakarta Sans", "Nirmala UI", serif';
        }
        /* Measure a list of HTML blocks in an offscreen box of the EXACT width
           they will occupy in a real column (running the automatic option
           layout first so wrapped options count). One append pass, one read
           pass; the top+bottom margins are added back because a rect excludes
           them — over-estimating a little only ever frees space, never spills. */
        function measureAll(list, widthPx, auto){
          var box = document.createElement('div');
          box.className = 'pmeas';
          box.style.width = Math.max(1, Math.round(widthPx)) + 'px';
          paper.appendChild(box);
          var nodes = [], i;
          for (i = 0; i < list.length; i++) {
            var d = document.createElement('div');
            d.innerHTML = list[i];
            var el = d.firstElementChild;
            box.appendChild(el);
            nodes.push(el);
          }
          if (auto) autoOptions(box);
          var hs = [];
          for (i = 0; i < nodes.length; i++) {
            var cs = window.getComputedStyle(nodes[i]);
            hs.push(nodes[i].getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0));
          }
          box.parentNode.removeChild(box);
          return hs;
        }
        /* Greedy pack: fill column 1 to the bottom, then column 2, ... then the
           next page. SLACK absorbs sub-pixel/font rounding so a packed column
           can never exceed the real page; an item taller than a whole column is
           force-placed (better a visible spill than a lost question). */
        function pack(items, hs, cols, pageH, firstH){
          var SLACK = 3, pages = [], cur = null, c = 0;
          function np(){
            var p = { cols: [], items: [] };
            for (var i = 0; i < cols; i++) { p.cols.push(0); p.items.push([]); }
            pages.push(p); cur = p; c = 0;
          }
          np();
          function avail(){ return (pages.length === 1 ? firstH : pageH) - SLACK; }
          for (var i = 0; i < items.length; i++) {
            var h = hs[i] || 1, guard = 0;
            for (;;) {
              if (guard++ > 10000) break;
              var a = avail();
              if (cur.cols[c] + h <= a) { cur.items[c].push(items[i]); cur.cols[c] += h; break; }
              if (cur.cols[c] > 0 && c < cols - 1) { c++; continue; }
              if (cur.cols[c] === 0 && h > a) { cur.items[c].push(items[i]); cur.cols[c] += h; break; }
              np();
            }
          }
          return pages;
        }
        function render(){
          var g = geo(), i;
          paper.style.setProperty('--fs', S.fontSize + 'pt');
          paper.style.setProperty('--lh', String(Number(S.lineHeight) > 0 ? Number(S.lineHeight) : 1.35));
          paper.style.setProperty('--qgap', (Number(S.qgap) >= 0 ? Number(S.qgap) : 2.2) + 'mm');
          paper.style.setProperty('--cg', g.cg + 'mm');
          paper.style.setProperty('--mT', g.mT + 'mm');
          paper.style.setProperty('--mR', g.mR + 'mm');
          paper.style.setProperty('--mB', g.mB + 'mm');
          paper.style.setProperty('--mL', g.mL + 'mm');
          paper.style.setProperty('--pfont', fontStack(S.fontFamily));
          paper.classList.toggle('guides', !!S.showBreaks);

          /* 1 — build the blocks: full-width (header, instructions) and
             column-width (section headings, questions, answer-key lines). */
          var fulls = [], items = [], ansFull = [], ansItems = [];
          if (S.showHeader) fulls.push(headerHtml());
          if (S.showInstructions && S.instructions && S.instructions.trim()) fulls.push('<div class="instructions"><b>Instructions:</b> ' + esc(S.instructions) + '</div>');
          var n = 0;
          if (S.groupBySubject && DATA.groups.length > 1) {
            DATA.groups.forEach(function(gr){
              items.push('<h3 class="section">' + esc(gr.name) + (gr.time ? ' <span class="sectime">(' + gr.time + ' min)</span>' : '') + '</h3>');
              gr.questions.forEach(function(q){ n++; items.push(qHtml(q, n)); });
            });
          } else {
            DATA.groups.forEach(function(gr){ gr.questions.forEach(function(q){ n++; items.push(qHtml(q, n)); }); });
          }
          if (S.showAnswers) {
            ansFull.push('<h2 class="anshead">Answer Key &amp; Mark Scheme</h2>');
            var k = 0;
            DATA.groups.forEach(function(gr){ gr.questions.forEach(function(q){
              k++;
              var subj = DATA.groups.length > 1 ? ' <span class="ansubj">[' + esc(q.subject || '') + ']</span>' : '';
              var cl = correctLetter(q);
              var expStr = (S.showExplanation && q.explanation) ? '<div class="exp"><b>Explanation:</b> ' + esc(q.explanation) + '</div>' : '';
              /* Bracketed page ref right after the answer text — measured as
                 [p99] and stamped with the real question page after packing,
                 and OUTSIDE the explanation so switching the toggle off never
                 removes it. */
              var pno = S.qPageNo ? '<span class="anspno" data-qn="' + k + '">[p99]</span>' : '';
              ansItems.push('<div class="a"><b>' + qNo(q, k) + '</b>' + subj + ' ' + (cl ? '<b>' + cl + ')</b> ' : '') + esc(answerText(q)) + (pno ? ' ' + pno : '') + (expStr ? ' ' + expStr : '') + '</div>');
            }); });
          }

          /* 2 — measure everything at its true width */
          var MMv = 96 / 25.4, fullH = 0, ansFullH = 0;
          if (fulls.length) { var fh = measureAll(fulls, g.cw * MMv, false); for (i = 0; i < fh.length; i++) fullH += fh[i]; }
          var itemH = measureAll(items, g.colW * MMv, true);
          if (ansFull.length) { var ah = measureAll(ansFull, g.cw * MMv, false); for (i = 0; i < ah.length; i++) ansFullH += ah[i]; }
          var ansH = measureAll(ansItems, ((g.cw - g.cg * (g.ac - 1)) / g.ac) * MMv, false);

          /* 3 — pack into real pages; the answer key always starts a new sheet */
          var pageH = g.ch * MMv;
          var qPages = items.length ? pack(items, itemH, g.cols, pageH, pageH - fullH) : [];
          var aPages = ansItems.length ? pack(ansItems, ansH, g.ac, pageH, pageH - ansFullH) : [];

          /* 4 — emit one .pg box per A4 sheet, with a labelled break guide
             between neighbours (screen-only; print uses forced page breaks). */
          var qn = qPages.length, an = aPages.length, total = qn + an, parts = [];
          for (i = 0; i < total; i++) {
            var kind = i < qn ? 'q' : 'a';
            var P = i < qn ? qPages[i] : aPages[i - qn];
            var first = null;
            if (kind === 'q' && i === 0) first = fulls;
            if (kind === 'a' && i === qn) first = (qn === 0 ? fulls : []).concat(ansFull);
            var body = (first && first.length ? first.join('') : '') +
              '<div class="prow">' + P.items.map(function(colHtml){ return '<div class="pcol">' + colHtml.join('') + '</div>'; }).join('') + '</div>';
            parts.push('<div class="pg" data-kind="' + kind + '">' + body + '</div>');
            if (i < total - 1) parts.push('<div class="pgbr"><span>Page ' + (i + 2) + ' / ' + total + '</span></div>');
          }
          paper.innerHTML = parts.join('');
          autoOptions(paper);

          /* 5 — stamp the real sheet number into the answer key's bracketed
             refs: every question knows which packed page it landed on, so each
             answer shows the page its question is printed on. */
          if (S.qPageNo) {
            var anyBn = false;
            DATA.groups.forEach(function(gr){ gr.questions.forEach(function(q){ if (isBangla(q.prompt)) anyBn = true; }); });
            var useBn = S.numStyle === 'bangla' || (S.numStyle !== 'english' && anyBn);
            var qPage = {};
            var pgEls = paper.querySelectorAll('.pg');
            for (i = 0; i < pgEls.length; i++) {
              var qs = pgEls[i].querySelectorAll('.q[data-qn]');
              for (var j = 0; j < qs.length; j++) qPage[qs[j].getAttribute('data-qn')] = i + 1;
            }
            var anspnos = paper.querySelectorAll('.anspno');
            for (i = 0; i < anspnos.length; i++) {
              var pn = qPage[anspnos[i].getAttribute('data-qn')];
              if (pn) anspnos[i].textContent = '[p' + (useBn ? bnDigits(pn) : String(pn)) + ']';
            }
          }

          updatePages();
          var pgs = document.getElementById('pagestyle');
          if (pgs) pgs.textContent = pageCss();
        }
        /* Exact sheet counts, read straight from the packed pages in the DOM. */
        function updatePages(){
          var out = document.getElementById('pginfo');
          if (!out) return;
          var qn = paper.querySelectorAll('.pg[data-kind="q"]').length;
          var an = paper.querySelectorAll('.pg[data-kind="a"]').length;
          var total = qn + an, qc = 0;
          DATA.groups.forEach(function(g){ qc += g.questions.length; });
          var per = qn ? Math.round(qc / qn) : 0;
          if (an) out.textContent = 'This paper: ' + qn + ' question page' + (qn === 1 ? '' : 's') + ' + ' + an + ' answer page' + (an === 1 ? '' : 's') + ' = ' + total + ' A4 sheet' + (total === 1 ? '' : 's') + '.';
          else out.textContent = 'This paper: ' + total + ' A4 sheet' + (total === 1 ? '' : 's') + (qn ? ' \u00b7 ' + per + ' questions per page' : '') + '.';
        }
        function bind(id, key, kind){
          var el = document.getElementById(id);
          if (!el) return;
          var h = function(){
            if (kind === 'bool') S[key] = el.checked;
            else if (kind === 'num') S[key] = Number(el.value);
            else S[key] = el.value;
            render();
            savePrefs();
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
        document.getElementById('f-fs').value = S.fontSize;
        document.getElementById('f-cols').value = String(S.columns);
        document.getElementById('m-top').value = S.marginTop;
        document.getElementById('m-right').value = S.marginRight;
        document.getElementById('m-bottom').value = S.marginBottom;
        document.getElementById('m-left').value = S.marginLeft;
        document.getElementById('f-font').value = S.fontFamily || 'serif';
        document.getElementById('f-lh').value = S.lineHeight;
        document.getElementById('f-qgap').value = S.qgap;
        document.getElementById('f-cgap').value = S.cgap;
        document.getElementById('f-anscols').value = String(S.ansCols || 2);
        document.getElementById('f-qpgno').checked = S.qPageNo !== false;
        document.getElementById('f-exp').checked = !!S.showExplanation;
        document.getElementById('f-breaks').checked = S.showBreaks !== false;
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
        bind('m-top', 'marginTop', 'num');
        bind('m-right', 'marginRight', 'num');
        bind('m-bottom', 'marginBottom', 'num');
        bind('m-left', 'marginLeft', 'num');
        bind('f-font', 'fontFamily', 'sel');
        bind('f-lh', 'lineHeight', 'num');
        bind('f-qgap', 'qgap', 'num');
        bind('f-cgap', 'cgap', 'num');
        bind('f-anscols', 'ansCols', 'num');
        bind('f-qpgno', 'qPageNo', 'bool');
        bind('f-exp', 'showExplanation', 'bool');
        bind('f-breaks', 'showBreaks', 'bool');
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
        document.getElementById('shuffleQBtn').addEventListener('click', function(){ shuffleQuestions(); });
        document.getElementById('resetBtn').addEventListener('click', function(){ resetOrder(); });
        (function(){
          /* Density presets: one click applies a whole space profile (margins,
             leading, gaps) instead of five separate controls — Compact is the
             one to reach for on 100–200 question papers. */
          var PRESETS = {
            compact: { marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10, lineHeight: 1.2, qgap: 1, cgap: 4 },
            standard: { marginTop: 12, marginRight: 12.7, marginBottom: 11, marginLeft: 12, lineHeight: 1.35, qgap: 1.8, cgap: 6 },
            spacious: { marginTop: 16, marginRight: 16, marginBottom: 15, marginLeft: 16, lineHeight: 1.5, qgap: 2.8, cgap: 8 }
          };
          var IDS = { marginTop: 'm-top', marginRight: 'm-right', marginBottom: 'm-bottom', marginLeft: 'm-left', lineHeight: 'f-lh', qgap: 'f-qgap', cgap: 'f-cgap' };
          function apply(name){
            var p = PRESETS[name];
            if (!p) return;
            Object.keys(p).forEach(function(k){
              S[k] = p[k];
              var el = document.getElementById(IDS[k]);
              if (el) el.value = p[k];
            });
            render();
            savePrefs();
          }
          ['compact', 'standard', 'spacious'].forEach(function(name){
            var b = document.getElementById('dens-' + name);
            if (b) b.addEventListener('click', function(){ apply(name); });
          });
        })();
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
        document.getElementById('forgetBtn').addEventListener('click', function(){
          try { localStorage.removeItem('mcq_print_prefs'); } catch (e) {}
          window.location.reload();
        });
        /* Re-draw once webfonts are ready (Bengali widens option text and can
           flip two-col options to one-col; packing must use real heights). */
        if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function(){ render(); }); }
        /* On resize, no need to re-pack (pages are MM-fixed), but the info text
           does not depend on viewport — keep a no-op-free approach; the real
           sheet counts never change. */
        render();
      </script>
      </body></html>`;
}
