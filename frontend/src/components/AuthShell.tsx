import { ThemeToggle } from "./ThemeToggle";
import { ListChecks, Printer, Sparkles } from "lucide-react";

/**
 * Everything the sign-in and sign-up pages share: the brand story on the left
 * (hidden on phones) and the panel on the right where the form goes.
 */
const FEATURES = [
  {
    icon: Sparkles,
    title: "Build a paper in minutes",
    text: "Choose a subject and how many MCQs, short and long questions you want — the paper assembles itself.",
  },
  {
    icon: ListChecks,
    title: "Marks come back to you",
    text: "MCQs are marked the moment a student submits; written answers wait in one grading queue.",
  },
  {
    icon: Printer,
    title: "Print-ready NCTB layout",
    text: "One click gives a clean question paper — Bangla and English, ready for the photocopier.",
  },
];

export function AuthShell({ title, subtitle, top, children }: {
  title: string;
  subtitle: string;
  /** Rendered above the heading — the student / staff switch on the sign-in page. */
  top?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle compact />
      </div>

      <div className="glass grid w-full max-w-4xl overflow-hidden lg:grid-cols-2">
        {/* Brand story — desktop only, so the form keeps the whole phone screen. */}
        <aside className="relative hidden flex-col justify-between gap-10 overflow-hidden border-r border-slate-600/40 p-8 lg:flex">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/15 via-cyan-400/10 to-transparent" />

          <div className="relative flex items-center gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 48 48"
              className="h-12 w-12 shrink-0 drop-shadow-lg"
            >
              <defs>
                <linearGradient id="logo-grad-auth" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#12b981" />
                  <stop offset="1" stopColor="#2dd4bf" />
                </linearGradient>
              </defs>
              <circle cx="24" cy="24" r="24" fill="url(#logo-grad-auth)" />
              <path
                d="M14 32V16c0-2.2 1.8-4 4-4h12c2.2 0 4 1.8 4 4v16l-8-4-8 4z"
                fill="white"
                opacity="0.95"
              />
              <path
                d="M18 20h12M18 24h8"
                stroke="#059669"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.8"
              />
              <circle cx="32" cy="32" r="6" fill="#34d399" />
              <path
                d="M30 32l1.5 1.5 2.5-2.5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <div className="text-lg font-semibold leading-tight">MCQ Studio</div>
              <div className="text-xs text-slate-400">NCTB 2025 · English Version</div>
            </div>
          </div>

          <div className="relative space-y-6">
            <h2 className="text-3xl font-semibold leading-snug">
              Question papers,
              <br />
              made effortless.
            </h2>
            <ul className="space-y-4">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-indigo-500/25 bg-indigo-500/15 text-indigo-300">
                    <f.icon size={15} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-100">{f.title}</div>
                    <p className="text-xs leading-relaxed text-slate-400">{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-[11px] text-slate-500">
            A classroom tool for Bangladesh — Bangla &amp; English.
          </p>
        </aside>

        {/* Form panel */}
        <div className="p-5 sm:p-8">
          <div className="mb-5 flex items-center gap-3 lg:hidden">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 48 48"
              className="h-10 w-10 shrink-0 drop-shadow-lg"
            >
              <defs>
                <linearGradient id="logo-grad-auth-m" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#12b981" />
                  <stop offset="1" stopColor="#2dd4bf" />
                </linearGradient>
              </defs>
              <circle cx="24" cy="24" r="24" fill="url(#logo-grad-auth-m)" />
              <path
                d="M14 32V16c0-2.2 1.8-4 4-4h12c2.2 0 4 1.8 4 4v16l-8-4-8 4z"
                fill="white"
                opacity="0.95"
              />
              <path
                d="M18 20h12M18 24h8"
                stroke="#059669"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.8"
              />
              <circle cx="32" cy="32" r="6" fill="#34d399" />
              <path
                d="M30 32l1.5 1.5 2.5-2.5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <div className="font-semibold leading-tight">MCQ Studio</div>
              <div className="text-xs text-slate-400">NCTB 2025 · English Version</div>
            </div>
          </div>

          {top && <div className="mb-5">{top}</div>}

          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>

          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Field label for the auth pages. The 1rem left padding lines the label up with
 * the text inside the control below it, which otherwise sits 16px further right.
 */
export function AuthField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block pl-4 text-xs font-medium tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}
