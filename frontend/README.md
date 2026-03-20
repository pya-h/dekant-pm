# DekantPM Frontend

The web frontend for the DekantPM prediction market protocol. Built with [Next.js](https://nextjs.org/) 16 (App Router, Turbopack), React 19, Tailwind 4, and shadcn/ui.

The frontend provides the trading interface for all three market types (binary, multi-outcome, continuous), portfolio management, admin controls, and oracle resolution. It connects directly to Solana wallets for transaction signing and reads market data from the backend API.

## Live Deployment

| Environment | URL |
|-------------|-----|
| **Production** | https://dekant.pyron.fi/ |
| Network | Solana **devnet** |

## Directory Structure

```
frontend/
├── app/                             # Next.js App Router
│   ├── layout.tsx                   # Root layout (providers, navbar, footer)
│   ├── page.tsx                     # / — Landing page (hero + features)
│   ├── globals.css                  # Tailwind 4 config + CSS variables (oklch)
│   ├── error.tsx                    # Global error boundary
│   ├── markets/
│   │   ├── page.tsx                 # /markets — Market grid with filters
│   │   └── [id]/page.tsx            # /markets/:id — Market detail + trading
│   ├── portfolio/page.tsx           # /portfolio — User positions & PnL
│   ├── admin/
│   │   ├── page.tsx                 # /admin — Role/fee/pause management
│   │   └── create-market/page.tsx   # /admin/create-market — Multi-step wizard
│   └── oracle/page.tsx              # /oracle — Resolve pending markets
│
├── components/
│   ├── ui/                          # shadcn/ui primitives (11 components)
│   │   ├── badge.tsx, button.tsx, card.tsx, dialog.tsx
│   │   ├── dropdown-menu.tsx, input.tsx, slider.tsx
│   │   ├── tabs.tsx, textarea.tsx, tooltip.tsx, sonner.tsx
│   │
│   ├── providers/
│   │   ├── theme-provider.tsx       # Dark mode (next-themes)
│   │   └── solana-provider.tsx      # Wallet adapters + React Query
│   │
│   ├── layout/
│   │   ├── navbar.tsx               # Sticky header with nav + wallet button
│   │   └── footer.tsx               # Footer with network badge
│   │
│   ├── common/
│   │   ├── wallet-button.tsx        # Dynamic wallet connect button (no SSR)
│   │   └── transaction-toast.tsx    # Toast notifications for trades
│   │
│   ├── market/
│   │   ├── market-card.tsx          # Market card (grid view)
│   │   ├── market-status.tsx        # State badge (Active/Paused/Resolved)
│   │   ├── market-type-badge.tsx    # Type badge (Binary/Multi/Continuous)
│   │   ├── price-bar.tsx            # Probability bars (binary & multi)
│   │   └── distribution-chart.tsx   # SVG histogram (continuous markets)
│   │
│   ├── trading/
│   │   ├── trading-panel.tsx        # Main buy/sell UI
│   │   ├── binary-input.tsx         # Binary outcome selector
│   │   ├── multi-outcome-input.tsx  # Multi-outcome dropdown
│   │   ├── distribution-input.tsx   # Continuous mu/sigma inputs
│   │   ├── cost-preview.tsx         # Real-time AMM price estimation
│   │   └── user-position-display.tsx # Current position info
│   │
│   ├── portfolio/
│   │   ├── position-card.tsx        # Position summary with PnL
│   │   └── claim-button.tsx         # Claim payout for resolved markets
│   │
│   ├── admin/
│   │   ├── role-manager.tsx         # Assign/revoke roles
│   │   ├── fee-config.tsx           # Configure protocol fees
│   │   └── pause-controls.tsx       # Pause/unpause markets
│   │
│   ├── create-market/
│   │   ├── create-market-form.tsx   # Form wrapper & step state
│   │   ├── step-type-selection.tsx  # Choose Binary/Multi/Continuous
│   │   ├── step-question-details.tsx # Title, description, category
│   │   ├── step-outcomes.tsx        # Outcome labels
│   │   ├── step-parameters.tsx      # Deadline, range, initial distribution
│   │   └── step-review.tsx          # Review and confirm
│   │
│   └── oracle/
│       └── resolve-form.tsx         # Resolve market form
│
├── hooks/
│   ├── use-markets.ts               # Fetch market list with filters
│   ├── use-market.ts                # Fetch single market detail
│   ├── use-positions.ts             # Fetch all user positions
│   ├── use-user-position.ts         # Fetch single market position
│   ├── use-auth.ts                  # Wallet signature auth flow
│   ├── use-admin-role.ts            # Check user roles
│   ├── use-admin-roles.ts           # Fetch all roles (admin)
│   ├── use-protocol-config.ts       # Fetch protocol config
│   └── use-token-balance.ts         # Fetch USDC balance
│
├── lib/
│   ├── types.ts                     # Frontend type definitions + SCALE constant
│   ├── api.ts                       # Fetch-based API client (timeout, auth)
│   ├── env.ts                       # Environment variable validation
│   ├── solana.ts                    # PDA derivation + useProgram hook
│   ├── transactions.ts              # Transaction builders (buy, sell, claim)
│   ├── admin-transactions.ts        # Admin/oracle transaction builders
│   ├── normal.ts                    # Normal distribution utility
│   ├── utils.ts                     # cn() helper (clsx + tailwind-merge)
│   ├── program/
│   │   └── dekant_pm.ts             # IDL types (generated from Anchor)
│   └── schemas/
│       └── create-market-schema.ts  # Zod validation for create-market form
│
├── public/                          # Static assets
├── package.json
├── pnpm-lock.yaml
├── next.config.ts                   # Turbopack config, crypto polyfill
├── tsconfig.json
├── postcss.config.mjs
├── components.json                  # shadcn/ui config
├── Dockerfile                       # Multi-stage production build
├── .env.local                       # Development env vars
├── .env.production                  # Production env vars
└── .env.example                     # Template
```

## Pages

### `/` — Landing Page

Hero section introducing the protocol with feature cards highlighting distribution trading, market types, and the AMM.

### `/markets` — Market Discovery

Grid of market cards with:
- **Search** — Title text search (ILIKE)
- **Filters** — Category, market type (binary/multi/continuous), state (active/paused/resolved)
- **Sorting** — Newest, deadline, volume
- **Pagination** — Page-based with configurable limit

Each card shows title, probability visualization, volume, and time remaining.

### `/markets/:id` — Market Detail & Trading

Full market view with:
- Market metadata (title, description, category, deadline)
- **Probability visualization** — Stacked bars for binary/multi, SVG histogram for continuous
- **Trading panel** — Buy/sell tabs with:
  - Binary: outcome radio buttons + collateral amount
  - Multi: outcome dropdown + collateral amount
  - Continuous: mu/sigma sliders + collateral amount
- **Cost preview** — Real-time AMM estimation (tokens out, fee, new probabilities)
- **User position** — Current holdings, PnL, estimated payout
- **Trade history** — Paginated list of recent trades

### `/portfolio` — Portfolio Management

All user positions grouped by status:
- **Active** — Open positions in active markets
- **Claimable** — Positions in resolved markets with unclaimed payouts
- **Past** — Claimed or zero-value positions

Each position card shows holdings, estimated value, PnL, and a claim button when applicable.

### `/admin` — Admin Dashboard

Requires Admin or Superadmin role. Features:
- **Role Manager** — View, assign, and revoke Admin/Oracle/Creator roles
- **Fee Configuration** — Adjust protocol fee parameters (superadmin only)
- **Pause Controls** — Pause/unpause individual markets

### `/admin/create-market` — Market Creation

Multi-step wizard requiring Creator+ role:
1. **Type Selection** — Binary, Multi-outcome, or Continuous
2. **Question Details** — Title, description, category, image URL
3. **Outcomes** — Outcome labels (binary/multi) or range min/max (continuous)
4. **Parameters** — Deadline, initial liquidity, number of bins (continuous)
5. **Review** — Final confirmation before on-chain transaction

### `/oracle` — Oracle Dashboard

Requires Oracle role. Shows:
- Pending markets awaiting resolution
- Resolution form (outcome index for discrete, value for continuous)
- Recent resolution history

## Data Flow

### State Management

- **React Query (TanStack Query v5)** — All server state (markets, positions, roles)
- **React hooks (useState)** — Local UI state (filters, form inputs, loading)
- **Wallet Adapter** — Solana wallet connection state

### API Client

Custom fetch-based client (`lib/api.ts`) with:
- 15-second timeout via AbortController
- Automatic JWT injection for authenticated requests
- Typed `ApiError` class with status/message

### Probabilities

Probabilities are **computed client-side**, not returned by the backend list endpoint:

```typescript
// From lib/types.ts
function computeProbabilities(reserves: string[], totalMinted: string): number[] {
  // price[i] = (totalMinted - reserves[i])^2 / totalMinted^2
}
```

### On-Chain Transactions

All state mutations go directly to the Solana program via wallet:

1. Frontend builds the transaction using Anchor program methods
2. Wallet adapter prompts user to sign
3. Transaction is sent to Solana RPC
4. Backend indexer picks up the on-chain event and updates the cache
5. React Query refetches after a short delay

Transaction builders are in `lib/transactions.ts` (trading, claims) and `lib/admin-transactions.ts` (admin, oracle).

## Provider Hierarchy

The app wraps all pages in a strict provider stack (defined in `app/layout.tsx`):

```
ThemeProvider (dark mode)
  └── SolanaProvider
        └── QueryClientProvider (React Query)
              └── ConnectionProvider (Solana RPC)
                    └── WalletProvider (Phantom, Solflare)
                          └── WalletModalProvider
                                └── TooltipProvider
                                      └── Navbar + {children} + Footer + Toaster
```

## Wallet Integration

**Supported wallets:** Phantom, Solflare (via `@solana/wallet-adapter-wallets`)

**PDA derivation** (`lib/solana.ts`):
- `deriveProtocolConfig()` — seed: `"protocol_config"`
- `deriveMarket(marketId)` — seed: `"market"` + market_id (u64 LE)
- `deriveVaultAuthority(marketPubkey)` — seed: `"vault_authority"` + market pubkey
- `deriveUserPosition(market, user)` — seed: `"user_position"` + market + user
- `deriveLpPosition(market, user)` — seed: `"lp_position"` + market + user
- `deriveUserRole(user, role)` — seed: `"user_role"` + user + role (u8)

**Authentication flow:**
1. `POST /auth/challenge` with wallet address
2. Wallet signs the challenge message
3. `POST /auth/verify` with signature (base64) and nonce
4. JWT cached in hook state for 55 minutes

## Styling

### Tailwind 4 (CSS-first)

No `tailwind.config.ts` — all configuration is in `globals.css` using `@theme inline`.

### Color System

Colors use **oklch** (not hsl) for perceptual uniformity:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.141 0.005 285.823);
  --primary: oklch(0.21 0.006 285.885);
  /* ... */
}
.dark {
  --background: oklch(0.141 0.005 285.823);
  --foreground: oklch(0.985 0 0);
  /* ... */
}
```

### Dark Mode

Always-on dark mode via `next-themes`:
- `defaultTheme="dark"`, `enableSystem={false}`
- Class-based switching: `@custom-variant dark (&:is(.dark *))`

### Component Library

shadcn/ui with Zinc base palette, Lucide React icons, and `class-variance-authority` for component variants. The `cn()` helper combines `clsx` + `tailwind-merge` for safe class composition.

### Responsive Design

Mobile-first grid layout:
- 1 column on mobile, 2 on `sm`, 3 on `lg`
- Max width `max-w-7xl` (80rem)
- Responsive padding: `px-4 sm:px-6 lg:px-8`

## Key Types

### SCALE

On-chain values use SCALE = 10^9 fixed-point:

```typescript
export const SCALE = 1_000_000_000;
export const USDC_DECIMALS = 6;

// Display range values: Number(market.rangeMin) / SCALE
// Send mu/sigma to chain: value * SCALE
```

### Backend Response Shape

```typescript
// Paginated responses
{ data: T[], total: number }   // page/limit/hasMore computed locally

// Market IDs are strings (bigint PK)
market.id = "42"               // NOT market.marketId

// Dates are ISO 8601 strings
market.deadline = "2026-12-31T00:00:00.000Z"   // NOT unix seconds
```

## Getting Started

### Prerequisites

- **Node.js** v20.18+ (v23.3.0 recommended for Turbopack)
- **pnpm** (package manager)

### Install & Run

```bash
cd frontend

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your RPC URL, backend URL, program ID

# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

The frontend starts on port 3000 by default.

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_RPC_URL` | Solana RPC endpoint | `http://localhost:8899` or devnet URL |
| `NEXT_PUBLIC_BACKEND_URL` | Backend API URL | `http://localhost:4000` |
| `NEXT_PUBLIC_PROGRAM_ID` | DekantPM program ID | `F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL` |
| `NEXT_PUBLIC_NETWORK` | Network label | `localnet`, `devnet`, or `mainnet` |

## Docker

```bash
docker build -t dekant-frontend \
  --build-arg NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com \
  --build-arg NEXT_PUBLIC_BACKEND_URL=https://dekant-api.pyron.fi \
  --build-arg NEXT_PUBLIC_PROGRAM_ID=F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL \
  --build-arg NEXT_PUBLIC_NETWORK=devnet \
  .

docker run -p 3000:3000 dekant-frontend
```

Multi-stage build: deps install (pnpm) -> Next.js build (Turbopack) -> standalone output (`node server.js`). Based on `node:20-slim`.

## Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `next` | 16.1.6 | App Router, SSR, Turbopack bundler |
| `react` | 19.2.3 | UI framework |
| `@coral-xyz/anchor` | 0.32.1 | Solana program interaction |
| `@solana/web3.js` | 1.98.4 | Solana blockchain RPC |
| `@solana/wallet-adapter-react` | 0.15.39 | Wallet connection hooks |
| `@tanstack/react-query` | 5.90.21 | Server state management |
| `next-themes` | 0.4.6 | Dark mode |
| `react-hook-form` + `zod` | 7.x + 4.x | Form state + schema validation |
| `tailwind-merge` + `clsx` | 3.x + 2.x | Class composition |
| `lucide-react` | 0.575.0 | SVG icons |
| `sonner` | 2.0.7 | Toast notifications |

## NPM Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Development server (localhost:3000) |
| `pnpm build` | Production build (Turbopack) |
| `pnpm start` | Start production server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check (`tsc --noEmit`) |

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **Client-side probability computation** | Backend list endpoint doesn't include probabilities; computed from cached reserves to reduce payload |
| **Direct wallet transactions** | Frontend signs and sends transactions directly to Solana; backend is read-only |
| **React Query for server state** | Automatic caching, refetching, and stale-while-revalidate; no Redux needed |
| **Always-dark theme** | Matches crypto/trading UI conventions; eliminates light-mode styling overhead |
| **oklch colors** | Better perceptual uniformity than hsl; native CSS support in modern browsers |
| **pnpm** | Strict dependency resolution, faster installs, disk efficiency |
| **Standalone output** | `output: "standalone"` in next.config for minimal Docker images |
| **Lazy wallet button** | `dynamic(() => import(...), { ssr: false })` prevents SSR hydration mismatch |

## License

All rights reserved.
