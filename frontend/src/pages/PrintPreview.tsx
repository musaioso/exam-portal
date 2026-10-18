import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { buildPrintHtml, PREVIEW_STORAGE_KEY, type PrintData } from "../lib/printTemplate";

/**
 * /print/preview — the print preview document.
 *
 * The Print page stages its payload in sessionStorage (copied to windows
 * opened via window.open) and opens this real URL instead of an about:blank
 * popup, so the preview is a normal document: it renders in any browser,
 * shows a proper address bar, survives reloads, and never appears blank.
 *
 * On mount the staged payload is rendered as a full document via
 * document.write — the same mechanism as before, just on a real URL. If the
 * payload is missing (opened directly), a themed fallback message is shown.
 */
export default function PrintPreview() {
  const [hasData] = useState(() => {
    try {
      return !!sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!hasData) return;
    // Guard against React StrictMode's double effect in development.
    const w = window as typeof window & { __mcqPreviewWritten?: boolean };
    if (w.__mcqPreviewWritten) return;

    let payload: PrintData | null = null;
    try {
      payload = JSON.parse(sessionStorage.getItem(PREVIEW_STORAGE_KEY) || "null");
    } catch {
      payload = null;
    }
    if (!payload || !Array.isArray(payload.groups) || !payload.defaults) return;

    w.__mcqPreviewWritten = true;
    document.open();
    document.write(buildPrintHtml(payload));
    document.close();
  }, [hasData]);

  if (!hasData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-md text-center space-y-3">
          <h1 className="text-xl font-semibold">No paper staged for preview</h1>
          <p className="text-sm text-slate-400">
            This page renders a paper prepared on the Print Paper page. Pick
            your questions there, then press <b>Preview &amp; Print</b>.
          </p>
          <Link
            to="/print"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 shadow-lg shadow-fuchsia-500/30 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
          >
            Back to Print Paper
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
