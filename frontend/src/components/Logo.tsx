import { cn } from "./ui";

export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 48 48"
        className="h-10 w-10 shrink-0"
      >
        <defs>
          <linearGradient id="logo-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#12b981" />
            <stop offset="1" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="24" fill="url(#logo-grad)" />
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
      {showText && (
        <div>
          <div className="text-lg font-semibold leading-tight">MCQ Studio</div>
          <div className="text-xs text-slate-400">NCTB 2025 · English Version</div>
        </div>
      )}
    </div>
  );
}
