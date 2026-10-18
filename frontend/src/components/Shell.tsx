import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { LayoutDashboard, BookOpen, ClipboardList, Users, Printer, LogOut, GraduationCap, UserCircle } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";
import { StorageWarning } from "./StorageWarning";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin","teacher","student"] },
  { to: "/subjects", label: "Subjects & Chapters", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/questions", label: "Question Bank", icon: BookOpen, roles: ["admin","teacher"] },
  { to: "/exams", label: "Exams", icon: ClipboardList, roles: ["admin","teacher","student"] },
  { to: "/print", label: "Print Paper", icon: Printer, roles: ["admin","teacher"] },
  { to: "/users", label: "Students", icon: Users, roles: ["admin","teacher"] },
  { to: "/results", label: "Results", icon: GraduationCap, roles: ["admin","teacher","student"] },
  { to: "/profile", label: "My Profile", icon: UserCircle, roles: ["admin","teacher","student"] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const items = NAV.filter(n => user && n.roles.includes(user.role));
  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r border-slate-700/50 p-4 flex flex-col gap-1 bg-slate-900/40 backdrop-blur">
        <div className="px-2 py-3 mb-2">
          <Logo size="md" className="gap-2" />
        </div>
        {items.map(n => {
          const Icon = n.icon;
          const active = loc.pathname.startsWith(n.to);
          return (
            <Link key={n.to} to={n.to} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition ${active ? "bg-indigo-500/20 text-indigo-300" : "text-slate-300 hover:bg-ink/10"}`}>
              <Icon size={17} /> {n.label}
            </Link>
          );
        })}
        <div className="mt-auto pt-4 border-t border-slate-700/50 space-y-1">
          <ThemeToggle />
          <Link
            to="/profile"
            title="My profile"
            className="block px-2 py-1.5 rounded-xl text-xs text-slate-400 hover:bg-ink/10"
          >
            {user?.name}<br/><span className="text-slate-500">{user?.role}</span>
          </Link>
          <button onClick={() => { logout(); nav("/login"); }} className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-300 hover:bg-ink/10 w-full">
            <LogOut size={17} /> Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <StorageWarning className="mb-6" />
        {children}
      </main>
    </div>
  );
}
