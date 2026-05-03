"use client";

import { useRef, useId, useMemo, useCallback, useState, useEffect } from "react";
import { computeBinWeights, sliderToSigma, sigmaToSlider } from "@/lib/normal";
import { computeProbabilities, SCALE, type MarketDetail } from "@/lib/types";

interface InteractiveDistributionChartProps {
  market: MarketDetail;
  /** Current user prediction center (null = not set yet) */
  mu: number | null;
  /** Current sigma (distribution width) */
  sigma: number;
  onMuChange: (mu: number) => void;
  onSigmaChange: (sigma: number) => void;
  height?: number;
}

const CHART_PADDING = { top: 16, right: 24, bottom: 32, left: 24 };
const VIEW_W = 700;
const DEFAULT_HEIGHT = 300;
const HANDLE_RADIUS = 6;

export function InteractiveDistributionChart({
  market,
  mu,
  sigma,
  onMuChange,
  onSigmaChange,
  height = DEFAULT_HEIGHT,
}: InteractiveDistributionChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientMarketId = useId();
  const gradientUserId = useId();
  const [dragMode, setDragMode] = useState<"none" | "mu" | "sigma-left" | "sigma-right">("none");

  const rangeMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
  const rangeMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;
  const rangeWidth = rangeMax - rangeMin;
  const numBins = market.numOutcomes;

  const plotW = VIEW_W - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = height - CHART_PADDING.top - CHART_PADDING.bottom;
  const baseline = CHART_PADDING.top + plotH;

  // Minimum sigma: 1% of range
  const minSigma = rangeWidth * 0.01;

  const marketProbabilities = useMemo(
    () => computeProbabilities(market.reserves, market.totalMinted, market.kSquared),
    [market.reserves, market.totalMinted, market.kSquared],
  );

  const traderWeights = useMemo(
    () => mu !== null ? computeBinWeights(rangeMin, rangeMax, numBins, mu, sigma) : [],
    [rangeMin, rangeMax, numBins, mu, sigma],
  );

  const barW = plotW / numBins;
  const maxP = useMemo(() => {
    const vals = [...marketProbabilities, ...traderWeights];
    return Math.max(...vals, 0.001);
  }, [marketProbabilities, traderWeights]);

  const marketPoints = useMemo(
    () => marketProbabilities.map((p, i) => ({
      x: CHART_PADDING.left + barW * (i + 0.5),
      y: CHART_PADDING.top + plotH * (1 - p / maxP),
    })),
    [marketProbabilities, barW, plotH, maxP],
  );

  const traderPoints = useMemo(
    () => traderWeights.map((w, i) => ({
      x: CHART_PADDING.left + barW * (i + 0.5),
      y: CHART_PADDING.top + plotH * (1 - w / maxP),
    })),
    [traderWeights, barW, plotH, maxP],
  );

  // Paths
  const marketAreaPath = useMemo(() => buildAreaPath(marketPoints, baseline), [marketPoints, baseline]);
  const marketLine = useMemo(() => marketPoints.map((pt) => `${pt.x},${pt.y}`).join(" "), [marketPoints]);
  const traderAreaPath = useMemo(() => buildAreaPath(traderPoints, baseline), [traderPoints, baseline]);
  const traderLine = useMemo(() => traderPoints.map((pt) => `${pt.x},${pt.y}`).join(" "), [traderPoints]);

  // X-axis ticks (5 evenly spaced)
  const tickCount = Math.min(5, numBins);
  const ticks = useMemo(
    () => Array.from({ length: tickCount }, (_, i) => {
      const frac = i / (tickCount - 1);
      const value = rangeMin + frac * rangeWidth;
      return { value, x: CHART_PADDING.left + frac * plotW };
    }),
    [tickCount, rangeMin, rangeWidth, plotW],
  );

  // Convert client X to range value
  const clientXToValue = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg) return rangeMin;
      const rect = svg.getBoundingClientRect();
      const svgX = ((clientX - rect.left) / rect.width) * VIEW_W;
      const plotX = svgX - CHART_PADDING.left;
      const frac = Math.max(0, Math.min(1, plotX / plotW));
      return rangeMin + frac * rangeWidth;
    },
    [rangeMin, rangeWidth, plotW],
  );

  // Convert range value to SVG X
  const valueToX = useCallback(
    (v: number) => {
      const frac = Math.max(0, Math.min(1, (v - rangeMin) / rangeWidth));
      return CHART_PADDING.left + frac * plotW;
    },
    [rangeMin, rangeWidth, plotW],
  );

  // Sigma handle threshold for hit detection (in range units)
  const handleThreshold = rangeWidth * 0.025;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const value = clientXToValue(e.clientX);
      (e.target as Element).setPointerCapture?.(e.pointerId);

      if (mu !== null) {
        const leftBound = mu - sigma;
        const rightBound = mu + sigma;
        if (Math.abs(value - leftBound) < handleThreshold) {
          setDragMode("sigma-left");
          return;
        }
        if (Math.abs(value - rightBound) < handleThreshold) {
          setDragMode("sigma-right");
          return;
        }
      }

      // Click sets mu
      const clamped = Math.max(rangeMin, Math.min(rangeMax, value));
      onMuChange(clamped);
      setDragMode("mu");
    },
    [clientXToValue, mu, sigma, handleThreshold, rangeMin, rangeMax, onMuChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragMode === "none") return;
      const value = clientXToValue(e.clientX);

      if (dragMode === "mu") {
        const clamped = Math.max(rangeMin, Math.min(rangeMax, value));
        onMuChange(clamped);
      } else if (dragMode === "sigma-left" && mu !== null) {
        const newSigma = Math.max(minSigma, mu - value);
        onSigmaChange(newSigma);
      } else if (dragMode === "sigma-right" && mu !== null) {
        const newSigma = Math.max(minSigma, value - mu);
        onSigmaChange(newSigma);
      }
    },
    [dragMode, clientXToValue, mu, rangeMin, rangeMax, minSigma, onMuChange, onSigmaChange],
  );

  const handlePointerUp = useCallback(() => {
    setDragMode("none");
  }, []);

  // Cursor style
  const [hoverCursor, setHoverCursor] = useState("crosshair");
  const handleHoverMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragMode !== "none") return;
      if (mu === null) { setHoverCursor("crosshair"); return; }
      const value = clientXToValue(e.clientX);
      const leftBound = mu - sigma;
      const rightBound = mu + sigma;
      if (Math.abs(value - leftBound) < handleThreshold || Math.abs(value - rightBound) < handleThreshold) {
        setHoverCursor("ew-resize");
      } else {
        setHoverCursor("crosshair");
      }
    },
    [dragMode, mu, sigma, handleThreshold, clientXToValue],
  );

  // Mu and sigma positions
  const muX = mu !== null ? valueToX(mu) : null;
  const leftBoundX = mu !== null ? valueToX(Math.max(rangeMin, mu - sigma)) : null;
  const rightBoundX = mu !== null ? valueToX(Math.min(rangeMax, mu + sigma)) : null;
  const leftBoundValue = mu !== null ? Math.max(rangeMin, mu - sigma) : null;
  const rightBoundValue = mu !== null ? Math.min(rangeMax, mu + sigma) : null;

  // Confidence percentage (for Normal distribution ±1σ ≈ 68.27%)
  const confidencePct = 68;

  return (
    <div className="relative w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="w-full h-auto select-none"
        style={{ cursor: dragMode !== "none" ? "grabbing" : hoverCursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => { handlePointerMove(e); handleHoverMove(e); }}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <defs>
          <linearGradient id={gradientMarketId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(6 182 212)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="rgb(6 182 212)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id={gradientUserId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={CHART_PADDING.left}
            x2={VIEW_W - CHART_PADDING.right}
            y1={CHART_PADDING.top + plotH * (1 - frac)}
            y2={CHART_PADDING.top + plotH * (1 - frac)}
            stroke="currentColor"
            strokeOpacity={0.06}
            strokeWidth={0.5}
          />
        ))}

        {/* Market distribution — cyan filled area */}
        <path d={marketAreaPath} fill={`url(#${gradientMarketId})`} />
        <polyline
          points={marketLine}
          fill="none"
          stroke="rgb(6 182 212)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* User distribution — blue filled area (only when mu is set) */}
        {mu !== null && traderPoints.length > 0 && (
          <>
            <path d={traderAreaPath} fill={`url(#${gradientUserId})`} />
            <polyline
              points={traderLine}
              fill="none"
              stroke="rgb(59 130 246)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </>
        )}

        {/* Sigma boundary lines */}
        {mu !== null && leftBoundX != null && rightBoundX != null && (
          <>
            <line
              x1={leftBoundX} x2={leftBoundX}
              y1={CHART_PADDING.top} y2={baseline}
              stroke="rgb(59 130 246)" strokeWidth={1}
              strokeDasharray="5 4" strokeOpacity={0.6}
            />
            <line
              x1={rightBoundX} x2={rightBoundX}
              y1={CHART_PADDING.top} y2={baseline}
              stroke="rgb(59 130 246)" strokeWidth={1}
              strokeDasharray="5 4" strokeOpacity={0.6}
            />

            {/* Drag handles (circles at sigma boundaries) */}
            <circle
              cx={leftBoundX} cy={baseline - plotH * 0.5}
              r={HANDLE_RADIUS}
              fill="rgb(59 130 246)" fillOpacity={0.3}
              stroke="rgb(59 130 246)" strokeWidth={1.5}
              className="pointer-events-none"
            />
            <circle
              cx={rightBoundX} cy={baseline - plotH * 0.5}
              r={HANDLE_RADIUS}
              fill="rgb(59 130 246)" fillOpacity={0.3}
              stroke="rgb(59 130 246)" strokeWidth={1.5}
              className="pointer-events-none"
            />

            {/* Sigma boundary value labels */}
            <text
              x={leftBoundX} y={baseline - plotH * 0.5 - 12}
              textAnchor="middle"
              className="fill-blue-400"
              fontSize={11} fontWeight={600}
            >
              {formatChartValue(leftBoundValue!)}
            </text>
            <text
              x={rightBoundX} y={baseline - plotH * 0.5 - 12}
              textAnchor="middle"
              className="fill-blue-400"
              fontSize={11} fontWeight={600}
            >
              {formatChartValue(rightBoundValue!)}
            </text>
          </>
        )}

        {/* Mu marker */}
        {mu !== null && muX != null && (
          <>
            <line
              x1={muX} x2={muX}
              y1={CHART_PADDING.top} y2={baseline}
              stroke="rgb(59 130 246)" strokeWidth={1.5}
              strokeDasharray="4 3" strokeOpacity={0.7}
            />
          </>
        )}

        {/* Confidence label */}
        {mu !== null && muX != null && (
          <g>
            <rect
              x={muX - 52} y={CHART_PADDING.top + 6}
              width={104} height={22}
              rx={6}
              fill="rgb(30 41 59)" fillOpacity={0.85}
              stroke="rgb(59 130 246)" strokeWidth={0.5} strokeOpacity={0.4}
            />
            <text
              x={muX} y={CHART_PADDING.top + 21}
              textAnchor="middle"
              fontSize={11} fontWeight={600}
            >
              <tspan className="fill-blue-400">{confidencePct}%</tspan>
              <tspan className="fill-muted-foreground"> Confidence</tspan>
            </text>
          </g>
        )}

        {/* "Drag to change confidence" hint */}
        {mu !== null && muX != null && (
          <text
            x={muX} y={baseline - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={9} opacity={0.5}
          >
            Drag handles to change confidence
          </text>
        )}

        {/* Baseline */}
        <line
          x1={CHART_PADDING.left}
          x2={VIEW_W - CHART_PADDING.right}
          y1={baseline} y2={baseline}
          stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.5}
        />

        {/* X-axis labels */}
        {ticks.map(({ value, x }, i) => (
          <text
            key={i}
            x={x} y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={11}
          >
            {formatChartValue(value)}
          </text>
        ))}

        {/* Click hint (only when no mu set) */}
        {mu === null && (
          <text
            x={VIEW_W / 2} y={height / 2}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={13} opacity={0.5}
          >
            Click on the chart to place your prediction
          </text>
        )}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-5 text-[11px] text-muted-foreground/70">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-cyan-500" />
          Market
        </span>
        {mu !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-blue-500" />
            Your prediction
          </span>
        )}
      </div>

      {/* Mu/Sigma display below chart */}
      {mu !== null && (
        <div className="mt-2 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span>
            Center: <span className="font-semibold text-foreground tabular-nums">{formatChartValue(mu)}</span>
          </span>
          <span>
            Spread (±1σ): <span className="font-semibold text-foreground tabular-nums">{formatChartValue(sigma)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function buildAreaPath(points: { x: number; y: number }[], baseline: number): string {
  if (points.length === 0) return "";
  let path = `M ${points[0].x} ${baseline}`;
  for (const pt of points) {
    path += ` L ${pt.x} ${pt.y}`;
  }
  path += ` L ${points[points.length - 1].x} ${baseline} Z`;
  return path;
}

function formatChartValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
