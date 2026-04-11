"use client";

import { useMemo, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DistributionChartProps {
  probabilities: number[];
  rangeMin: number;
  rangeMax: number;
  numBins: number;
  /** Resolved value marker (if market is resolved) */
  resolvedValue?: number | null;
  height?: number;
}

const CHART_PADDING = { top: 12, right: 16, bottom: 32, left: 16 };
const DEFAULT_HEIGHT = 200;

export function DistributionChart({
  probabilities,
  rangeMin,
  rangeMax,
  numBins,
  resolvedValue,
  height = DEFAULT_HEIGHT,
}: DistributionChartProps) {
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);

  const binWidth = (rangeMax - rangeMin) / numBins;

  const { maxP, points, areaPath } = useMemo(() => {
    const max = Math.max(...probabilities, 0.001); // avoid 0 divisor
    const chartW = 100; // percentage-based viewBox
    const chartH = height - CHART_PADDING.top - CHART_PADDING.bottom;
    const barW = chartW / numBins;

    // Build area path (smooth polygon) for filled area
    const pts = probabilities.map((p, i) => ({
      x: CHART_PADDING.left + barW * (i + 0.5),
      y: CHART_PADDING.top + chartH * (1 - p / max),
      p,
      binStart: rangeMin + binWidth * i,
      binEnd: rangeMin + binWidth * (i + 1),
    }));

    // Build SVG area path
    const baseline = CHART_PADDING.top + chartH;
    let path = `M ${pts[0].x} ${baseline}`;
    for (const pt of pts) {
      path += ` L ${pt.x} ${pt.y}`;
    }
    path += ` L ${pts[pts.length - 1].x} ${baseline} Z`;

    return { maxP: max, points: pts, areaPath: path };
  }, [probabilities, numBins, rangeMin, binWidth, height]);

  const chartW =
    100 - CHART_PADDING.left - CHART_PADDING.right + CHART_PADDING.left * 2;
  const chartH = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const barW = (100 - CHART_PADDING.left - CHART_PADDING.right + CHART_PADDING.left) / numBins;

  // X-axis tick labels (5 evenly spaced)
  const tickCount = Math.min(5, numBins);
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const frac = i / (tickCount - 1);
    const value = rangeMin + frac * (rangeMax - rangeMin);
    const x = CHART_PADDING.left + frac * (points[points.length - 1].x - points[0].x) + (1 - frac) * 0;
    return { value, x: points[Math.round(frac * (numBins - 1))].x };
  });

  // Resolved value marker position
  const resolvedX = resolvedValue != null
    ? CHART_PADDING.left +
      ((resolvedValue - rangeMin) / (rangeMax - rangeMin)) *
        (points[points.length - 1].x - points[0].x)
    : null;

  const viewBoxW = points[points.length - 1].x + CHART_PADDING.right;
  const viewBoxH = height;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height }}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={CHART_PADDING.left}
            x2={viewBoxW - CHART_PADDING.right}
            y1={CHART_PADDING.top + chartH * (1 - frac)}
            y2={CHART_PADDING.top + chartH * (1 - frac)}
            stroke="currentColor"
            strokeOpacity={0.06}
            strokeWidth={0.3}
          />
        ))}

        {/* Filled area */}
        <path
          d={areaPath}
          fill="url(#chartGradient)"
          strokeWidth={0}
        />

        {/* Line on top of area */}
        <polyline
          points={points.map((pt) => `${pt.x},${pt.y}`).join(" ")}
          fill="none"
          stroke="rgb(6 182 212)" // cyan-500
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Hover bars (invisible, for tooltip triggers) */}
        {points.map((pt, i) => (
          <rect
            key={i}
            x={pt.x - barW / 2}
            y={CHART_PADDING.top}
            width={barW}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoveredBin(i)}
            onMouseLeave={() => setHoveredBin(null)}
            className="cursor-crosshair"
          />
        ))}

        {/* Hovered bin highlight */}
        {hoveredBin !== null && (
          <line
            x1={points[hoveredBin].x}
            x2={points[hoveredBin].x}
            y1={CHART_PADDING.top}
            y2={CHART_PADDING.top + chartH}
            stroke="rgb(6 182 212)"
            strokeOpacity={0.4}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Resolved value marker */}
        {resolvedX != null && (
          <>
            <line
              x1={resolvedX}
              x2={resolvedX}
              y1={CHART_PADDING.top}
              y2={CHART_PADDING.top + chartH}
              stroke="rgb(34 197 94)" // green-500
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
            <circle
              cx={resolvedX}
              cy={CHART_PADDING.top + 6}
              r={3}
              fill="rgb(34 197 94)"
            />
          </>
        )}

        {/* X-axis labels */}
        {ticks.map(({ value, x }, i) => (
          <text
            key={i}
            x={x}
            y={viewBoxH - 4}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={8}
          >
            {formatTickValue(value)}
          </text>
        ))}

        {/* Baseline */}
        <line
          x1={CHART_PADDING.left}
          x2={viewBoxW - CHART_PADDING.right}
          y1={CHART_PADDING.top + chartH}
          y2={CHART_PADDING.top + chartH}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={0.5}
        />

        {/* Gradient definition */}
        <defs>
          <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(6 182 212)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(6 182 212)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
      </svg>

      {/* Tooltip overlay */}
      {hoveredBin !== null && (
        <div
          className="pointer-events-none absolute rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(points[hoveredBin].x / viewBoxW) * 100}%`,
            top: `${(points[hoveredBin].y / viewBoxH) * 100}%`,
            transform: "translate(-50%, -120%)",
          }}
        >
          <div className="text-muted-foreground">
            {formatTickValue(points[hoveredBin].binStart)}–{formatTickValue(points[hoveredBin].binEnd)}
          </div>
          <div className="font-medium text-foreground">
            {(points[hoveredBin].p * 100).toFixed(2)}%
          </div>
        </div>
      )}
    </div>
  );
}

function formatTickValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
