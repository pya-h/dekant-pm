"use client";

import { useRef, useId, useMemo, useCallback, useState, useEffect } from "react";
import { computeBinWeights } from "@/lib/normal";
import { computeProbabilities, SCALE, type MarketDetail } from "@/lib/types";
import { useLocalPrefs } from "@/lib/use-local-prefs";
import { formatChartValue, formatPct, formatPrice } from "@/lib/chart-format";

interface InteractiveDistributionChartProps {
  market: MarketDetail;
  /** Current user prediction center (null = not set yet) */
  mu: number | null;
  /** Current sigma (distribution width) */
  sigma: number;
  onMuChange: (mu: number) => void;
  onSigmaChange: (sigma: number) => void;
  /** User's existing position holdings per bin (raw token amounts). Normalized internally for display. */
  positionHoldings?: number[] | null;
  height?: number;
  /** When true, chart is non-interactive — shows position + market curves only (sell side) */
  readOnly?: boolean;
}

const CHART_PADDING = { top: 20, right: 24, bottom: 36, left: 54 };
const VIEW_W = 700;
const DEFAULT_HEIGHT = 300;
const HANDLE_RADIUS = 7;
const TICK_SIZE = 4;

// Curve colors as constants for consistency
const COLOR_MARKET = "rgb(120 130 150)";
const COLOR_TRADER = "rgb(59 130 246)";
const COLOR_POSITION = "rgb(190 175 55)";

export function InteractiveDistributionChart({
  market,
  mu,
  sigma,
  onMuChange,
  onSigmaChange,
  positionHoldings,
  height = DEFAULT_HEIGHT,
  readOnly = false,
}: InteractiveDistributionChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientMarketId = useId();
  const gradientUserId = useId();
  const gradientPositionId = useId();
  const sigmaFillId = useId();
  const clipId = useId();
  const [dragMode, setDragMode] = useState<"none" | "mu" | "sigma-left" | "sigma-right" | "y-scale">("none");
  const [hiddenCurves, setHiddenCurves] = useState<Set<"market" | "trader" | "position">>(new Set());
  const { prefs, setPref } = useLocalPrefs();
  const smooth = prefs.chartSmooth;
  const yUnit = prefs.chartYUnit;
  const dynamicScale = prefs.chartDynamicScale;

  // Y-axis manual scale override
  const [yScaleOverride, setYScaleOverride] = useState<number | null>(null);
  const yDragRef = useRef<{ startClientY: number; startMaxP: number } | null>(null);
  const [frozenMaxP, setFrozenMaxP] = useState<number | null>(null);

  // Frozen y-axis base for fixed mode (only user drag should change it)
  const [fixedYBase, setFixedYBase] = useState<number | null>(null);

  // Zoom state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Derived viewBox from zoom
  const vbW = VIEW_W / zoom;
  const vbH = height / zoom;
  const vbX = panOffset.x;
  const vbY = panOffset.y;

  // Ref for wheel handler to avoid stale closures
  const zoomStateRef = useRef({ zoom, vbX, vbY, vbW, vbH, height });
  useEffect(() => {
    zoomStateRef.current = { zoom, vbX, vbY, vbW, vbH, height };
  });

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

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

  // Normalize position holdings to sum=1 (same scale as probabilities)
  const positionWeights = useMemo(() => {
    if (!positionHoldings || positionHoldings.length === 0) return [];
    const sum = positionHoldings.reduce((a, b) => a + b, 0);
    if (sum <= 0) return [];
    return positionHoldings.map((h) => h / sum);
  }, [positionHoldings]);

  const computedMaxP = useMemo(() => {
    const marketMax = Math.max(...marketProbabilities, 0.001);
    const traderMax = traderWeights.length > 0 ? Math.max(...traderWeights) : 0;
    const posMax = positionWeights.length > 0 ? Math.max(...positionWeights) : 0;
    return Math.max(marketMax, traderMax, posMax, 0.001) * 1.15;
  }, [marketProbabilities, traderWeights, positionWeights]);

  // In fixed mode, freeze the y-axis base so only user drag changes it.
  // Uses rAF to avoid synchronous setState inside effect body.
  useEffect(() => {
    let raf: number;
    if (dynamicScale) {
      raf = requestAnimationFrame(() => setFixedYBase(null));
    } else if (fixedYBase === null) {
      raf = requestAnimationFrame(() => setFixedYBase(computedMaxP));
    }
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [dynamicScale, fixedYBase, computedMaxP]);

  // During mu drag in dynamic mode, freeze y-axis to prevent grid jitter.
  // frozenMaxP is set in handlePointerDown, cleared in handlePointerUp.
  const rawMaxP = yScaleOverride ?? (dynamicScale ? computedMaxP : (fixedYBase ?? computedMaxP));
  const maxP = frozenMaxP ?? rawMaxP;

  // Generate nice Y-axis ticks (e.g. 0%, 10%, 20%, … or 0%, 5%, 10%, …)
  const yTicks = useMemo(() => {
    const nice = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
    const target = maxP / 10; // aim for ~10 grid lines
    const step = nice.find((s) => s >= target) ?? nice[nice.length - 1];
    const ticks: number[] = [];
    for (let v = step; v < maxP; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [maxP]);

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

  const positionPoints = useMemo(
    () => positionWeights.map((w, i) => ({
      x: CHART_PADDING.left + barW * (i + 0.5),
      y: CHART_PADDING.top + plotH * (1 - w / maxP),
    })),
    [positionWeights, barW, plotH, maxP],
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
  const positionAreaPath = useMemo(
    () => smooth ? buildSmoothAreaPath(positionPoints, baseline) : buildAreaPath(positionPoints, baseline),
    [positionPoints, baseline, smooth],
  );
  const positionLinePath = useMemo(
    () => smooth ? buildSmoothLinePath(positionPoints) : buildPolylinePath(positionPoints),
    [positionPoints, smooth],
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

  // Convert clientX to SVG X coordinate (zoom-aware)
  const clientXToSvgX = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg) return 0;
      const rect = svg.getBoundingClientRect();
      return vbX + ((clientX - rect.left) / rect.width) * vbW;
    },
    [vbX, vbW],
  );

  // Convert clientY to SVG Y coordinate (zoom-aware)
  const clientYToSvgY = useCallback(
    (clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return 0;
      const rect = svg.getBoundingClientRect();
      return vbY + ((clientY - rect.top) / rect.height) * vbH;
    },
    [vbY, vbH],
  );

  // Convert client X to range value (zoom-aware)
  const clientXToValue = useCallback(
    (clientX: number) => {
      const svgX = clientXToSvgX(clientX);
      const plotX = svgX - CHART_PADDING.left;
      const frac = Math.max(0, Math.min(1, plotX / plotW));
      return rangeMin + frac * rangeWidth;
    },
    [clientXToSvgX, rangeMin, rangeWidth, plotW],
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
      (e.target as Element).setPointerCapture?.(e.pointerId);

      // Check if click is in Y-axis zone (left padding)
      const svgX = clientXToSvgX(e.clientX);
      if (svgX < CHART_PADDING.left) {
        yDragRef.current = { startClientY: e.clientY, startMaxP: yScaleOverride ?? computedMaxP };
        setDragMode("y-scale");
        return;
      }

      const value = clientXToValue(e.clientX);

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

      // Click sets mu — reset zoom so user sees full chart with new position
      const clamped = Math.max(rangeMin, Math.min(rangeMax, value));
      onMuChange(clamped);
      setDragMode("mu");
      // Freeze y-axis during mu drag to prevent grid jitter (skip first click when mu is unset)
      if (mu !== null && dynamicScale && yScaleOverride == null) setFrozenMaxP(rawMaxP);
      if (zoom > 1) resetZoom();
    },
    [clientXToSvgX, clientXToValue, mu, sigma, handleThreshold, rangeMin, rangeMax, onMuChange, yScaleOverride, computedMaxP, zoom, resetZoom, dynamicScale, rawMaxP],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragMode === "none") return;

      if (dragMode === "y-scale") {
        const ref = yDragRef.current;
        if (!ref) return;
        const deltaY = e.clientY - ref.startClientY;
        // Drag down = zoom in (decrease maxP), drag up = zoom out (increase maxP)
        const scale = Math.pow(2, -deltaY / 150);
        const newMaxP = Math.max(0.001, Math.min(10, ref.startMaxP * scale));
        setYScaleOverride(newMaxP);
        return;
      }

      const value = clientXToValue(e.clientX);

      if (dragMode === "mu") {
        // Lazy-freeze y-axis on first move (covers initial click where mu was null)
        if (frozenMaxP == null && dynamicScale && yScaleOverride == null) setFrozenMaxP(rawMaxP);
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
    [dragMode, clientXToValue, mu, rangeMin, rangeMax, minSigma, onMuChange, onSigmaChange, frozenMaxP, dynamicScale, yScaleOverride, rawMaxP],
  );

  const handlePointerUp = useCallback(() => {
    setDragMode("none");
    setFrozenMaxP(null);
  }, []);

  // Cursor style
  const [hoverCursor, setHoverCursor] = useState("crosshair");
  const [hoveredCurve, setHoveredCurve] = useState<"none" | "market" | "position" | "trader">("none");
  const handleHoverMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragMode !== "none") return;
      const svgX = clientXToSvgX(e.clientX);
      // Y-axis zone: show ns-resize cursor
      if (svgX < CHART_PADDING.left) {
        setHoverCursor("ns-resize");
        setHoveredCurve("none");
        return;
      }
      if (mu === null) {
        setHoverCursor("crosshair");
      } else {
        const value = clientXToValue(e.clientX);
        const leftBound = mu - sigma;
        const rightBound = mu + sigma;
        if (Math.abs(value - leftBound) < handleThreshold || Math.abs(value - rightBound) < handleThreshold) {
          setHoverCursor("ew-resize");
        } else {
          setHoverCursor("crosshair");
        }
      }
      // Detect closest curve for hover-to-front
      if (svgX >= CHART_PADDING.left && svgX <= VIEW_W - CHART_PADDING.right) {
        const svgY = clientYToSvgY(e.clientY);
        const candidates: ["market" | "position" | "trader", number | null][] = [
          ["market", interpolateY(marketPoints, svgX)],
          ["position", positionPoints.length > 0 ? interpolateY(positionPoints, svgX) : null],
          ["trader", traderPoints.length > 0 ? interpolateY(traderPoints, svgX) : null],
        ];
        let closest: "none" | "market" | "position" | "trader" = "none";
        let closestDist = 25;
        for (const [name, y] of candidates) {
          if (y !== null) {
            const dist = Math.abs(svgY - y);
            if (dist < closestDist) {
              closestDist = dist;
              closest = name;
            }
          }
        }
        setHoveredCurve(closest);
      } else {
        setHoveredCurve("none");
      }
    },
    [dragMode, mu, sigma, handleThreshold, clientXToValue, clientXToSvgX, clientYToSvgY, marketPoints, positionPoints, traderPoints],
  );

  // Double-click: Y-axis resets manual scale, plot area resets zoom
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svgX = clientXToSvgX(e.clientX);
      if (svgX < CHART_PADDING.left && yScaleOverride !== null) {
        setYScaleOverride(null);
        return;
      }
      if (zoom > 1) {
        resetZoom();
      }
    },
    [clientXToSvgX, yScaleOverride, zoom, resetZoom],
  );

  // Shift+! keybinding to toggle smooth/segmented curve (hidden developer shortcut)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key === "!") {
        e.preventDefault();
        setPref("chartSmooth", !smooth);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [smooth, setPref]);

  // Scroll-to-zoom (non-passive wheel handler via useEffect)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      const fracX = (e.clientX - rect.left) / rect.width;
      const fracY = (e.clientY - rect.top) / rect.height;
      if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return;

      e.preventDefault();

      const zs = zoomStateRef.current;
      const cursorSvgX = zs.vbX + fracX * zs.vbW;
      const cursorSvgY = zs.vbY + fracY * zs.vbH;

      const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2;
      const newZoom = Math.max(1, Math.min(8, zs.zoom * factor));

      if (newZoom <= 1.01) {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
        setYScaleOverride(null);
        return;
      }

      const newVbW = VIEW_W / newZoom;
      const newVbH = zs.height / newZoom;
      const newVbX = Math.max(0, Math.min(VIEW_W - newVbW, cursorSvgX - fracX * newVbW));
      const newVbY = Math.max(0, Math.min(zs.height - newVbH, cursorSvgY - fracY * newVbH));

      setZoom(newZoom);
      setPanOffset({ x: newVbX, y: newVbY });
      setYScaleOverride(null);
    };
    // Zoom-on-scroll disabled — interferes with page scrolling
    // svg.addEventListener("wheel", handler, { passive: false });
    // return () => svg.removeEventListener("wheel", handler);
  }, []);

  const toggleCurve = useCallback((curve: "market" | "trader" | "position") => {
    setHiddenCurves((prev) => {
      const next = new Set(prev);
      if (next.has(curve)) next.delete(curve);
      else next.add(curve);
      return next;
    });
  }, []);

  // Curve render order: hovered curve drawn last (on top), hidden curves excluded
  const curveOrder = useMemo(() => {
    const order: ("position" | "market" | "trader")[] = ["position", "market", "trader"];
    const visible = order.filter((c) => !hiddenCurves.has(c));
    if (hoveredCurve !== "none") {
      const idx = visible.indexOf(hoveredCurve);
      if (idx >= 0) {
        visible.splice(idx, 1);
        visible.push(hoveredCurve);
      }
    }
    return visible;
  }, [hoveredCurve, hiddenCurves]);

  // Mu and sigma positions
  const muX = mu !== null ? valueToX(mu) : null;
  const leftBoundX = mu !== null ? valueToX(Math.max(rangeMin, mu - sigma)) : null;
  const rightBoundX = mu !== null ? valueToX(Math.min(rangeMax, mu + sigma)) : null;
  const leftBoundValue = mu !== null ? Math.max(rangeMin, mu - sigma) : null;
  const rightBoundValue = mu !== null ? Math.min(rangeMax, mu + sigma) : null;

  return (
    <div className="relative w-full">
      {/* Y-axis controls — above chart, left-aligned (hidden in readOnly/sell mode) */}
      <div className={`flex items-center gap-2 mb-1.5 pl-1${readOnly ? " invisible" : ""}`}>
        <button
          type="button"
          onClick={() => { setPref("chartDynamicScale", !dynamicScale); setYScaleOverride(null); setFixedYBase(null); resetZoom(); }}
          className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-border/30 bg-muted/20 transition-colors hover:bg-muted/40 hover:text-foreground ${dynamicScale ? "text-blue-400" : "text-muted-foreground/50"}`}
          title={dynamicScale ? "Switch to fixed Y-axis (market-based)" : "Switch to dynamic Y-axis (auto-fit both curves)"}
        >
          <svg width="10" height="9" viewBox="0 0 14 10">
            <path d="M1 9 L1 1 M1 1 L3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {dynamicScale && (
              <path d="M6 5 L8 3 L10 6 L13 2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setPref("chartYUnit", yUnit === "pct" ? "price" : "pct")}
          className="text-[10px] leading-none text-muted-foreground/50 cursor-pointer transition-colors hover:text-foreground/70 underline decoration-dotted decoration-muted-foreground/30 underline-offset-2"
          title={yUnit === "pct" ? "Switch to price view" : "Switch to probability view"}
        >
          {yUnit === "pct" ? "Probability" : "Price"}
        </button>
      </div>
      <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className="w-full h-auto select-none"
        style={{ cursor: readOnly ? "default" : dragMode === "y-scale" ? "ns-resize" : dragMode !== "none" ? "grabbing" : hoverCursor }}
        onPointerDown={readOnly ? undefined : handlePointerDown}
        onPointerMove={readOnly ? undefined : (e) => { handlePointerMove(e); handleHoverMove(e); }}
        onPointerUp={readOnly ? undefined : handlePointerUp}
        onPointerLeave={readOnly ? undefined : () => { handlePointerUp(); setHoveredCurve("none"); }}
        onDoubleClick={readOnly ? undefined : handleDoubleClick}
      >
        <defs>
          <linearGradient id={gradientMarketId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLOR_MARKET} stopOpacity={0.25} />
            <stop offset="100%" stopColor={COLOR_MARKET} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={gradientUserId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLOR_TRADER} stopOpacity={0.3} />
            <stop offset="100%" stopColor={COLOR_TRADER} stopOpacity={0.03} />
          </linearGradient>
          <linearGradient id={gradientPositionId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLOR_POSITION} stopOpacity={0.35} />
            <stop offset="100%" stopColor={COLOR_POSITION} stopOpacity={0.04} />
          </linearGradient>
          {/* Sigma region fill gradient (vertical) */}
          <linearGradient id={sigmaFillId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={COLOR_TRADER} stopOpacity={0.1} />
            <stop offset="100%" stopColor={COLOR_TRADER} stopOpacity={0.02} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={CHART_PADDING.left} y={CHART_PADDING.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Zoom level indicator */}
        {zoom > 1.01 && (
          <text
            x={VIEW_W - CHART_PADDING.right}
            y={CHART_PADDING.top - 4}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={8}
            opacity={0.5}
          >
            {zoom.toFixed(1)}x — double-click to reset
          </text>
        )}

        {/* Y-axis line */}
        <line
          x1={CHART_PADDING.left} x2={CHART_PADDING.left}
          y1={CHART_PADDING.top} y2={baseline}
          stroke="currentColor" strokeOpacity={0.1} strokeWidth={0.5}
        />

        {/* Grid lines + Y-axis labels */}
        {yTicks.map((val) => {
          const frac = val / maxP;
          const y = CHART_PADDING.top + plotH * (1 - frac);
          return (
            <g key={val}>
              <line
                x1={CHART_PADDING.left}
                x2={VIEW_W - CHART_PADDING.right}
                y1={y} y2={y}
                stroke="currentColor"
                strokeOpacity={0.07}
                strokeWidth={0.5}
              />
              {/* Tick mark */}
              <line
                x1={CHART_PADDING.left - TICK_SIZE} x2={CHART_PADDING.left}
                y1={y} y2={y}
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={0.5}
              />
              <text
                x={CHART_PADDING.left - TICK_SIZE - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground/60"
                fontSize={9}
              >
                {yUnit === "pct" ? formatPct(val) : formatPrice(val)}
              </text>
            </g>
          );
        })}

        {/* Baseline (0%) */}
        <line
          x1={CHART_PADDING.left}
          x2={VIEW_W - CHART_PADDING.right}
          y1={baseline} y2={baseline}
          stroke="currentColor" strokeOpacity={0.12} strokeWidth={0.5}
        />
        {/* Baseline tick + label */}
        <line
          x1={CHART_PADDING.left - TICK_SIZE} x2={CHART_PADDING.left}
          y1={baseline} y2={baseline}
          stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.5}
        />
        <text
          x={CHART_PADDING.left - TICK_SIZE - 4}
          y={baseline + 3}
          textAnchor="end"
          className="fill-muted-foreground/60"
          fontSize={9}
        >
          {yUnit === "pct" ? "0%" : "$0"}
        </text>

        {/* Sigma shaded region between ±1σ bounds (hidden in readOnly/sell mode) */}
        {!readOnly && mu !== null && leftBoundX != null && rightBoundX != null && (
          <g clipPath={`url(#${clipId})`}>
            <rect
              x={leftBoundX}
              y={CHART_PADDING.top}
              width={rightBoundX - leftBoundX}
              height={plotH}
              fill={`url(#${sigmaFillId})`}
            />
          </g>
        )}

        {/* Curves clipped to plot area — hovered curve drawn last (on top) */}
        <g clipPath={`url(#${clipId})`}>
          {curveOrder.map((curve) => {
            const isHovered = curve === hoveredCurve;
            switch (curve) {
              case "position":
                return positionPoints.length > 0 ? (
                  <g key="position">
                    <path d={positionAreaPath} fill={`url(#${gradientPositionId})`} />
                    <path
                      d={positionLinePath}
                      fill="none"
                      stroke={COLOR_POSITION}
                      strokeWidth={isHovered ? 2.5 : 1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      style={{ transition: "stroke-width 0.15s ease" }}
                    />
                  </g>
                ) : null;
              case "market":
                return (
                  <g key="market">
                    <path d={marketAreaPath} fill={`url(#${gradientMarketId})`} />
                    <path
                      d={marketLinePath}
                      fill="none"
                      stroke={COLOR_MARKET}
                      strokeWidth={isHovered ? 2.5 : 1.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      style={{ transition: "stroke-width 0.15s ease" }}
                    />
                  </g>
                );
              case "trader":
                return mu !== null && traderPoints.length > 0 ? (
                  <g key="trader">
                    <path d={traderAreaPath} fill={`url(#${gradientUserId})`} />
                    <path
                      d={traderLinePath}
                      fill="none"
                      stroke={COLOR_TRADER}
                      strokeWidth={isHovered ? 2.5 : 2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      style={{ transition: "stroke-width 0.15s ease" }}
                    />
                  </g>
                ) : null;
              default:
                return null;
            }
          })}
        </g>

        {/* Sigma boundary lines (hidden in readOnly/sell mode) */}
        {!readOnly && mu !== null && leftBoundX != null && rightBoundX != null && (
          <>
            <line
              x1={leftBoundX} x2={leftBoundX}
              y1={CHART_PADDING.top} y2={baseline}
              stroke={COLOR_TRADER} strokeWidth={0.8}
              strokeDasharray="4 4" strokeOpacity={0.45}
            />
            <line
              x1={rightBoundX} x2={rightBoundX}
              y1={CHART_PADDING.top} y2={baseline}
              stroke={COLOR_TRADER} strokeWidth={0.8}
              strokeDasharray="4 4" strokeOpacity={0.45}
            />

            {/* Drag handles — outer ring + filled center */}
            {[
              { cx: leftBoundX, label: leftBoundValue },
              { cx: rightBoundX, label: rightBoundValue },
            ].map(({ cx, label }, i) => (
              <g key={i}>
                <circle
                  cx={cx} cy={baseline - plotH * 0.5}
                  r={HANDLE_RADIUS + 2}
                  fill={COLOR_TRADER} fillOpacity={0.08}
                  className="pointer-events-none"
                />
                <circle
                  cx={cx} cy={baseline - plotH * 0.5}
                  r={HANDLE_RADIUS}
                  fill="rgb(30 35 50)" fillOpacity={0.9}
                  stroke={COLOR_TRADER} strokeWidth={1.5}
                  className="pointer-events-none"
                />
                <circle
                  cx={cx} cy={baseline - plotH * 0.5}
                  r={2.5}
                  fill={COLOR_TRADER} fillOpacity={0.7}
                  className="pointer-events-none"
                />
                {/* Sigma boundary value label */}
                <text
                  x={cx} y={baseline - plotH * 0.5 - 14}
                  textAnchor="middle"
                  className="fill-blue-400/80"
                  fontSize={10} fontWeight={600}
                >
                  {formatChartValue(label!)}
                </text>
              </g>
            ))}
          </>
        )}

        {/* Mu marker (hidden in readOnly/sell mode) */}
        {!readOnly && mu !== null && muX != null && (
          <line
            x1={muX} x2={muX}
            y1={CHART_PADDING.top} y2={baseline}
            stroke={COLOR_TRADER} strokeWidth={1.2}
            strokeDasharray="3 3" strokeOpacity={0.6}
          />
        )}

        {/* "Drag to change the curve peak" hint (hidden in readOnly/sell mode) */}
        {!readOnly && mu !== null && muX != null && (
          <text
            x={muX} y={baseline - 6}
            textAnchor="middle"
            className="fill-muted-foreground/40"
            fontSize={8}
          >
            Drag to change the curve peak
          </text>
        )}

        {/* X-axis tick marks + labels */}
        {ticks.map(({ value, x }, i) => (
          <g key={i}>
            <line
              x1={x} x2={x}
              y1={baseline} y2={baseline + TICK_SIZE}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={0.5}
            />
            <text
              x={x} y={baseline + TICK_SIZE + 12}
              textAnchor="middle"
              className="fill-muted-foreground/60"
              fontSize={10}
            >
              {formatChartValue(value)}
            </text>
          </g>
        ))}

        {/* Click hint (only when no mu set and not readOnly) */}
        {!readOnly && mu === null && (
          <text
            x={VIEW_W / 2} y={height / 2}
            textAnchor="middle"
            className="fill-muted-foreground/40"
            fontSize={12}
          >
            Click on the chart to place your prediction
          </text>
        )}
      </svg>

      {/* Tutorial step markers — positioned relative to chart for popover anchoring */}
      <div
        data-tutorial="chart-first-click"
        className="pointer-events-none absolute"
        style={{ left: "30%", top: "40%", width: 0, height: 0 }}
      />
      <div
        data-tutorial="chart-second-click"
        className="pointer-events-none absolute"
        style={{ left: "68%", top: "18%", width: 0, height: 0 }}
      />
      {/* Confidence marker — vertical strip at mu covering the plot area */}
      {muX != null && (
        <div
          data-tutorial="chart-peak"
          className="pointer-events-none absolute"
          style={{
            left: `${(muX / VIEW_W) * 100}%`,
            top: `${(CHART_PADDING.top / height) * 100}%`,
            width: 32,
            height: `${(plotH / height) * 100}%`,
            transform: "translateX(-50%)",
          }}
        />
      )}
      </div>

      {/* Legend (clickable to toggle curves) */}
      <div className="mt-2 flex items-center justify-center gap-3 text-[10px]">
        <LegendItem
          color={COLOR_MARKET}
          label="Market"
          hidden={hiddenCurves.has("market")}
          onClick={() => toggleCurve("market")}
        />
        {!readOnly && mu !== null && (
          <LegendItem
            color={COLOR_TRADER}
            label="Your prediction"
            hidden={hiddenCurves.has("trader")}
            onClick={() => toggleCurve("trader")}
          />
        )}
        {positionPoints.length > 0 && (
          <LegendItem
            color={COLOR_POSITION}
            label="Your position"
            hidden={hiddenCurves.has("position")}
            onClick={() => toggleCurve("position")}
          />
        )}
      </div>

      {/* Mu/Sigma display below chart (hidden in readOnly/sell mode) */}
      {!readOnly && mu !== null && (
        <div className="mt-1.5 flex items-center justify-center gap-5 text-[11px] text-muted-foreground/70">
          <span>
            Center: <span className="font-medium text-foreground/90 tabular-nums">{formatChartValue(mu)}</span>
          </span>
          <span className="text-border">|</span>
          <span>
            Spread (±1σ): <span className="font-medium text-foreground/90 tabular-nums">{formatChartValue(sigma)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ── Legend item ──────────────────────────────────────────────────────

function LegendItem({ color, label, hidden, onClick }: {
  color: string;
  label: string;
  hidden: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex items-center gap-1.5 cursor-pointer rounded-full px-2 py-0.5 transition-all border border-transparent hover:border-border/30 hover:bg-muted/30 ${hidden ? "opacity-35" : "text-muted-foreground/70"}`}
      onClick={onClick}
      title={hidden ? `Show ${label}` : `Hide ${label}`}
    >
      <span
        className={`inline-block h-[3px] w-3.5 rounded-full ${hidden ? "opacity-50" : ""}`}
        style={{ backgroundColor: color }}
      />
      <span className={hidden ? "line-through" : ""}>{label}</span>
    </button>
  );
}

// ── Path builders ───────────────────────────────────────────────────

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

/** Catmull-Rom spline -> cubic Bezier SVG path (smooth line through all points) */
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

/** Interpolate Y value at a given X from a points array (linear between neighbors) */
function interpolateY(points: { x: number; y: number }[], x: number): number | null {
  if (points.length === 0) return null;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i++) {
    if (x >= points[i].x && x <= points[i + 1].x) {
      const t = (x - points[i].x) / (points[i + 1].x - points[i].x);
      return points[i].y + t * (points[i + 1].y - points[i].y);
    }
  }
  return null;
}
