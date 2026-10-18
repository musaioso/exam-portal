// A small, themed toast system. Use `useToast()` from any component rendered
// inside <ToastProvider> (which wraps the app in App.tsx).
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "./ui";

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };

const ToastContext = createContext<{ push: (kind: ToastKind, message: string) => void } | null>(null);

const KIND_STYLE: Record<ToastKind, string> = {
  success: "border-emerald-500/40 text-emerald-200",
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

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))] pointer-events-none">
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
    success: (m: string) => ctx.push("success", m),
    error: (m: string) => ctx.push("error", m),
    info: (m: string) => ctx.push("info", m),
  };
}