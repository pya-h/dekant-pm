"use client";

import { useId, useMemo } from "react";
import {
  MarketType,
  type MarketSummary,
  computeProbabilities,
} from "@/lib/types";

interface MiniChartProps {
  market: MarketSummary;
  height?: number;
}

const VIEW_W = 200;
const PAD = { top: 4, right: 4, bottom: 4, left: 4 };

export function MiniChart({ market, height = 60 }: MiniChartProps) {
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
    market.kSquared,
  );

  if (probabilities.length === 0) return null;

  if (market.marketType === MarketType.Continuous) {
    return <ContinuousMiniChart probabilities={probabilities} height={height} />;
  }

  if (market.marketType === MarketType.Binary && probabilities.length >= 2) {
    return <BinaryMiniChart probabilities={probabilities} height={height} />;
  }

  return <MultiMiniChart probabilities={probabilities} height={height} />;
}

function ContinuousMiniChart({
  probabilities,
  height,
}: {
  probabilities: number[];
  height: number;
}) {
  const gradientId = useId();
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

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

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} className="w-full h-auto">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(6 182 212)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="rgb(6 182 212)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <polyline
        points={linePath}
        fill="none"
        stroke="rgb(6 182 212)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
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
      {/* Background */}
      <rect x={PAD.left} y={y} width={VIEW_W - PAD.left - PAD.right} height={barH} rx={3} fill="rgb(63 63 70)" fillOpacity={0.5} />
      {/* Yes portion */}
      <rect
        x={PAD.left}
        y={y}
        width={Math.max((VIEW_W - PAD.left - PAD.right) * yesP, 2)}
        height={barH}
        rx={3}
        fill="rgb(52 211 153)"
      />
      {/* Labels */}
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
