import { TrendingUp, TrendingDown } from "lucide-react";

const MARKET_SIGNALS = [
  {
    title: "Whale Entry Detected",
    description: "$12.4M position opened on BTC Q2 distribution tail",
    time: "3m ago",
  },
  {
    title: "Whale Entry Detected",
    description: "$12.4M position opened on BTC Q2 distribution tail",
    time: "3m ago",
  },
  {
    title: "Whale Entry Detected",
    description: "$12.4M position opened on BTC Q2 distribution tail",
    time: "3m ago",
  },
  {
    title: "Whale Entry Detected",
    description: "$12.4M position opened on BTC Q2 distribution tail",
    time: "3m ago",
  },
];

const TRENDING_TOPICS = [
  { name: "BTC Halving Impact", count: "2.4K", change: 18, up: true },
  { name: "MicroStrategy Holdings", count: "1.8K", change: 11, up: false },
  { name: "BTC ETF Inflows", count: "1.2K", change: 6, up: true },
  { name: "Lightning Network Growth", count: "980", change: 44, up: false },
  { name: "BTC Dominance", count: "740", change: 3, up: true },
];

export function FeaturedSidebar() {
  return (
    <div className="flex flex-col gap-6">
      <MarketSignals />
      <TrendingTopics />
    </div>
  );
}

function MarketSignals() {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-foreground">Market Signals</h3>
      <div className="space-y-3">
        {MARKET_SIGNALS.map((signal, i) => (
          <div key={i} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium leading-tight">{signal.title}</div>
              <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                {signal.description}
              </p>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">{signal.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendingTopics() {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        <span className="text-sm font-bold text-muted-foreground">#</span>
        <h3 className="text-sm font-semibold text-foreground">Trending Topics</h3>
      </div>
      <div className="space-y-2.5">
        {TRENDING_TOPICS.map((topic, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-4 text-sm font-bold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-sm">{topic.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{topic.count}</span>
            <span
              className={`flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                topic.up ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {topic.up ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {topic.up ? "+" : "-"}{topic.change}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
