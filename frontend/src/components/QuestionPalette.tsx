import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button, cn } from "./ui";

export type PaletteItem = {
  /** Question id — used as the React key. */
  id: string;
  /** Whether the student has already answered this question. */
  answered: boolean;
};

type PaletteGridProps = {
  items: PaletteItem[];
  /** Index of the question currently on screen. */
  current: number;
  /** Called with the index of the picked question. */
  onPick: (index: number) => void;
  className?: string;
};

/**
 * The answered / unanswered question palette.
 *
 * It deliberately lives OUTSIDE the sticky exam header: with a few hundred
 * questions the grid is far taller than a phone screen, so keeping it in the
 * header would push the question itself off the viewport. Callers put it in a
 * height-capped scroll area (desktop rail) or in the sheet below (mobile).
 */
export function QuestionPaletteGrid({ items, current, onPick, className }: PaletteGridProps) {
  return (
    <div className={cn("grid grid-cols-8 gap-1.5 sm:grid-cols-10 xl:grid-cols-6", className)}>
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(i)}
          aria-current={i === current ? "true" : undefined}
          aria-label={`Question ${i + 1}${item.answered ? ", answered" : ", not answered"}`}
          className={cn(
            "flex h-8 items-center justify-center rounded-lg border text-[11px] font-semibold tabular-nums transition",
            i === current
              ? "scale-105 border-transparent bg-slate-100 text-slate-900 ring-2 ring-cyan-300"
              : item.answered
                ? "border-transparent bg-emerald-500 text-white"
                : "border-amber-500/50 bg-amber-500/15 text-amber-200",
          )}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

/** Colour key for the palette chips. */
export function PaletteLegend({ answered, total }: { answered: number; total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-slate-100 ring-2 ring-cyan-300" /> Current
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Answered ({answered})
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm border border-amber-500/50 bg-amber-500/15" /> Not
        answered ({Math.max(0, total - answered)})
      </span>
    </div>
  );
}

type PaletteSheetProps = PaletteGridProps & {
  open: boolean;
  onClose: () => void;
  answered: number;
  total: number;
};

/**
 * Full-width bottom sheet that hosts the palette on small screens.
 * Rendered through a portal so it is never clipped by the page's scroll
 * container, and Esc / the backdrop / the Done button all close it.
 */
export function QuestionPaletteSheet({
  open,
  onClose,
  answered,
  total,
  ...grid
}: PaletteSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6 xl:hidden">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Question palette"
        tabIndex={-1}
        className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-600/60 bg-slate-900/95 shadow-2xl backdrop-blur-xl sm:max-h-[80vh] sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Questions</div>
            <div className="text-xs text-slate-400 tabular-nums">
              {answered} of {total} answered
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close question palette"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-300 transition hover:bg-ink/10"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          <QuestionPaletteGrid {...grid} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 px-4 py-3">
          <PaletteLegend answered={answered} total={total} />
          <Button onClick={onClose} className="px-3 py-1.5 text-xs">
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
