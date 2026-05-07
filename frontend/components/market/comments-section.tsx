"use client";

import { useState } from "react";
import { MessageSquare, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserCircle2 } from "lucide-react";
import { ActivityTab } from "./activity-tab";

type CommentSide = "buy" | "sell";

type DummyComment = {
  id: string;
  username: string;
  minutesAgo: number;
  side: CommentSide;
  text: string;
  confidence: number;
  leftLabel: string;
  rightLabel: string;
  peak: number;
};

const DUMMY_COMMENTS: DummyComment[] = [
  {
    id: "c1",
    username: "big69",
    minutesAgo: 2,
    side: "buy",
    text: "Lets see what happens :))",
    confidence: 68,
    leftLabel: "$60K",
    rightLabel: "$75K",
    peak: 0.56,
  },
  {
    id: "c2",
    username: "alpha_j",
    minutesAgo: 3,
    side: "buy",
    text: "Momentum still looks strong above support.",
    confidence: 64,
    leftLabel: "$61K",
    rightLabel: "$76K",
    peak: 0.52,
  },
  {
    id: "c3",
    username: "rayor",
    minutesAgo: 4,
    side: "sell",
    text: "I expect a pullback before month end.",
    confidence: 59,
    leftLabel: "$58K",
    rightLabel: "$73K",
    peak: 0.47,
  },
  {
    id: "c4",
    username: "bir_d",
    minutesAgo: 6,
    side: "buy",
    text: "ETF inflow narrative is still intact.",
    confidence: 71,
    leftLabel: "$62K",
    rightLabel: "$78K",
    peak: 0.6,
  },
  {
    id: "c5",
    username: "owen24",
    minutesAgo: 8,
    side: "buy",
    text: "Dip buys are getting filled quickly.",
    confidence: 66,
    leftLabel: "$60K",
    rightLabel: "$74K",
    peak: 0.55,
  },
  {
    id: "c6",
    username: "qbyte",
    minutesAgo: 10,
    side: "sell",
    text: "Macro data can still surprise downside.",
    confidence: 54,
    leftLabel: "$57K",
    rightLabel: "$72K",
    peak: 0.44,
  },
];

interface CommentsSectionProps {
  marketId?: string;
  marketCreator?: string;
}

export function CommentsSection({ marketId, marketCreator }: CommentsSectionProps) {
  const [tab, setTab] = useState<"comments" | "activity">("activity");

  return (
    <section className="overflow-hidden rounded-xl border border-border/40 bg-card/35 backdrop-blur-sm">
      <header className="flex items-center border-b border-border/30">
        <button
          onClick={() => setTab("activity")}
          className={cn(
            "flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors",
            tab === "activity"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Activity className="h-4 w-4" />
          Activity
        </button>
        <button
          onClick={() => setTab("comments")}
          className={cn(
            "flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors",
            tab === "comments"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Comments
        </button>
      </header>

      <div className="min-h-[380px] max-h-[480px] overflow-y-auto">
        {tab === "comments" ? (
          <ComingSoon />
        ) : (
          <ActivityTab marketId={marketId} marketCreator={marketCreator} />
        )}
      </div>
    </section>
  );
}

function ComingSoon() {
  return (
    <div className="flex min-h-[380px] items-center justify-center px-4 py-12">
      <div className="text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-3 text-base font-semibold">Coming Soon!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Comments will be available in a future update.
        </p>
      </div>
    </div>
  );
}

function CommentsContent() {
  return (
    <div className="divide-y divide-border/20">
      {DUMMY_COMMENTS.map((comment) => (
        <article
          key={comment.id}
          className="flex items-center justify-between gap-3 px-4 py-3.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <UserCircle2 className="h-6 w-6 shrink-0 text-muted-foreground/70" />
              <span className="text-sm font-medium">{comment.username}</span>
              <span className="text-xs text-muted-foreground">
                {comment.minutesAgo}m
              </span>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  comment.side === "buy"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-rose-500/15 text-rose-400",
                )}
              >
                {comment.side}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {comment.text}
            </p>
          </div>

          <div className="hidden w-[170px] shrink-0 md:block">
            <CommentMiniChart
              confidence={comment.confidence}
              leftLabel={comment.leftLabel}
              rightLabel={comment.rightLabel}
              peak={comment.peak}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function CommentMiniChart({
  confidence,
  leftLabel,
  rightLabel,
  peak,
}: {
  confidence: number;
  leftLabel: string;
  rightLabel: string;
  peak: number;
}) {
  const width = 164;
  const height = 56;
  const baseY = 42;
  const minX = 24;
  const maxX = 142;
  const spread = 0.12 + (100 - confidence) / 300;

  const points = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    const x = minX + (maxX - minX) * t;
    const amp = Math.exp(-((t - peak) ** 2) / (2 * spread * spread));
    const y = baseY - amp * 28;
    return { x, y };
  });

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath = `M ${minX} ${baseY} ${points
    .map((p) => `L ${p.x} ${p.y}`)
    .join(" ")} L ${maxX} ${baseY} Z`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <defs>
          <linearGradient id={`comment-grad-${confidence}-${Math.round(peak * 100)}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(245 197 66)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="rgb(245 197 66)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        <path
          d={areaPath}
          fill={`url(#comment-grad-${confidence}-${Math.round(peak * 100)})`}
        />
        <polyline
          points={line}
          fill="none"
          stroke="rgb(245 197 66)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        <text
          x={(minX + maxX) / 2}
          y={36}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize="9"
        >
          {confidence}%
        </text>
        <text x={8} y={53} className="fill-muted-foreground" fontSize="8">
          {leftLabel}
        </text>
        <text x={154} y={53} className="fill-muted-foreground" fontSize="8" textAnchor="end">
          {rightLabel}
        </text>
      </svg>
    </div>
  );
}
