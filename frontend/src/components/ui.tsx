import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...i: any[]) { return twMerge(clsx(i)); }

export function Button({ className, variant="primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary"|"ghost"|"danger"|"outline" }) {
  const base = "inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95";
  const v: Record<string,string> = {
    primary: "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 text-white shadow-lg shadow-fuchsia-500/30 hover:shadow-xl hover:shadow-fuchsia-400/40 hover:-translate-y-0.5",
    ghost: "hover:bg-white/10 text-slate-200",
    danger: "bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-lg shadow-rose-500/30",
    outline: "border border-slate-600/70 hover:bg-white/10 text-slate-200 hover:border-violet-400/60",
  };
  return <button className={cn(base, v[variant], className)} {...props} />;
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("glass rounded-2xl p-6 shadow-xl", className)}>{children}</div>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full bg-slate-900/60 border border-slate-600/70 rounded-2xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/70 focus:border-violet-400/60 transition", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("w-full bg-slate-900/60 border border-slate-600/70 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/70 focus:border-violet-400/60 transition", props.className)} />;
}

export function Select({ className, style, children, value, onChange, disabled, required, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  const options = React.useMemo(() => {
    return React.Children.toArray(children)
      .filter((c): c is React.ReactElement<any> => React.isValidElement(c))
      .map((c) => ({
        value: c.props.value ?? c.props.children,
        label: c.props.children,
      }));
  }, [children]);
  const selected = options.find((o) => String(o.value) === String(value));
  const isEmpty = options.some((o) => String(o.value) === "");
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const updatePos = React.useCallback(() => {
    if (!buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX, width: r.width });
  }, []);

  React.useEffect(() => {
    if (!open) { setPos(null); return; }
    updatePos();
    const onScrollResize = () => updatePos();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => { window.removeEventListener("scroll", onScrollResize, true); window.removeEventListener("resize", onScrollResize); };
  }, [open, updatePos]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const handleSelect = (val: any) => {
    if (onChange) onChange({ target: { value: val, name: props.name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={cn("relative w-full", className)} style={style}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "w-full flex items-center justify-between gap-2 bg-slate-900/60 border border-slate-600/70 rounded-2xl px-4 py-2.5 pr-9 text-sm text-slate-100 transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/70 focus:border-violet-400/60",
          disabled && "opacity-50 cursor-not-allowed",
          open && "ring-2 ring-violet-500/70"
        )}
      >
        <span className={cn("truncate", !selected && "text-slate-500")}>
          {selected ? selected.label : (placeholder || (isEmpty ? options.find((o) => String(o.value) === "")?.label : "Select"))}
        </span>
        <ChevronDown size={16} className={cn("pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{ position: "absolute", top: pos.top, left: pos.left, width: pos.width, zIndex: 100001 }}
          className="max-h-64 overflow-auto rounded-xl border border-slate-600/80 bg-slate-900/98 backdrop-blur-xl shadow-2xl py-1"
        >
          {options.map((o, i) => {
            const active = String(o.value) === String(value);
            return (
              <button
                key={`${String(o.value)}-${i}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => handleSelect(o.value)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm transition",
                  active ? "bg-violet-500/25 text-violet-200" : "text-slate-200 hover:bg-white/10"
                )}
              >
                <span className="truncate">{o.label}</span>
                {active && <span className="text-violet-300 text-xs">✓</span>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
      {/* Hidden native select keeps form validation & submission semantics */}
      <select
        {...props}
        value={value ?? ""}
        onChange={() => {}}
        aria-hidden="true"
        tabIndex={-1}
        required={required}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none", inset: 0 }}
      >
        {children}
      </select>
    </div>
  );
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-block px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30", className)}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}