import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";

/**
 * The small centred dialog used by the NotebookLM tab. `size` widens the panel
 * for editors that need more than one column (the pattern editor).
 */
export default function Modal({
  title,
  description,
  size = "md",
  onClose,
  children,
}: {
  title: string;
  description?: string;
  size?: "md" | "lg";
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`glass relative max-h-[90vh] w-full ${size === "lg" ? "max-w-3xl" : "max-w-lg"} overflow-y-auto rounded-2xl border border-slate-600/60 p-6 shadow-2xl`}
      >
        <div className="mb-4 flex items-start justify-between gap-4 pr-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-xl p-1.5 text-slate-400 transition hover:bg-ink/10 hover:text-slate-200"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}
