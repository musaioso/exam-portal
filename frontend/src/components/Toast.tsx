// A small, themed toast system. Use `useToast()` from any component rendered
// inside <ToastProvider> (which wraps the app in App.tsx).
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "./ui";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string; action?: { label: string; onClick: () => void } };

const ToastContext = createContext<{ push: (kind: ToastKind, message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => void } | null>(null);

const KIND_STYLE: Record<ToastKind, string> = {
  success: "border-emerald-500/40 text-emerald-300",
  error: "border-rose-500/40 text-rose-200",
  info: "border-indigo-500/40 text-indigo-200",
};
const KIND_ICON: Record<ToastKind, any> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message, action: opts?.action }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), opts?.duration ?? 3500);
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))] pointer-events-none">
        {items.map((t) => {
          const Icon = KIND_ICON[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "glass pointer-events-auto flex items-start gap-2 px-4 py-3 text-sm shadow-lg animate-[fadeIn_0.18s_ease-out]",
                KIND_STYLE[t.kind],
              )}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="flex-1 break-words">{t.message}</div>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); remove(t.id); }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => remove(t.id)}
                className="shrink-0 text-slate-400 hover:text-slate-200 transition"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return {
    success: (m: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => ctx.push("success", m, opts),
    error: (m: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => ctx.push("error", m, opts),
    info: (m: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => ctx.push("info", m, opts),
  };
}