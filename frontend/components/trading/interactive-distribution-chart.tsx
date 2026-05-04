"use client";

import { useRef, useId, useMemo, useCallback, useState, useEffect } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
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
  positionHoldings,
  height = DEFAULT_HEIGHT,
}: InteractiveDistributionChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientMarketId = useId();
  const gradientUserId = useId();
  const gradientPositionId = useId();
  const clipId = useId();
  const [dragMode, setDragMode] = useState<"none" | "mu" | "sigma-left" | "sigma-right" | "y-scale">("none");
  const { prefs, setPref } = useLocalPrefs();
  const smooth = prefs.chartSmooth;
  const yUnit = prefs.chartYUnit;
  const dynamicScale = prefs.chartDynamicScale;

  // Y-axis manual scale override
  const [yScaleOverride, setYScaleOverride] = useState<number | null>(null);
  const yDragRef = useRef<{ startClientY: number; startMaxP: number } | null>(null);

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
    if (dynamicScale) {
      return Math.max(marketMax, traderMax, posMax, 0.001) * 1.1;
    }
    // Fixed scale: try to fit trader/position curves too, but never shrink market below ~1/3 of chart
    const othersMax = Math.max(traderMax, posMax);
    return Math.max(marketMax * 1.2, Math.min(othersMax * 1.1, marketMax * 3));
  }, [marketProbabilities, traderWeights, positionWeights, dynamicScale]);
  const maxP = yScaleOverride ?? computedMaxP;

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
      if (zoom > 1) resetZoom();
    },
    [clientXToSvgX, clientXToValue, mu, sigma, handleThreshold, rangeMin, rangeMax, onMuChange, yScaleOverride, computedMaxP, zoom, resetZoom],
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

  // Zoom via buttons (zoom from center of current view)
  const zoomBy = useCallback((factor: number) => {
    const newZoom = Math.max(1, Math.min(8, zoom * factor));
    if (newZoom <= 1.01) {
      resetZoom();
      setYScaleOverride(null);
      return;
    }
    const centerX = vbX + vbW / 2;
    const centerY = vbY + vbH / 2;
    const newVbW = VIEW_W / newZoom;
    const newVbH = height / newZoom;
    const newVbX = Math.max(0, Math.min(VIEW_W - newVbW, centerX - newVbW / 2));
    const newVbY = Math.max(0, Math.min(height - newVbH, centerY - newVbH / 2));
    setZoom(newZoom);
    setPanOffset({ x: newVbX, y: newVbY });
  }, [zoom, vbX, vbY, vbW, vbH, height, resetZoom]);

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
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  // Curve render order: hovered curve drawn last (on top)
  const curveOrder = useMemo(() => {
    const order: ("position" | "market" | "trader")[] = ["position", "market", "trader"];
    if (hoveredCurve !== "none") {
      const idx = order.indexOf(hoveredCurve);
      if (idx >= 0) {
        order.splice(idx, 1);
        order.push(hoveredCurve);
      }
    }
    return order;
  }, [hoveredCurve]);

  // Mu and sigma positions
  const muX = mu !== null ? valueToX(mu) : null;
  const leftBoundX = mu !== null ? valueToX(Math.max(rangeMin, mu - sigma)) : null;
  const rightBoundX = mu !== null ? valueToX(Math.min(rangeMax, mu + sigma)) : null;
  const leftBoundValue = mu !== null ? Math.max(rangeMin, mu - sigma) : null;
  const rightBoundValue = mu !== null ? Math.min(rangeMax, mu + sigma) : null;

  return (
    <div className="relative w-full">
      {/* Chart toolbar — sits above the chart, doesn't overlap */}
      <div className="flex items-center justify-between mb-1">
        {/* Left: Y-axis controls (stacked vertically) */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setPref("chartYUnit", yUnit === "pct" ? "price" : "pct")}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border/40 bg-muted/30 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            title={yUnit === "pct" ? "Switch to price" : "Switch to percentage"}
          >
            {yUnit === "pct" ? "%" : "$"}
          </button>
          <button
            type="button"
            onClick={() => { setPref("chartDynamicScale", !dynamicScale); setYScaleOverride(null); resetZoom(); }}
            className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border/40 bg-muted/30 transition-colors hover:text-foreground ${dynamicScale ? "text-blue-400" : "text-muted-foreground"}`}
            title={dynamicScale ? "Switch to fixed Y-axis (market-based)" : "Switch to dynamic Y-axis (auto-fit both curves)"}
          >
            <svg width="12" height="10" viewBox="0 0 14 10">
              <path d="M1 9 L1 1 M1 1 L3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              {dynamicScale && (
                <path d="M6 5 L8 3 L10 6 L13 2" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>
        {/* Right: curve style + zoom controls (single row) */}
        <div className="flex gap-0.5 items-center">
          <button
            type="button"
            onClick={() => zoomBy(1.5)}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground transition-colors hover:text-foreground"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.5)}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground transition-colors hover:text-foreground"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPref("chartSmooth", !smooth)}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground transition-colors hover:text-foreground"
            title={smooth ? "Switch to segmented (real bins)" : "Switch to smooth curve"}
          >
            <svg width="14" height="10" viewBox="0 0 16 10">
              {smooth ? (
                <path d="M1 8 C3 8 5 2 8 2 C11 2 13 6 15 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M1 8 L4 6 L7 2 L10 4 L13 3 L15 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className="w-full h-auto select-none"
        style={{ cursor: dragMode === "y-scale" ? "ns-resize" : dragMode !== "none" ? "grabbing" : hoverCursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => { handlePointerMove(e); handleHoverMove(e); }}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { handlePointerUp(); setHoveredCurve("none"); }}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <linearGradient id={gradientMarketId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(85 95 110)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(85 95 110)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id={gradientUserId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id={gradientPositionId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(190 175 55)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="rgb(190 175 55)" stopOpacity={0.08} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={CHART_PADDING.left} y={CHART_PADDING.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Zoom level indicator */}
        {zoom > 1.01 && (
          <text
            x={VIEW_W - CHART_PADDING.right}
            y={CHART_PADDING.top - 2}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={9}
            opacity={0.6}
          >
            {zoom.toFixed(1)}× — 2×click or scroll to reset
          </text>
        )}

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
                      stroke="rgb(190 175 55)"
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
                      stroke="rgb(85 95 110)"
                      strokeWidth={isHovered ? 2.5 : 2}
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
                      stroke="rgb(59 130 246)"
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
          <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: "rgb(85 95 110)" }} />
          Market
        </span>
        {mu !== null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-blue-500" />
            Your prediction
          </span>
        )}
        {positionPoints.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: "rgb(190 175 55)" }} />
            Your position
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

