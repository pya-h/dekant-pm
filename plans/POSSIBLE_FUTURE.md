# Possible Future Work

Items not in MVP scope, tracked here for future consideration. Ordered by certainty/priority.

## Likely (V2 candidates)

- **Non-normal distribution families** — Log-normal, uniform, arbitrary PDFs for continuous markets. PRD explicitly defers to V2.
- **Decentralized / optimistic oracle** — Replace centralized oracle with dispute-based resolution.
- **Leaderboards & analytics dashboard** — Historical data aggregation and display. Indexer already stores the data.
- **API rate limiting & DDoS protection** — Production hardening beyond basic measures.
- **Mobile-optimized UI** — Responsive redesign targeting mobile wallets.

## Possible (architectural changes)

- **Partial resolution (Gnosis-style Condition Tokens)** — Instead of a single absolute winning outcome, the oracle resolves with fractional weights across outcomes (e.g., A=0.8, B=0.2). Each trader's payout becomes `sum(holdings[i] * weight[i])` rather than just `holdings[winner]`. This enables nuanced resolution where multiple outcomes can be "partially right." Requires changes to on-chain resolution logic (`resolved_outcome` becomes a weight vector), claim payout formula, and LP residual computation.
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
