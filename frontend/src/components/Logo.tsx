import { useId } from "react";
import { Link } from "react-router-dom";
import { cn } from "./ui";

/**
 * The MCQ Studio mark — a rounded-square app icon: an open question book with
 * a "verified" check badge, on the brand green→teal gradient. Single source of
 * truth for the auth pages, the sidebar and anywhere else the brand shows up.
 *
 * `size` only sets sensible defaults; pass `iconClassName` / className to tweak.
 *
 * `to` makes the whole logo a link (used by the sidebar, mobile header and
 * auth pages so the brand mark is always a "home" affordance).
 */
export function Logo({
  className,
  iconClassName,
  showText = true,
  size = "md",
  to,
  textClassName,
}: {
  className?: string;
  /** Override the mark's box size, e.g. "h-12 w-12". */
  iconClassName?: string;
  showText?: boolean;
  size?: "lg" | "md" | "sm";
  /** When set, the logo becomes a clickable link to this path. */
  to?: string;
  /** Extra classes for the wordmark (used to fade/slide it with the sidebar). */
  textClassName?: string;
}) {
  // React ids can contain ":" which breaks url(#…) references — strip them.
  const uid = useId().replace(/:/g, "");
  const gid = `mcq-logo-${uid}`;
  const text = {
    lg: { name: "text-lg", sub: "text-xs" },
    md: { name: "text-sm", sub: "text-[10px]" },
    sm: { name: "text-base", sub: "text-xs" },
  }[size];

  const inner = (
    <div className={cn("flex items-center gap-3", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 96 96"
        role="img"
        aria-label="MCQ Studio logo"
        className={cn(
          size === "lg" ? "h-12 w-12" : size === "sm" ? "h-10 w-10" : "h-9 w-9",
          "shrink-0 transition-[width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          iconClassName
        )}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
            <stop stopColor="#10b981" />
            <stop offset={1} stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        <rect width="96" height="96" rx="26" fill={`url(#${gid})`} />
        {/* Open question book */}
        <path
          d="M22 66V32c0-4.4 3.6-8 8-8h18c4.4 0 8 3.6 8 8v34l-17-8.5L22 66z"
          fill="#ffffff"
          opacity="0.96"
        />
        <path
          d="M32 34h14M32 42h10"
          stroke="#059669"
          strokeWidth="3.2"
          strokeLinecap="round"
          opacity="0.75"
        />
        {/* Verified badge */}
        <circle cx="66" cy="64" r="14" fill="#065f46" />
        <path
          d="M60 64.5l4 4 8.5-9"
          stroke="#ffffff"
          strokeWidth="3.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && (
        <div className={cn(
          "min-w-0 overflow-hidden whitespace-nowrap transition-[opacity,max-width,margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          textClassName
        )}>
          <div className={cn("font-semibold leading-tight", text.name)}>MCQ Studio</div>
          <div className={cn("text-slate-400", text.sub)}>NCTB 2025 · English Version</div>
        </div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="inline-flex cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 rounded-xl"
        aria-label="Go to dashboard"
      >
        {inner}
      </Link>
    );
  }
  return inner;
}