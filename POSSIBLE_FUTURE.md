# Possible Future Work

Items not in MVP scope, tracked here for future consideration. Ordered by certainty/priority.

## Likely (V2 candidates)

- **Non-normal distribution families** — Log-normal, uniform, arbitrary PDFs for continuous markets. PRD explicitly defers to V2.
- **Decentralized / optimistic oracle** — Replace centralized oracle with dispute-based resolution.
- **Leaderboards & analytics dashboard** — Historical data aggregation and display. Indexer already stores the data.
- **API rate limiting & DDoS protection** — Production hardening beyond basic measures.
- **Mobile-optimized UI** — Responsive redesign targeting mobile wallets.

## Possible (architectural changes)

- **Hybrid transaction flow** — Backend constructs transactions, frontend signs and submits. Gives server-side validation (enforce business rules, prevent bad inputs before hitting chain) without custody. Adds one round-trip but keeps self-custody. Would require a new backend module that builds and serializes Solana transactions, plus frontend changes to receive and sign them.
- **Orderbook / hybrid AMM** — Add limit orders alongside the AMM. Significant complexity.
- **Conditional markets** — "If X, what will Y be?" dependency graphs between markets.
- **Multi-collateral per market** — Allow markets to accept multiple token types.

## Exploratory (low certainty)

- **Cross-chain support** — Extend beyond Solana (bridging, multi-chain deployment).
- **MEV protection** — Commit-reveal or batched execution to prevent frontrunning.
- **Governance token** — Protocol economics and token-based governance.
- **Market cancellation** — Full fund return mechanism (currently only pause is supported).
- **Free (non-financial) participation** — Prediction without financial stake.
