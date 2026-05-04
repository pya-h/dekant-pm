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

const CHART_PADDING = { top: 16, right: 24, bottom: 32, left: 48 };
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
  const [smooth, setSmooth] = useState(true);
  const [yUnit, setYUnit] = useState<"pct" | "price">("pct");

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

  // Paths (smooth vs segmented)
  const marketAreaPath = useMemo(
    () => smooth ? buildSmoothAreaPath(marketPoints, baseline) : buildAreaPath(marketPoints, baseline),
    [marketPoints, baseline, smooth],
  );
  const marketLinePath = useMemo(
    () => smooth ? buildSmoothLinePath(marketPoints) : buildPolylinePath(marketPoints),
    [marketPoints, smooth],
  );
  const traderAreaPath = useMemo(
    () => smooth ? buildSmoothAreaPath(traderPoints, baseline) : buildAreaPath(traderPoints, baseline),
    [traderPoints, baseline, smooth],
  );
  const traderLinePath = useMemo(
    () => smooth ? buildSmoothLinePath(traderPoints) : buildPolylinePath(traderPoints),
    [traderPoints, smooth],
  );

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

  return (
    <div className="relative w-full">
      {/* Y-axis unit toggle (left corner) */}
      <button
        type="button"
        onClick={() => setYUnit((u) => u === "pct" ? "price" : "pct")}
        className="absolute left-1 top-1 z-10 cursor-pointer rounded-md border border-border/40 bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
        title={yUnit === "pct" ? "Switch to price" : "Switch to percentage"}
      >
        {yUnit === "pct" ? "%" : "$"}
      </button>
      {/* Smooth/Real toggle (right corner) */}
      <button
        type="button"
        onClick={() => setSmooth((s) => !s)}
        className="absolute right-1 top-1 z-10 cursor-pointer rounded-md border border-border/40 bg-background/80 px-1.5 py-0.5 backdrop-blur-sm transition-colors hover:text-foreground"
        title={smooth ? "Switch to segmented (real bins)" : "Switch to smooth curve"}
      >
        <svg width="16" height="10" viewBox="0 0 16 10" className="text-muted-foreground">
          {smooth ? (
            <path d="M1 8 L4 6 L7 2 L10 4 L13 3 L15 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          ) : (
            <path d="M1 8 C3 8 4 2 8 2 C12 2 13 6 15 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          )}
        </svg>
      </button>
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
              {yUnit === "pct" ? formatPct(maxP * frac) : formatPrice(maxP * frac)}
            </text>
          </g>
        ))}

        {/* Market distribution — cyan filled area */}
        <path d={marketAreaPath} fill={`url(#${gradientMarketId})`} />
        <path
          d={marketLinePath}
          fill="none"
          stroke="rgb(6 182 212)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* User distribution — blue filled area (only when mu is set) */}
        {mu !== null && traderPoints.length > 0 && (
          <>
            <path d={traderAreaPath} fill={`url(#${gradientUserId})`} />
            <path
              d={traderLinePath}
              fill="none"
              stroke="rgb(59 130 246)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
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

        {/* "Drag handles to adjust spread" hint */}
        {mu !== null && muX != null && (
          <text
            x={muX} y={baseline - 8}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={9} opacity={0.5}
          >
            Drag handles to adjust spread
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

function buildPolylinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return "M " + points.map((pt) => `${pt.x} ${pt.y}`).join(" L ");
}

/** Catmull-Rom spline → cubic Bezier SVG path (smooth line through all points) */
function buildSmoothLinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to cubic Bezier control points (tension = 0, alpha = 0.5 uniform)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Smooth filled area path (smooth top edge, straight baseline) */
function buildSmoothAreaPath(points: { x: number; y: number }[], baseline: number): string {
  if (points.length === 0) return "";
  const linePath = buildSmoothLinePath(points);
  return `${linePath} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

function formatChartValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function formatPct(p: number): string {
  const pct = p * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

function formatPrice(p: number): string {
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(3)}`;
  return `$${p.toFixed(4)}`;
}
