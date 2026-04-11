"use client";

import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { computeBinWeights, sliderToSigma } from "@/lib/normal";
import { computeProbabilities, SCALE, type MarketDetail } from "@/lib/types";

interface DistributionInputProps {
  market: MarketDetail;
  onParamsChange: (
    params: { mu: number; sigma: number; amount: string } | null,
  ) => void;
}

export function DistributionInput({
  market,
  onParamsChange,
}: DistributionInputProps) {
  const rangeMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
  const rangeMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;
  const rangeWidth = rangeMax - rangeMin;
  const numBins = market.numOutcomes;

  const [centerInput, setCenterInput] = useState(() => {
    const mid = (rangeMin + rangeMax) / 2;
    return Number.isInteger(mid) ? String(mid) : mid.toFixed(2);
  });
  const [confidenceSlider, setConfidenceSlider] = useState(0.5);
  const [amount, setAmount] = useState("");

  // Clamped numeric mu from text input
  const mu = useMemo(() => {
    const parsed = Number(centerInput);
    if (isNaN(parsed)) return (rangeMin + rangeMax) / 2;
    return Math.max(rangeMin, Math.min(rangeMax, parsed));
  }, [centerInput, rangeMin, rangeMax]);

  const sigma = sliderToSigma(confidenceSlider, rangeWidth);

  // Market's current distribution
  const marketProbabilities = useMemo(
    () => computeProbabilities(market.reserves),
    [market.reserves],
  );

  // Trader's distribution preview
  const traderWeights = useMemo(
    () => computeBinWeights(rangeMin, rangeMax, numBins, mu, sigma),
    [rangeMin, rangeMax, numBins, mu, sigma],
  );

  useEffect(() => {
    if (amount && Number(amount) > 0 && sigma > 0) {
      onParamsChange({ mu, sigma, amount });
    } else {
      onParamsChange(null);
    }
  }, [mu, sigma, amount, onParamsChange]);

  const centerStep = rangeWidth / 1000;

  return (
    <div className="space-y-4">
      {/* Center (mu) input */}
      <div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          Your prediction
        </label>
        <Input
          type="number"
          value={centerInput}
          onChange={(e) => setCenterInput(e.target.value)}
          min={rangeMin}
          max={rangeMax}
          step={centerStep}
          className="mb-2 tabular-nums"
        />
        <Slider
          value={[mu]}
          onValueChange={([v]) => {
            setCenterInput(
              Number.isInteger(v) ? String(v) : v.toFixed(2),
            );
          }}
          min={rangeMin}
          max={rangeMax}
          step={centerStep}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/60">
          <span>{formatValue(rangeMin)}</span>
          <span>{formatValue(rangeMax)}</span>
        </div>
      </div>

      {/* Confidence (sigma) slider */}
      <div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          Confidence
        </label>
        <Slider
          value={[confidenceSlider]}
          onValueChange={([v]) => setConfidenceSlider(v)}
          min={0}
          max={1}
          step={0.01}
        />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/60">
          <span>Very sure</span>
          <span>Uncertain</span>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          &plusmn;{formatValue(sigma)} covers 68% of your prediction
        </p>
      </div>

      {/* Preview chart */}
      <DistributionPreview
        marketProbabilities={marketProbabilities}
        traderWeights={traderWeights}
        rangeMin={rangeMin}
        rangeMax={rangeMax}
        numBins={numBins}
        mu={mu}
      />

      {/* Amount input */}
      <div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          Amount (USDC)
        </label>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pr-14"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            USDC
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview chart: overlays trader distribution on market distribution
// ---------------------------------------------------------------------------

const PREVIEW_H = 120;
const PAD = { top: 8, right: 12, bottom: 20, left: 12 };
const VIEW_W = 300;

function DistributionPreview({
  marketProbabilities,
  traderWeights,
  rangeMin,
  rangeMax,
  numBins,
  mu,
}: {
  marketProbabilities: number[];
  traderWeights: number[];
  rangeMin: number;
  rangeMax: number;
  numBins: number;
  mu: number;
}) {
  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = PREVIEW_H - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerH;

  // Scale both distributions to shared max
  const maxP = Math.max(...marketProbabilities, ...traderWeights, 0.001);

  const barW = innerW / numBins;

  const marketPoints = marketProbabilities.map((p, i) => ({
    x: PAD.left + barW * (i + 0.5),
    y: PAD.top + innerH * (1 - p / maxP),
  }));

  const traderPoints = traderWeights.map((w, i) => ({
    x: PAD.left + barW * (i + 0.5),
    y: PAD.top + innerH * (1 - w / maxP),
  }));

  // Trader area path
  const traderArea = buildAreaPath(traderPoints, baseline);

  // Market polyline
  const marketLine = marketPoints
    .map((pt) => `${pt.x},${pt.y}`)
    .join(" ");

  // Trader polyline
  const traderLine = traderPoints
    .map((pt) => `${pt.x},${pt.y}`)
    .join(" ");

  // Mu marker
  const muFrac = Math.max(0, Math.min(1, (mu - rangeMin) / (rangeMax - rangeMin)));
  const muX = PAD.left + muFrac * innerW;

  // X-axis ticks
  const ticks = [0, 0.5, 1].map((frac) => ({
    value: rangeMin + frac * (rangeMax - rangeMin),
    x: PAD.left + frac * innerW,
  }));

  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${PREVIEW_H}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: PREVIEW_H }}
      >
        <defs>
          <linearGradient id="traderGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity={0.3} />
            <stop
              offset="100%"
              stopColor="rgb(59 130 246)"
              stopOpacity={0.05}
            />
          </linearGradient>
        </defs>

        {/* Trader distribution — blue filled area */}
        <path d={traderArea} fill="url(#traderGradient)" />
        <polyline
          points={traderLine}
          fill="none"
          stroke="rgb(59 130 246)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Market distribution — gray dashed line */}
        <polyline
          points={marketLine}
          fill="none"
          stroke="rgb(161 161 170)"
          strokeWidth={1}
          strokeDasharray="4 3"
          strokeLinejoin="round"
          strokeOpacity={0.6}
        />

        {/* Mu marker — vertical dashed line */}
        <line
          x1={muX}
          x2={muX}
          y1={PAD.top}
          y2={baseline}
          stroke="rgb(59 130 246)"
          strokeWidth={1}
          strokeDasharray="3 2"
          strokeOpacity={0.5}
        />

        {/* Baseline */}
        <line
          x1={PAD.left}
          x2={VIEW_W - PAD.right}
          y1={baseline}
          y2={baseline}
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={0.5}
        />

        {/* X-axis labels */}
        {ticks.map(({ value, x }, i) => (
          <text
            key={i}
            x={x}
            y={PREVIEW_H - 2}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={7}
          >
            {formatValue(value)}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-4 text-[10px] text-muted-foreground/70">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded bg-blue-500" />
          Your prediction
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 rounded border-t border-dashed border-zinc-400" />
          Market
        </span>
      </div>
    </div>
  );
}

function buildAreaPath(
  points: { x: number; y: number }[],
  baseline: number,
): string {
  if (points.length === 0) return "";
  let path = `M ${points[0].x} ${baseline}`;
  for (const pt of points) {
    path += ` L ${pt.x} ${pt.y}`;
  }
  path += ` L ${points[points.length - 1].x} ${baseline} Z`;
  return path;
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}
