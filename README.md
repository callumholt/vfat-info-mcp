# vfat-info-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that
wraps the public read API at `https://info-api.vf.at` — the backend powering
[info.vf.at](https://info.vf.at), the official analytics dashboard for
[vfat.io](https://vfat.io) (Sickle DeFi position management across 35+ chains).

Lets an LLM (Claude Code, Claude Desktop, Cursor, etc.) query farm metrics,
TVL series, recent actions, and token prices as structured tool calls.

No auth is required — the endpoints are unauthenticated CORS GETs.

> **Unofficial.** Not affiliated with or endorsed by vfat.io. Endpoints were
> reverse-engineered from public network traffic and may change without notice.

## Tools

**Pool / farm**
- `vfat_list_chains` — supported chains.
- `vfat_get_farm({ chainId, farmAddress, poolAddress, startTime?, endTime?, groupByDay? })` —
  full farm/pool metrics: TVL, fees, reward emissions, underlying assets with
  reserves and prices, pool tick / fee tier. Default window: last 90 days.
- `vfat_list_farms({ chainId?, protocolId?, farmType?, tokenAddress?, tokenSymbol?, minTvl?, limit? })` —
  farm discovery. Server returns ~40 MB so this tool always filters
  client-side; supply at least one filter. 5-minute in-memory cache.

**TVL / activity**
- `vfat_get_tvl_summary({ minTvl? })` — global TVL plus per-chain breakdown
  (TVL, user/position counts, 24h/7d/1m % changes).
- `vfat_get_tvl_by_chain({ startTime?, endTime?, groupByDay?, chainId? })` —
  historical TVL series per chain.
- `vfat_get_total_tvl_range({ startTime?, endTime?, groupByDay? })` —
  aggregate TVL series across all chains.
- `vfat_get_recent_actions()` — latest deposits / exits / increases / harvests.
- `vfat_get_action_volumes({ startDate?, endDate?, groupByDay?, chainId?, actionType? })` —
  daily action volumes by chain and action_type with tx counts and
  inflow/outflow USD.
- `vfat_get_positions_summary({ chainId?, ownerAddress?, protocolId?, limit? })` —
  per-position summary (~1.4 MB raw, always filtered client-side).

**Tokens**
- `vfat_get_recent_token_prices({ symbol?, address?, chainId?, limit? })` —
  bulk price feed across every supported chain. Decodes vfat's base64-wrapped
  response and filters client-side.

## Setup

```bash
git clone https://github.com/callumholt/vfat-info-mcp.git
cd vfat-info-mcp
pnpm install        # or: npm install
pnpm build          # or: npm run build
```

Register with Claude Code by adding to `.mcp.json` (project) or
`~/.claude.json` (global):

```json
{
  "mcpServers": {
    "vfat": {
      "command": "node",
      "args": ["/absolute/path/to/vfat-info-mcp/build/index.js"]
    }
  }
}
```

For Claude Desktop, add the same entry under `mcpServers` in
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).

## Endpoint reference

All endpoints discovered via HAR capture of pages on
`https://info.vf.at`. Two of them return base64-encoded JSON bodies; this
server decodes transparently.

| Endpoint | Wrapped by tool |
|---|---|
| `GET /chains` | `vfat_list_chains` |
| `GET /get-farm` | `vfat_get_farm` |
| `GET /get-farms` (~40 MB; cached + filtered client-side) | `vfat_list_farms` |
| `GET /get-most-recent-tvl` + `/get-most-recent-tvl-by-chain` | `vfat_get_tvl_summary` |
| `GET /get-tvl-by-chain` | `vfat_get_tvl_by_chain` |
| `GET /get-total-tvl-by-range` | `vfat_get_total_tvl_range` |
| `GET /get-recent-actions` | `vfat_get_recent_actions` |
| `GET /action-volumes` | `vfat_get_action_volumes` |
| `GET /positions-summary` | `vfat_get_positions_summary` |
| `GET /get-most-recent-token-prices` (base64) | `vfat_get_recent_token_prices` |

## Example

Sample farm — USDC/cbBTC Aerodrome Slipstream gauge on Base:

```
chainId      8453
farmAddress  0x6399ed6725cc163d019aa64ff55b22149d7179a8
poolAddress  0x4e962bb3889bf030368f56810a9c96b83cb3e778
```

## Contributing

Issues and PRs welcome. If you spot a new `info-api.vf.at` endpoint that isn't
wrapped, capture a HAR (DevTools → Network → Save all as HAR) and open an issue
with the request URL plus a sample response.

## Licence

MIT — see [LICENSE](LICENSE).
