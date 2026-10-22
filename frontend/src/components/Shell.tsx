import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { LayoutDashboard, BookOpen, ClipboardList, Users, Printer, LogOut, GraduationCap, UserCircle, Menu, Sparkles, Target, SpellCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";
import { StorageWarning } from "./StorageWarning";
import { cn } from "./ui";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin","teacher","student"] },
  { to: "/subjects", label: "Subjects & Chapters", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/questions", label: "Question Bank", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/generate", label: "AI Generate", icon: Sparkles, roles: ["admin","teacher"] },
  { to: "/spelling", label: "Spelling MCQs", icon: SpellCheck, roles: ["admin","teacher"] },
  { to: "/exams", label: "Exams", icon: ClipboardList, roles: ["admin","teacher","student"] },
  { to: "/print", label: "Print Paper", icon: Printer, roles: ["admin","teacher"] },
  { to: "/users", label: "Students", icon: Users, roles: ["admin","teacher"] },
  { to: "/results", label: "Results", icon: GraduationCap, roles: ["admin","teacher","student"] },
  { to: "/practice/standalone", label: "Standalone Practice", icon: Target, roles: ["admin","teacher","student"] },
  { to: "/profile", label: "My Profile", icon: UserCircle, roles: ["admin","teacher","student"] },
];

const STORAGE_KEY = "mcq_sidebar_collapsed";

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const items = NAV.filter(n => user && n.roles.includes(user.role));
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  const close = () => setOpen(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Keyboard shortcut: Ctrl/Cmd+B toggles collapse (desktop only).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // forceExpanded: mobile drawer always shows the full sidebar.
  const sidebar = (solid = false, forceExpanded = false) => {
    const isCollapsed = collapsed && !forceExpanded;
    return (
      <aside className={cn(
        "relative flex h-full flex-col gap-1 p-3 transition-[width] duration-200 ease-out",
        isCollapsed ? "w-14 items-center" : "w-64",
        solid ? "bg-slate-900 shadow-2xl" : "border-r border-slate-700/50 bg-slate-900/40 backdrop-blur",
      )}>
        {/* Toggle button: fixed position, never moves between states. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-ink/10 hover:text-slate-200"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {/* Logo row: top padding clears the floating toggle button. */}
        <div className={cn("mb-2 flex items-center", isCollapsed ? "justify-center px-0 pt-10 pb-2" : "px-2 py-3 pr-10")}>
          <Logo size={isCollapsed ? "sm" : "md"} showText={!isCollapsed} to="/dashboard" iconClassName={isCollapsed ? "h-7 w-7" : undefined} />
        </div>

        {items.map(n => {
          const Icon = n.icon;
          const active = loc.pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={close}
              title={isCollapsed ? n.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150",
                isCollapsed && "justify-center px-2",
                active ? "bg-indigo-500/20 text-indigo-300" : "text-slate-300 hover:bg-ink/10"
              )}
            >
              <Icon size={17} className="shrink-0" />
              {!isCollapsed && <span className="truncate">{n.label}</span>}
            </Link>
          );
        })}
        <div className={cn("mt-auto space-y-1 border-t border-slate-700/50 pt-4", isCollapsed && "flex flex-col items-center")}>
          <ThemeToggle compact={isCollapsed} />
          <Link
            to="/profile"
            onClick={close}
            title={isCollapsed ? (user?.name || "Profile") : undefined}
            className={cn("block rounded-xl px-2 py-1.5 text-xs text-slate-400 hover:bg-ink/10", isCollapsed && "text-center")}
          >
            {isCollapsed ? (
              <UserCircle size={17} className="mx-auto text-slate-400" />
            ) : (
              <>{user?.name}<br/><span className="text-slate-500">{user?.role}</span></>
            )}
          </Link>
          <button
            onClick={() => { logout(); nav("/login"); }}
            title={isCollapsed ? "Logout" : undefined}
            className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 transition-colors duration-150 hover:bg-ink/10", isCollapsed && "justify-center px-2")}
          >
            <LogOut size={17} className="shrink-0" />
            {!isCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    );
  };

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block transition-[width] duration-200 ease-out">{sidebar()}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="absolute inset-y-0 left-0 z-50">{sidebar(true, true)}</div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b border-slate-700/50 bg-slate-900 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-300 transition hover:bg-ink/10"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <Logo size="sm" to="/dashboard" className="gap-2" />
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 transition-all duration-200">
          <StorageWarning className="mb-6" />
          {children}
        </main>
      </div>
    </div>
  );
}