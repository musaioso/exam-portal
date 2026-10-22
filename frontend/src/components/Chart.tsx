import React from "react";
import { cn } from "./ui";

/**
 * Lightweight SVG pie / donut chart — zero dependencies, theme-aware.
 *
 * Colors come from the site's CSS variables (indigo, cyan, emerald, amber,
 * rose, slate) so the chart follows light/dark mode automatically. Each slice
 * can carry a label; a legend is rendered below.
 *
 * Usage:
 *   <PieChart data={[{ label: "MCQ", value: 12, color: "indigo" }, ...]} />
 *   <DonutChart data={...} centerLabel="42" centerSub="questions" />
 */

type Tone =
  | "indigo" | "cyan" | "emerald" | "amber" | "rose" | "slate" | "violet" | "fuchsia";

const TONE_VAR: Record<Tone, string> = {
  indigo: "var(--color-indigo-500)",
  cyan: "var(--color-cyan-400)",
  emerald: "var(--color-emerald-500)",
  amber: "var(--color-amber-500)",
  rose: "var(--color-rose-500)",
  slate: "var(--color-slate-500)",
  violet: "var(--color-violet-500)",
  fuchsia: "var(--color-fuchsia-500)",
};

export interface ChartDatum {
  label: string;
  value: number;
  tone?: Tone;
  color?: string;
}

interface ChartProps {
  data: ChartDatum[];
  size?: number;
  /** Donut hole radius as a fraction of the outer radius (0 = pie). */
  hole?: number;
  /** Text shown in the donut hole. */
  centerLabel?: string;
  centerSub?: string;
  className?: string;
  /** Show percentage in legend. */
  showPct?: boolean;
  emptyText?: string;
}

const TONES: Tone[] = ["indigo", "cyan", "emerald", "amber", "rose", "violet", "fuchsia", "slate"];

function sliceColor(d: ChartDatum, i: number): string {
  if (d.color) return d.color;
  const tone = d.tone || TONES[i % TONES.length];
  return TONE_VAR[tone];
}

export function PieChart(props: ChartProps) {
  return <Chart {...props} hole={0} />;
}

export function DonutChart(props: ChartProps) {
  return <Chart {...props} hole={props.hole ?? 0.55} />;
}

function Chart({
  data,
  size = 140,
  hole = 0,
  centerLabel,
  centerSub,
  className,
  showPct = true,
  emptyText = "No data yet",
}: ChartProps) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const filtered = data.filter((d) => (Number(d.value) || 0) > 0);

  if (total <= 0 || filtered.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 text-center text-xs text-slate-500", className)} style={{ minHeight: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 4} fill="none" stroke="var(--color-slate-700)" strokeWidth={2} strokeDasharray="4 4" opacity={0.5} />
        </svg>
        <span>{emptyText}</span>
      </div>
    );
  }

  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = r * hole;

  // Build slice paths.
  let angle = -Math.PI / 2; // start at top
  const slices = filtered.map((d, i) => {
    const frac = (Number(d.value) || 0) / total;
    const sliceAngle = frac * Math.PI * 2;
    const endAngle = angle + sliceAngle;
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    let path: string;
    if (innerR > 0) {
      const ix1 = cx + innerR * Math.cos(endAngle);
      const iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(angle);
      const iy2 = cy + innerR * Math.sin(angle);
      path = [
        `M ${x1} ${y1}`,
        `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${ix1} ${iy1}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2}`,
        "Z",
      ].join(" ");
    } else {
      path = [`M ${cx} ${cy}`, `L ${x1} ${y1}`, `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`, "Z"].join(" ");
    }

    const midAngle = angle + sliceAngle / 2;
    const result = { d, path, color: sliceColor(d, i), frac, midAngle, i };
    angle = endAngle;
    return result;
  });

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {slices.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill={s.color}
            stroke="var(--page-bg, transparent)"
            strokeWidth={1.5}
            className="transition-opacity duration-300 hover:opacity-80"
            style={{ transformOrigin: `${cx}px ${cy}px`, animation: `pieIn 0.6s ease-out ${i * 0.05}s both` }}
          />
        ))}
        {innerR > 0 && (centerLabel || centerSub) && (
          <text x={cx} y={cy - (centerSub ? 4 : 0)} textAnchor="middle" dominantBaseline="middle" className="fill-slate-100 text-lg font-bold" style={{ fill: "var(--text)" }}>
            {centerLabel}
          </text>
        )}
        {innerR > 0 && centerSub && (
          <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle" style={{ fill: "var(--muted)", fontSize: "10px" }}>
            {centerSub}
          </text>
        )}
      </svg>
      <style>{`@keyframes pieIn { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
      <ul className="w-full space-y-1.5 text-xs">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="min-w-0 flex-1 truncate text-slate-300">{s.d.label}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {s.d.value}
              {showPct && <span className="ml-1 text-slate-500">({Math.round(s.frac * 100)}%)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
