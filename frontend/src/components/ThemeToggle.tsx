import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme-context";
import { cn } from "./ui";

/**
 * Light / dark switch. `compact` renders an icon-only button (for the
 * login / register corners); the default renders a labelled full-width row
 * that fits the sidebar.
 */
export function ThemeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "Light mode" : "Dark mode";
  const Icon = isDark ? Sun : Moon;

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-700/60 bg-slate-900/40 text-slate-300 transition hover:bg-ink/10",
          className
        )}
      >
        <Icon size={18} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-300 transition hover:bg-ink/10 w-full",
        className
      )}
    >
      <Icon size={17} /> {label}
    </button>
  );
}
