import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info } from "lucide-react";
import { Button, cn } from "./ui";

/**
 * In-app replacements for window.confirm() / window.alert().
 * Both resolve a promise, so callers just await them:
 *
 *   if (!(await confirmDialog({ title: "Delete exam?", tone: "danger" }))) return;
 *   await alertDialog({ title: "Import result", message: summary });
 */

export type ConfirmOptions = {
  /** Heading shown above the message. */
  title?: string;
  /** Body text. Newlines are preserved (kept on their own lines). */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button rose and shows the warning glyph. */
  tone?: "default" | "danger";
};

export type AlertOptions = {
  title?: string;
  message: string;
  okLabel?: string;
};

type Entry =
  | { kind: "confirm"; message: string; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "alert"; message: string; options: AlertOptions; resolve: () => void };

// A single dialog at a time, held outside React so it can be opened from anywhere.
let current: Entry | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getSnapshot = () => current;

/** Close whatever is showing and hand the answer back to whoever asked. */
function settle(ok: boolean) {
  const entry = current;
  if (!entry) return;
  current = null;
  emit();
  if (entry.kind === "confirm") entry.resolve(ok);
  else entry.resolve();
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    settle(false); // never stack — an older dialog simply gets dismissed
    current = { kind: "confirm", message: options.message ?? "", options, resolve };
    emit();
  });
}

export function alertDialog(options: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    settle(false);
    current = { kind: "alert", message: options.message, options, resolve };
    emit();
  });
}

export function DialogHost() {
  const entry = useSyncExternalStore(subscribe, getSnapshot);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!entry) return;
    // Remember what opened us so focus can go back when we close.
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the safe option (Cancel / OK) — matches how native confirms behave.
    panelRef.current?.querySelector<HTMLElement>("[data-dialog-safe]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Tiny focus trap: keep Tab inside the panel.
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [entry]);

  if (!entry) return null;

  let title: string;
  let body: string | undefined;
  let confirmLabel: string;
  let cancelLabel: string | undefined;
  let danger = false;

  if (entry.kind === "confirm") {
    const o = entry.options;
    title = o.title ?? "Are you sure?";
    body = entry.message || undefined;
    confirmLabel = o.confirmLabel ?? "Confirm";
    cancelLabel = o.cancelLabel ?? "Cancel";
    danger = o.tone === "danger";
  } else {
    const o = entry.options;
    title = o.title ?? "Heads up";
    body = entry.message || undefined;
    confirmLabel = o.okLabel ?? "OK";
    cancelLabel = undefined;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mcq-dialog-title"
        aria-describedby={body ? "mcq-dialog-body" : undefined}
        className="glass relative w-full max-w-md rounded-2xl border border-slate-600/60 p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl",
              danger ? "bg-rose-500/15 text-rose-400" : "bg-indigo-500/15 text-indigo-400",
            )}
          >
            {danger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="mcq-dialog-title" className="text-base font-semibold text-slate-100">
              {title}
            </h2>
            {body && (
              <p id="mcq-dialog-body" className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                {body}
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          {cancelLabel && (
            <Button data-dialog-safe variant="ghost" onClick={() => settle(false)}>
              {cancelLabel}
            </Button>
          )}
          <Button
            data-dialog-safe={cancelLabel ? undefined : true}
            variant={danger ? "danger" : "primary"}
            onClick={() => settle(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
