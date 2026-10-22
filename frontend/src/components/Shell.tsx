import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { LayoutDashboard, BookOpen, ClipboardList, Users, Printer, LogOut, GraduationCap, UserCircle, Menu, Sparkles, Target, SpellCheck, ChevronLeft, ChevronRight, FileQuestion, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";
import { StorageWarning } from "./StorageWarning";
import { cn } from "./ui";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin","teacher","student"] },
  { to: "/subjects", label: "Subjects & Chapters", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/questions", label: "Question Bank", icon: FileQuestion, roles: ["admin","teacher"] },
  { to: "/generate", label: "AI Generate", icon: Sparkles, roles: ["admin","teacher"] },
  { to: "/spelling", label: "Spelling MCQs", icon: SpellCheck, roles: ["admin","teacher"] },
  { to: "/exams", label: "Exams", icon: ClipboardList, roles: ["admin","teacher","student"] },
  { to: "/print", label: "Print Paper", icon: Printer, roles: ["admin","teacher"] },
  { to: "/users", label: "Students", icon: Users, roles: ["admin","teacher"] },
  { to: "/results", label: "Results", icon: GraduationCap, roles: ["admin","teacher","student"] },
  { to: "/practice/standalone", label: "Standalone Practice", icon: Target, roles: ["admin","teacher","student"] },
];

const STORAGE_KEY = "mcq_sidebar_collapsed";
const ICON_SIZE = 18;

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

  const sidebar = (solid = false, forceExpanded = false) => {
    const isCollapsed = collapsed && !forceExpanded;
    return (
      <aside className={cn(
        "relative flex h-full flex-col gap-1 p-3 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
        isCollapsed ? "w-14 items-center" : "w-64",
        solid ? "bg-slate-900 shadow-2xl" : "border-r border-slate-700/50 bg-slate-900/40 backdrop-blur",
      )}>
        {/* Toggle button: centered at top, themed for visibility. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          className={cn(
            "absolute top-2 z-20 grid h-8 w-8 place-items-center rounded-lg text-indigo-300 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-indigo-500/20 hover:text-indigo-100 bg-indigo-500/10 border border-indigo-500/30",
            isCollapsed ? "right-3" : "right-2",
          )}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
        >
          {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        {/* Logo row */}
        <div className={cn("mb-2 flex transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]", isCollapsed ? "justify-center pt-10 pb-2" : "items-center px-2 py-3 pr-10")}>
          <div className={cn(isCollapsed ? "flex items-center justify-center w-10 h-10" : "flex items-center")}>
            <Logo size={isCollapsed ? "sm" : "md"} showText={!isCollapsed} to="/dashboard" iconClassName={isCollapsed ? "h-5 w-5" : undefined} />
          </div>
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
                "flex items-center rounded-xl text-sm transition-colors duration-150",
                isCollapsed ? "justify-center w-10 h-10" : "w-full px-3 py-2 h-9",
                active ? "bg-indigo-500/20 text-indigo-300" : "text-slate-300 hover:bg-ink/10"
              )}
            >
              <Icon size={ICON_SIZE} className="shrink-0" />
              <span className={cn(
                "truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
                isCollapsed ? "ml-0 max-w-0 opacity-0" : "ml-3 max-w-[200px] opacity-100"
              )}>{n.label}</span>
            </Link>
          );
        })}
        <div className={cn("mt-auto space-y-1 border-t border-slate-700/50 pt-4 transition-all duration-300", isCollapsed && "flex flex-col items-center")}>
          <div className={cn("flex items-center justify-center", isCollapsed ? "w-10 h-10" : "w-full")}>
            <ThemeToggle compact={isCollapsed} />
          </div>
          <Link
            to="/profile"
            onClick={close}
            title={isCollapsed ? (user?.name || "Profile") : undefined}
            className={cn("flex items-center rounded-xl text-xs text-slate-400 transition-colors duration-150 hover:bg-ink/10", isCollapsed ? "justify-center w-10 h-10" : "w-full px-3 py-2")}
          >
            <UserCircle size={ICON_SIZE} className="shrink-0 text-slate-400" />
            <div className={cn(
              "flex min-w-0 items-center gap-1.5 overflow-hidden leading-tight transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              isCollapsed ? "ml-0 max-w-0 opacity-0" : "ml-3 max-w-[200px] opacity-100"
            )}>
              <span className="truncate font-medium text-slate-200">{user?.name}</span>
              <span className="shrink-0 text-slate-600" aria-hidden="true">·</span>
              <span className="shrink-0 capitalize text-slate-500">{user?.role}</span>
            </div>
          </Link>
          <button
            onClick={() => { logout(); nav("/login"); }}
            title={isCollapsed ? "Logout" : undefined}
            className={cn("flex items-center rounded-xl text-sm text-slate-300 transition-colors duration-150 hover:bg-ink/10", isCollapsed ? "justify-center w-10 h-10" : "w-full px-3 py-2 h-9")}
          >
            <LogOut size={ICON_SIZE} className="shrink-0" />
            <span className={cn(
              "truncate transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              isCollapsed ? "ml-0 max-w-0 opacity-0" : "ml-3 max-w-[200px] opacity-100"
            )}>Logout</span>
          </button>
        </div>
      </aside>
    );
  };

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]">{sidebar()}</div>

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

        <main className="flex-1 overflow-auto p-4 md:p-6 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]">
          <StorageWarning className="mb-6" />
          {children}
        </main>
      </div>
    </div>
  );
}