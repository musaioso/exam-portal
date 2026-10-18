import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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

/** One button in a choiceDialog. Mark exactly one with `safe` if you can. */
export type DialogAction = {
  label: string;
  /** What the promise resolves with when this button is pressed. */
  value: string;
  variant?: "primary" | "ghost" | "danger" | "outline";
  /** The button that gets focus when the dialog opens. */
  safe?: boolean;
};

export type ChoiceOptions = {
  title?: string;
  message?: string;
  actions: DialogAction[];
};

type Entry =
  | { kind: "confirm"; message: string; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "alert"; message: string; options: AlertOptions; resolve: () => void }
  | { kind: "choice"; message: string; options: ChoiceOptions; resolve: (value: string | null) => void };

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
function settle(answer: boolean | string | null) {
  const entry = current;
  if (!entry) return;
  current = null;
  emit();
  if (entry.kind === "confirm") entry.resolve(answer === true);
  else if (entry.kind === "choice") entry.resolve(typeof answer === "string" ? answer : null);
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

/**
 * More than yes/no: resolves with the value of the chosen action, or null if the
 * dialog was dismissed (Esc / clicking away).
 */
export function choiceDialog(options: ChoiceOptions): Promise<string | null> {
  return new Promise((resolve) => {
    settle(false);
    current = { kind: "choice", message: options.message ?? "", options, resolve };
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
  let danger = false;
  let footer: ReactNode;

  if (entry.kind === "confirm") {
    const o = entry.options;
    title = o.title ?? "Are you sure?";
    body = entry.message || undefined;
    danger = o.tone === "danger";
    footer = (
      <>
        <Button data-dialog-safe variant="ghost" onClick={() => settle(false)}>
          {o.cancelLabel ?? "Cancel"}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={() => settle(true)}>
          {o.confirmLabel ?? "Confirm"}
        </Button>
      </>
    );
  } else if (entry.kind === "choice") {
    const o = entry.options;
    title = o.title ?? "Choose one";
    body = entry.message || undefined;
    const safeIdx = Math.max(0, o.actions.findIndex((a) => a.safe));
    footer = o.actions.map((a, i) => (
      <Button
        key={a.value}
        data-dialog-safe={i === safeIdx ? true : undefined}
        variant={a.variant ?? "outline"}
        onClick={() => settle(a.value)}
      >
        {a.label}
      </Button>
    ));
  } else {
    const o = entry.options;
    title = o.title ?? "Heads up";
    body = entry.message || undefined;
    footer = (
      <Button data-dialog-safe variant="primary" onClick={() => settle(true)}>
        {o.okLabel ?? "OK"}
      </Button>
    );
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
        <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
