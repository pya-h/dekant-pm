import { ExternalLink } from "lucide-react";

const MARKET_SIGNALS = [
  // {
  //   title: "Whale Entry Detected",
  //   description: "$12.4M position opened on BTC Q2 distribution tail",
  //   time: "3m ago",
  // },
];

const TRENDING_TOPICS = [
  {
    name: "CLARITY Act Markup",
    href: "https://www.coindesk.com/policy/2026/05/01/clarity-act-text-lets-crypto-firms-offer-stablecoin-rewards-while-shielding-bank-yield",
  },
  {
    name: "IBIT $1B Inflow Week",
    href: "https://stocktwits.com/news-articles/markets/cryptocurrency/ibit-drives-bitcoin-etf-inflows-past-1-billion-for-first-time-since-january/cZXbf0bRefy",
  },
  {
    name: "BTC Reclaims $82K",
    href: "https://finance.yahoo.com/personal-finance/investing/article/bitcoin-and-ethereum-prices-today-wednesday-may-6-2026-prices-up-bitcoin-at-highest-level-since-january-112112979.html",
  },
  {
    name: "Tokenized Treasuries (ONDO)",
    href: "https://www.cryptotimes.io/2026/05/07/today-in-crypto-tokenization-breakthrough-clarity-act-deadline-set-miners-pivot-to-ai-power-plays/",
  },
  {
    name: "Hyperliquid Whale Longs",
    href: "https://www.theblock.co/post/400302/bitcoin-whales-hyperliquid-net-long-positions-2026-high",
  },
];

export function FeaturedSidebar() {
  return (
    <div className="flex flex-col gap-6">
      {/* <MarketSignals /> */}
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
          <a
            key={i}
            href={topic.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 group"
          >
            <span className="w-4 text-sm font-bold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-sm group-hover:text-primary transition-colors">
              {topic.name}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}
