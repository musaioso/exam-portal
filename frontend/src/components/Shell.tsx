import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { LayoutDashboard, BookOpen, ClipboardList, Users, Printer, LogOut, GraduationCap, UserCircle, Menu, Sparkles, Target } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";
import { StorageWarning } from "./StorageWarning";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin","teacher","student"] },
  { to: "/subjects", label: "Subjects & Chapters", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/questions", label: "Question Bank", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/generate", label: "AI Generate", icon: Sparkles, roles: ["admin","teacher"] },
  { to: "/exams", label: "Exams", icon: ClipboardList, roles: ["admin","teacher","student"] },
  { to: "/print", label: "Print Paper", icon: Printer, roles: ["admin","teacher"] },
  { to: "/users", label: "Students", icon: Users, roles: ["admin","teacher"] },
  { to: "/results", label: "Results", icon: GraduationCap, roles: ["admin","teacher","student"] },
  { to: "/practice/standalone", label: "Standalone Practice", icon: Target, roles: ["admin","teacher","student"] },
  { to: "/profile", label: "My Profile", icon: UserCircle, roles: ["admin","teacher","student"] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const items = NAV.filter(n => user && n.roles.includes(user.role));
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col gap-1 border-r border-slate-700/50 bg-slate-900/40 p-4 backdrop-blur">
      <div className="mb-2 px-2 py-3">
        <Logo size="md" className="gap-2" />
      </div>
      {items.map(n => {
        const Icon = n.icon;
        const active = loc.pathname.startsWith(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={close}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-indigo-500/20 text-indigo-300" : "text-slate-300 hover:bg-ink/10"}`}
          >
            <Icon size={17} /> {n.label}
          </Link>
        );
      })}
      <div className="mt-auto space-y-1 border-t border-slate-700/50 pt-4">
        <ThemeToggle />
        <Link
          to="/profile"
          onClick={close}
          title="My profile"
          className="block rounded-xl px-2 py-1.5 text-xs text-slate-400 hover:bg-ink/10"
        >
          {user?.name}<br/><span className="text-slate-500">{user?.role}</span>
        </Link>
        <button
          onClick={() => { logout(); nav("/login"); }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-300 transition hover:bg-ink/10"
        >
          <LogOut size={17} /> Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block">{sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={close} />
          <div className="absolute inset-y-0 left-0 z-50">{sidebar}</div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b border-slate-700/50 bg-slate-900/40 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-300 transition hover:bg-ink/10"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <Logo size="sm" className="gap-2" />
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <StorageWarning className="mb-6" />
          {children}
        </main>
      </div>
    </div>
  );
}