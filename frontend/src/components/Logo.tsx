import { useId } from "react";
import { cn } from "./ui";

/**
 * The MCQ Studio mark — a rounded-square app icon: an open question book with
 * a "verified" check badge, on the brand green→teal gradient. Single source of
 * truth for the auth pages, the sidebar and anywhere else the brand shows up.
 *
 * `size` only sets sensible defaults; pass `iconClassName` / className to tweak.
 */
export function Logo({
  className,
  iconClassName,
  showText = true,
  size = "md",
}: {
  className?: string;
  /** Override the mark's box size, e.g. "h-12 w-12". */
  iconClassName?: string;
  showText?: boolean;
  size?: "lg" | "md" | "sm";
}) {
  // React ids can contain ":" which breaks url(#…) references — strip them.
  const uid = useId().replace(/:/g, "");
  const gid = `mcq-logo-${uid}`;
  const text = {
    lg: { name: "text-lg", sub: "text-xs" },
    md: { name: "text-sm", sub: "text-[10px]" },
    sm: { name: "text-base", sub: "text-xs" },
  }[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 96 96"
        role="img"
        aria-label="MCQ Studio logo"
        className={cn(
          size === "lg" ? "h-12 w-12" : size === "sm" ? "h-10 w-10" : "h-9 w-9",
          "shrink-0",
          iconClassName
        )}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
            <stop stopColor="#10b981" />
            <stop offset="1" stopColor="#2dd4bf" />
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
        <div>
          <div className={cn("font-semibold leading-tight", text.name)}>MCQ Studio</div>
          <div className={cn("text-slate-400", text.sub)}>NCTB 2025 · English Version</div>
        </div>
      )}
    </div>
  );
}
