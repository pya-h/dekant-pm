"use client";

import { useId, useMemo, useState } from "react";
import { formatChartValue as formatTickValue, formatPct } from "@/lib/chart-format";

interface DistributionChartProps {
  probabilities: number[];
  rangeMin: number;
  rangeMax: number;
  numBins: number;
  /** Resolved value marker (if market is resolved) */
  resolvedValue?: number | null;
  height?: number;
}

const CHART_PADDING = { top: 12, right: 20, bottom: 28, left: 44 };
const VIEW_W = 600;
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
  const gradientId = useId();

  const binWidth = (rangeMax - rangeMin) / numBins;
  const plotW = VIEW_W - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const { maxP, points, areaPath, barW } = useMemo(() => {
    const max = Math.max(...probabilities, 0.001);
    const bw = plotW / numBins;

    const pts = probabilities.map((p, i) => ({
      x: CHART_PADDING.left + bw * (i + 0.5),
      y: CHART_PADDING.top + plotH * (1 - p / max),
      p,
      binStart: rangeMin + binWidth * i,
      binEnd: rangeMin + binWidth * (i + 1),
    }));

    const baseline = CHART_PADDING.top + plotH;
    let path = `M ${pts[0].x} ${baseline}`;
    for (const pt of pts) {
      path += ` L ${pt.x} ${pt.y}`;
    }
    path += ` L ${pts[pts.length - 1].x} ${baseline} Z`;

    return { maxP: max, points: pts, areaPath: path, barW: bw };
  }, [probabilities, numBins, rangeMin, binWidth, plotW, plotH]);

  // X-axis tick labels (5 evenly spaced)
  const tickCount = Math.min(5, numBins);
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const frac = i / (tickCount - 1);
    const value = rangeMin + frac * (rangeMax - rangeMin);
    return { value, x: CHART_PADDING.left + frac * plotW };
  });

  // Resolved value marker position
  const resolvedX =
    resolvedValue != null
      ? CHART_PADDING.left +
        ((resolvedValue - rangeMin) / (rangeMax - rangeMin)) * plotW
      : null;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} className="w-full h-auto">
        {/* Grid lines + Y-axis labels */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <g key={frac}>
            <line
              x1={CHART_PADDING.left}
              x2={VIEW_W - CHART_PADDING.right}
              y1={CHART_PADDING.top + plotH * (1 - frac)}
              y2={CHART_PADDING.top + plotH * (1 - frac)}
              stroke="currentColor"
              strokeOpacity={0.06}
              strokeWidth={0.5}
            />
            <text
              x={CHART_PADDING.left - 6}
              y={CHART_PADDING.top + plotH * (1 - frac) + 3.5}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {formatPct(maxP * frac)}
            </text>
          </g>
        ))}

        {/* Filled area */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Line on top of area */}
        <polyline
          points={points.map((pt) => `${pt.x},${pt.y}`).join(" ")}
          fill="none"
          stroke="rgb(6 182 212)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Hover bars (invisible, for tooltip triggers) */}
        {points.map((pt, i) => (
          <rect
            key={i}
            x={pt.x - barW / 2}
            y={CHART_PADDING.top}
            width={barW}
            height={plotH}
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
            y2={CHART_PADDING.top + plotH}
            stroke="rgb(6 182 212)"
            strokeOpacity={0.4}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}

        {/* Resolved value marker */}
        {resolvedX != null && (
          <>
            <line
              x1={resolvedX}
              x2={resolvedX}
              y1={CHART_PADDING.top}
              y2={CHART_PADDING.top + plotH}
              stroke="rgb(34 197 94)"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
            <circle
              cx={resolvedX}
              cy={CHART_PADDING.top + 6}
              r={4}
              fill="rgb(34 197 94)"
            />
          </>
        )}

        {/* X-axis labels */}
        {ticks.map(({ value, x }, i) => (
          <text
            key={i}
            x={x}
            y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={11}
          >
            {formatTickValue(value)}
          </text>
        ))}

        {/* Baseline */}
        <line
          x1={CHART_PADDING.left}
          x2={VIEW_W - CHART_PADDING.right}
          y1={CHART_PADDING.top + plotH}
          y2={CHART_PADDING.top + plotH}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={0.5}
        />

        {/* Gradient definition */}
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(6 182 212)" stopOpacity={0.35} />
            <stop
              offset="100%"
              stopColor="rgb(6 182 212)"
              stopOpacity={0.05}
            />
          </linearGradient>
        </defs>
      </svg>

      {/* Tooltip overlay */}
      {hoveredBin !== null && (
        <div
          className="pointer-events-none absolute rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${(points[hoveredBin].x / VIEW_W) * 100}%`,
            top: `${(points[hoveredBin].y / height) * 100}%`,
            transform: "translate(-50%, -120%)",
          }}
        >
          <div className="text-muted-foreground">
            {formatTickValue(points[hoveredBin].binStart)}–
            {formatTickValue(points[hoveredBin].binEnd)}
          </div>
          <div className="font-medium text-foreground">
            {(points[hoveredBin].p * 100).toFixed(2)}%
          </div>
        </div>
      )}
    </div>
  );
}

