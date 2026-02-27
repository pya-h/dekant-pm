# F-10: Admin Dashboard — Implementation Plan

## Overview
Build the admin panel for role management, fee configuration, and market pause/unpause controls. Requires a lightweight auth flow (JWT) for the backend role-list endpoint, plus on-chain admin role checking.

## New Files (9)

### 1. `hooks/use-auth.ts` — JWT authentication hook
- Challenge/sign/verify flow for backend API auth
- Module-level token cache keyed by wallet address (55-min TTL)
- Exposes: `{ token, isAuthenticated, isAuthenticating, authenticate, error }`

### 2. `hooks/use-admin-role.ts` — On-chain admin/superadmin check
- Reads ProtocolConfig to check superadmin, fetches UserRole PDA for Admin role
- Exposes: `{ isSuperadmin, isAdmin, isAuthorized, isLoading }`

### 3. `hooks/use-protocol-config.ts` — Read on-chain ProtocolConfig
- Fetches fee values (creationFeeBps, tradeFeeBps, redemptionFeeBps, lpFeeShareBps)
- Used by FeeConfig component

### 4. `hooks/use-admin-roles.ts` — Backend GET /admin/roles
- Authenticated fetch of role list using JWT token
- Returns `UserRoleEntry[]` (id, userAddress, role, assignedBy, assignedAt)

### 5. `lib/admin-transactions.ts` — 5 admin transaction builders
- `executeAssignRole(program, authority, targetUser, role, isSuperadmin)`
- `executeRevokeRole(program, authority, targetUser, role, isSuperadmin)`
- `executeUpdateFees(program, authority, fees)`
- `executePauseMarket(program, authority, marketPubkey, isSuperadmin)`
- `executeUnpauseMarket(program, authority, marketPubkey, isSuperadmin)`
- Each returns `Promise<string>` (tx signature), follows existing transactions.ts pattern
- `authorityRole` is `null` for superadmin, derived Admin PDA otherwise

### 6. `components/admin/role-manager.tsx` — Role list + assign/revoke
- Top: Assign form (wallet address input, role select, submit button)
- Bottom: Role list table (address, role badge, assigned by, date, revoke button)
- Admin can assign Oracle/Creator; Superadmin can also assign Admin
- After tx success: invalidate queries + "may take a moment to update" note

### 7. `components/admin/fee-config.tsx` — Fee display + update (superadmin only)
- 4 number inputs: creation/trade/redemption fee bps (max 5000), LP share bps (max 10000)
- Prefilled with current on-chain values from useProtocolConfig
- "Update Fees" button → executeUpdateFees tx

### 8. `components/admin/pause-controls.tsx` — Market pause/unpause
- Lists all markets using existing useMarkets hook
- Active markets get "Pause" button, Paused get "Unpause" button
- PendingResolution/Resolved markets shown but no action available
- Uses `market.pubkey` directly (no PDA derivation needed)

### 9. `app/admin/page.tsx` — Main admin page
- Wallet guard → Role check → Auth flow → Tabbed layout (Roles | Fees | Controls)
- Fees tab only visible to superadmin
- Auto-authenticates on mount once role is confirmed
- Follows portfolio/page.tsx layout pattern exactly

## Modified Files (3)

### 1. `lib/api.ts` — Add token param to `get()`
- Add optional `token?: string` parameter
- Adds `Authorization: Bearer` header when token provided

### 2. `lib/types.ts` — Add UserRoleEntry interface
- `{ id, userAddress, role, assignedBy, assignedAt }` matching backend entity

### 3. `components/layout/navbar.tsx` — Enable Admin link
- Remove `soon: true` from the Admin nav entry

## Implementation Order
1. `lib/types.ts` + `lib/api.ts` (foundational changes)
2. `lib/admin-transactions.ts` (tx builders, no UI dependency)
3. `hooks/use-auth.ts` + `hooks/use-admin-role.ts` + `hooks/use-protocol-config.ts` + `hooks/use-admin-roles.ts`
4. `components/admin/role-manager.tsx` + `fee-config.tsx` + `pause-controls.tsx`
5. `app/admin/page.tsx`
6. `navbar.tsx` (enable link last)
7. Build check (`pnpm next build`)
