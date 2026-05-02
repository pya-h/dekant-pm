"use client";

import { useId, useMemo } from "react";
import {
  MarketType,
  SCALE,
  type MarketSummary,
  computeProbabilities,
} from "@/lib/types";

interface MiniChartProps {
  market: MarketSummary;
  height?: number;
  showAxes?: boolean;
}

const VIEW_W = 200;
const PAD = { top: 2, right: 2, bottom: 2, left: 2 };
const AXES_PAD = { top: 4, right: 14, bottom: 16, left: 14 };

export function MiniChart({ market, height = 60, showAxes = false }: MiniChartProps) {
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
    market.kSquared,
  );

  if (probabilities.length === 0) return null;

  if (market.marketType === MarketType.Continuous) {
    return (
      <ContinuousMiniChart
        probabilities={probabilities}
        height={height}
        showAxes={showAxes}
        rangeMin={market.rangeMin != null ? Number(market.rangeMin) / SCALE : null}
        rangeMax={market.rangeMax != null ? Number(market.rangeMax) / SCALE : null}
      />
    );
  }

  if (market.marketType === MarketType.Binary && probabilities.length >= 2) {
    return <BinaryMiniChart probabilities={probabilities} height={height} />;
  }

  return <MultiMiniChart probabilities={probabilities} height={height} />;
}

function ContinuousMiniChart({
  probabilities,
  height,
  showAxes,
  rangeMin,
  rangeMax,
}: {
  probabilities: number[];
  height: number;
  showAxes: boolean;
  rangeMin: number | null;
  rangeMax: number | null;
}) {
  const gradientId = useId();
  const pad = showAxes ? AXES_PAD : PAD;
  const plotW = VIEW_W - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseline = pad.top + plotH;

  const { areaPath, linePath } = useMemo(() => {
    const maxP = Math.max(...probabilities, 0.001);
    const barW = plotW / probabilities.length;

    const pts = probabilities.map((p, i) => ({
      x: pad.left + barW * (i + 0.5),
      y: pad.top + plotH * (1 - p / maxP),
    }));

    let area = `M ${pts[0].x} ${baseline}`;
    for (const pt of pts) area += ` L ${pt.x} ${pt.y}`;
    area += ` L ${pts[pts.length - 1].x} ${baseline} Z`;

    const line = pts.map((pt) => `${pt.x},${pt.y}`).join(" ");

    return { areaPath: area, linePath: line };
  }, [probabilities, plotW, plotH, pad, baseline]);

  // X-axis ticks — same format as DistributionChart
  const xTicks = useMemo(() => {
    if (!showAxes || rangeMin == null || rangeMax == null) return [];
    const count = 5;
    const ticks: { label: string; x: number }[] = [];
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1);
      const value = rangeMin + (rangeMax - rangeMin) * frac;
      ticks.push({ label: formatTickValue(value), x: pad.left + plotW * frac });
    }
    return ticks;
  }, [showAxes, rangeMin, rangeMax, pad.left, plotW]);

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} className="w-full h-auto">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(6 182 212)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="rgb(6 182 212)" stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Subtle grid lines — matching DistributionChart */}
      {showAxes && [0.25, 0.5, 0.75].map((frac) => (
        <line
          key={frac}
          x1={pad.left}
          x2={VIEW_W - pad.right}
          y1={pad.top + plotH * (1 - frac)}
          y2={pad.top + plotH * (1 - frac)}
          stroke="currentColor"
          strokeOpacity={0.06}
          strokeWidth={0.5}
        />
      ))}

      {/* Baseline */}
      {showAxes && (
        <line
          x1={pad.left}
          x2={VIEW_W - pad.right}
          y1={baseline}
          y2={baseline}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={0.5}
        />
      )}

      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={linePath}
        fill="none"
        stroke="rgb(6 182 212)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* X-axis labels — same formatTickValue as DistributionChart */}
      {xTicks.map((tick, i) => (
        <text
          key={i}
          x={tick.x}
          y={height - 2}
          fontSize={7}
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          {tick.label}
        </text>
      ))}
    </svg>
  );
}

function BinaryMiniChart({
  probabilities,
  height,
}: {
  probabilities: number[];
  height: number;
}) {
  const yesP = probabilities[0];
  const noP = 1 - yesP;
  const barH = 6;
  const y = (height - barH) / 2;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} className="w-full h-auto">
      <rect x={PAD.left} y={y} width={VIEW_W - PAD.left - PAD.right} height={barH} rx={3} fill="rgb(63 63 70)" fillOpacity={0.5} />
      <rect
        x={PAD.left}
        y={y}
        width={Math.max((VIEW_W - PAD.left - PAD.right) * yesP, 2)}
        height={barH}
        rx={3}
        fill="rgb(52 211 153)"
      />
      <text x={PAD.left} y={y - 4} fontSize={9} fill="rgb(52 211 153)" className="font-medium">
        Yes {(yesP * 100).toFixed(0)}%
      </text>
      <text x={VIEW_W - PAD.right} y={y - 4} fontSize={9} fill="rgb(161 161 170)" textAnchor="end">
        No {(noP * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

function MultiMiniChart({
  probabilities,
  height,
}: {
  probabilities: number[];
  height: number;
}) {
  const gradientId = useId();
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const colors = [
    "rgb(139 92 246)",
    "rgb(6 182 212)",
    "rgb(52 211 153)",
    "rgb(251 191 36)",
    "rgb(244 63 94)",
    "rgb(168 85 247)",
    "rgb(59 130 246)",
    "rgb(249 115 22)",
  ];

  const { areaPath, linePath } = useMemo(() => {
    const maxP = Math.max(...probabilities, 0.001);
    const barW = plotW / probabilities.length;
    const baseline = PAD.top + plotH;

    const pts = probabilities.map((p, i) => ({
      x: PAD.left + barW * (i + 0.5),
      y: PAD.top + plotH * (1 - p / maxP),
    }));

    let area = `M ${pts[0].x} ${baseline}`;
    for (const pt of pts) area += ` L ${pt.x} ${pt.y}`;
    area += ` L ${pts[pts.length - 1].x} ${baseline} Z`;

    const line = pts.map((pt) => `${pt.x},${pt.y}`).join(" ");

    return { areaPath: area, linePath: line };
  }, [probabilities, plotW, plotH]);

  const topColor = colors[probabilities.indexOf(Math.max(...probabilities)) % colors.length];

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} className="w-full h-auto">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={topColor} stopOpacity={0.3} />
          <stop offset="100%" stopColor={topColor} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={linePath}
        fill="none"
        stroke={topColor}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Same formatting as DistributionChart.formatTickValue */
function formatTickValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
