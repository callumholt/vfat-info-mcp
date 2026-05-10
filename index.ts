#!/usr/bin/env node

/**
 * vfat MCP Server
 *
 * Wraps the public read API at https://info-api.vf.at/ that powers the vfat.io
 * info dashboard. No auth required.
 *
 * Endpoints discovered via HAR capture of https://info.vf.at:
 *   GET /chains                       -> list of supported chains
 *   GET /get-farm                     -> farm/pool details + rewards + assets
 *   GET /get-most-recent-token-prices -> bulk token prices (response is base64 JSON)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js"

const API_BASE = process.env.VFAT_API_BASE || "https://info-api.vf.at"

function log(level: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString()
  const line = data ? `[${ts}] ${level}: ${msg} ${JSON.stringify(data)}` : `[${ts}] ${level}: ${msg}`
  console.error(line)
}

async function apiGet(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const url = new URL(path, API_BASE)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
  }
  log("DEBUG", `GET ${url.toString()}`)
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      "user-agent": "vfat-mcp/0.1",
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`vfat API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  return res
}

/**
 * Some vfat endpoints (e.g. `/get-most-recent-token-prices`, `/daily-sickle-fees`)
 * return a base64-encoded JSON body — presumably for caching/CDN reasons.
 * This wrapper handles both plain JSON and base64-wrapped JSON transparently.
 */
async function fetchMaybeBase64Json(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
  const res = await apiGet(path, query)
  const body = await res.text()
  const trimmed = body.trim()
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return JSON.parse(trimmed)
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8")
  return JSON.parse(decoded)
}

/**
 * `/get-farms` returns ~40 MB of JSON. Cache with a short TTL so repeated
 * filtered queries don't re-download every call.
 */
let farmsCache: { fetchedAt: number; data: Array<Record<string, unknown>> } | null = null
const FARMS_CACHE_TTL_MS = 5 * 60 * 1000

async function getAllFarmsCached(): Promise<Array<Record<string, unknown>>> {
  const now = Date.now()
  if (farmsCache && now - farmsCache.fetchedAt < FARMS_CACHE_TTL_MS) {
    return farmsCache.data
  }
  const res = await apiGet("/get-farms")
  const json = (await res.json()) as unknown
  const arr = Array.isArray(json) ? (json as Array<Record<string, unknown>>) : []
  farmsCache = { fetchedAt: now, data: arr }
  return arr
}

const tools: Tool[] = [
  {
    name: "vfat_list_chains",
    description: "List chains supported by vfat.io (chain id, name, block explorer, active flag).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vfat_get_farm",
    description:
      "Fetch live + historical metrics for a vfat farm/pool. Returns one entry per timestamp in the requested window: TVL, swap fees (hourly/daily/weekly/monthly), reward emissions, underlying assets with reserves and prices, pool tick / fee tier, etc. Required: chainId, farmAddress, poolAddress.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "number", description: "EVM chain id, e.g. 8453 for Base." },
        farmAddress: { type: "string", description: "Gauge / farm contract address (0x...)." },
        poolAddress: { type: "string", description: "Underlying AMM pool address (0x...)." },
        startTime: {
          type: "string",
          description: "ISO 8601 timestamp. Defaults to 90 days ago.",
        },
        endTime: { type: "string", description: "ISO 8601 timestamp. Defaults to now." },
        groupByDay: {
          type: "boolean",
          description: "If true, server aggregates samples to daily buckets. Default false.",
        },
      },
      required: ["chainId", "farmAddress", "poolAddress"],
    },
  },
  {
    name: "vfat_list_farms",
    description:
      "Discover farms across all chains/protocols. Server returns the full catalogue (~40 MB) so this tool always filters client-side; you must supply at least one filter to keep the payload small. Cached for 5 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        chainId: { type: "number", description: "Filter to a single chain id (e.g. 8453 for Base)." },
        protocolId: {
          type: "string",
          description: "Filter to a protocol slug (e.g. 'aerodrome', 'uniswap-v3'). Case-insensitive.",
        },
        farmType: { type: "string", description: "Filter to a farm_type (e.g. 'AERO_SLIPSTREAM_GAUGE')." },
        tokenAddress: {
          type: "string",
          description: "Filter to farms whose underlying or reward tokens include this address.",
        },
        tokenSymbol: {
          type: "string",
          description: "Filter to farms whose underlying or reward tokens include this symbol (case-insensitive).",
        },
        minTvl: { type: "number", description: "Minimum TVL in USD (filters using sum of underlying reserves * price)." },
        limit: { type: "number", description: "Cap result count after filtering. Default 50." },
      },
    },
  },
  {
    name: "vfat_get_tvl_summary",
    description:
      "Headline TVL snapshot: global figure plus per-chain breakdown with TVL, user/position counts, and 24h/7d/1m % changes.",
    inputSchema: {
      type: "object",
      properties: {
        minTvl: { type: "number", description: "Drop chains below this TVL in USD. Default 0." },
      },
    },
  },
  {
    name: "vfat_get_tvl_by_chain",
    description: "Historical TVL series per chain (one row per chain per timestamp).",
    inputSchema: {
      type: "object",
      properties: {
        startTime: { type: "string", description: "ISO 8601. Defaults to 30 days ago." },
        endTime: { type: "string", description: "ISO 8601. Defaults to now." },
        groupByDay: { type: "boolean", description: "Daily aggregation. Default true." },
        chainId: { type: "number", description: "Optional client-side filter to a single chain id." },
      },
    },
  },
  {
    name: "vfat_get_total_tvl_range",
    description: "Aggregate vfat TVL across all chains over a time window.",
    inputSchema: {
      type: "object",
      properties: {
        startTime: { type: "string", description: "ISO 8601. Defaults to 30 days ago." },
        endTime: { type: "string", description: "ISO 8601. Defaults to now." },
        groupByDay: { type: "boolean", description: "Daily aggregation. Default true." },
      },
    },
  },
  {
    name: "vfat_get_recent_actions",
    description: "Live activity feed: latest deposits, exits, increases, harvests across all vfat positions.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vfat_get_action_volumes",
    description:
      "Daily action volumes by chain and action_type (deposited / exited / increased / harvested) with tx counts and inflow/outflow USD.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD. Defaults to 30 days ago." },
        endDate: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        groupByDay: { type: "boolean", description: "Default true." },
        chainId: { type: "number", description: "Optional client-side filter to a single chain id." },
        actionType: {
          type: "string",
          description: "Optional client-side filter: deposited | exited | increased | harvested.",
        },
      },
    },
  },
  {
    name: "vfat_get_positions_summary",
    description:
      "Per-owner summary across all vfat-tracked Sickles (~1.4 MB raw). Each row: owner_address, total_value (USD), position_count, sickles_by_chain (map of chainId -> sickle contract). Always filter to keep payload small.",
    inputSchema: {
      type: "object",
      properties: {
        ownerAddress: { type: "string", description: "Filter to a wallet address (case-insensitive exact match)." },
        chainId: {
          type: "number",
          description: "Keep only owners with a Sickle on this chain id.",
        },
        minValue: { type: "number", description: "Minimum total_value in USD." },
        sortByValue: {
          type: "boolean",
          description: "Sort descending by total_value before applying limit. Default true.",
        },
        limit: { type: "number", description: "Cap result count after filtering. Default 100." },
      },
    },
  },
  {
    name: "vfat_get_recent_token_prices",
    description:
      "Bulk dump of the most recent token prices vfat tracks (across every supported chain). Decodes vfat's base64-wrapped response. Optional symbol/address/chainId filters trim the payload client-side.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Filter to a single symbol (case-insensitive)." },
        address: { type: "string", description: "Filter to a single token address (case-insensitive)." },
        chainId: { type: "number", description: "Filter to a single chain id." },
        limit: { type: "number", description: "Cap result count after filtering. Default 200." },
      },
    },
  },
]

const server = new Server({ name: "vfat", version: "0.1.0" }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  try {
    switch (name) {
      case "vfat_list_chains": {
        const res = await apiGet("/chains")
        const json = await res.json()
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] }
      }

      case "vfat_get_farm": {
        const a = (args ?? {}) as Record<string, unknown>
        if (typeof a.chainId !== "number") throw new Error("chainId (number) required")
        if (typeof a.farmAddress !== "string") throw new Error("farmAddress (string) required")
        if (typeof a.poolAddress !== "string") throw new Error("poolAddress (string) required")
        const now = new Date()
        const start = (a.startTime as string | undefined) ?? new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString()
        const end = (a.endTime as string | undefined) ?? now.toISOString()
        const groupByDay = a.groupByDay === true
        const res = await apiGet("/get-farm", {
          chainId: a.chainId,
          farmAddress: a.farmAddress,
          poolAddress: a.poolAddress,
          startTime: start,
          endTime: end,
          groupByDay,
        })
        const json = await res.json()
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] }
      }

      case "vfat_list_farms": {
        const a = (args ?? {}) as Record<string, unknown>
        const all = await getAllFarmsCached()
        let out = all
        if (typeof a.chainId === "number") out = out.filter((f) => f.chain_id === a.chainId)
        if (typeof a.protocolId === "string") {
          const v = a.protocolId.toLowerCase()
          out = out.filter((f) => String(f.protocol_id ?? "").toLowerCase() === v)
        }
        if (typeof a.farmType === "string") {
          const v = a.farmType
          out = out.filter((f) => String(f.farm_type ?? "") === v)
        }
        const tokenSymbol = typeof a.tokenSymbol === "string" ? a.tokenSymbol.toLowerCase() : undefined
        const tokenAddress = typeof a.tokenAddress === "string" ? a.tokenAddress.toLowerCase() : undefined
        if (tokenSymbol || tokenAddress) {
          out = out.filter((f) => {
            const assets = (f.underlying_assets as Array<Record<string, unknown>> | undefined) ?? []
            const rewardSymbols = ((f.rewards as Array<Record<string, unknown>> | undefined) ?? []).map(
              (r) => (r.rewardToken as Record<string, unknown> | undefined)?.symbol,
            )
            const rewardAddrs = ((f.rewards as Array<Record<string, unknown>> | undefined) ?? []).map(
              (r) => (r.rewardToken as Record<string, unknown> | undefined)?.address,
            )
            const symbols = [...assets.map((u) => u.symbol), ...rewardSymbols].map((s) => String(s ?? "").toLowerCase())
            const addrs = [...assets.map((u) => u.address), ...rewardAddrs].map((s) => String(s ?? "").toLowerCase())
            if (tokenSymbol && !symbols.includes(tokenSymbol)) return false
            if (tokenAddress && !addrs.includes(tokenAddress)) return false
            return true
          })
        }
        if (typeof a.minTvl === "number") {
          const min = a.minTvl
          out = out.filter((f) => {
            const assets = (f.underlying_assets as Array<Record<string, unknown>> | undefined) ?? []
            let tvl = 0
            for (const asset of assets) {
              const reserve = Number(asset.reserve ?? 0)
              const decimals = Number(asset.decimals ?? 18)
              const price = Number(asset.price ?? 0)
              if (Number.isFinite(reserve) && Number.isFinite(price)) tvl += (reserve / 10 ** decimals) * price
            }
            return tvl >= min
          })
        }
        const limit = typeof a.limit === "number" ? a.limit : 50
        out = out.slice(0, limit)
        return {
          content: [{ type: "text", text: JSON.stringify({ count: out.length, total_in_catalogue: all.length, farms: out }, null, 2) }],
        }
      }

      case "vfat_get_tvl_summary": {
        const a = (args ?? {}) as Record<string, unknown>
        const minTvl = typeof a.minTvl === "number" ? a.minTvl : 0
        const [globalRes, byChainRes] = await Promise.all([
          apiGet("/get-most-recent-tvl"),
          apiGet("/get-most-recent-tvl-by-chain", { minTvl }),
        ])
        const global = await globalRes.json()
        const byChain = await byChainRes.json()
        return { content: [{ type: "text", text: JSON.stringify({ global, byChain }, null, 2) }] }
      }

      case "vfat_get_tvl_by_chain": {
        const a = (args ?? {}) as Record<string, unknown>
        const now = new Date()
        const start = (a.startTime as string | undefined) ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
        const end = (a.endTime as string | undefined) ?? now.toISOString()
        const groupbyday = a.groupByDay !== false
        const res = await apiGet("/get-tvl-by-chain", { startTime: start, endTime: end, groupbyday })
        let json = (await res.json()) as Array<Record<string, unknown>>
        if (typeof a.chainId === "number") json = json.filter((r) => r.chain_id === a.chainId)
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] }
      }

      case "vfat_get_total_tvl_range": {
        const a = (args ?? {}) as Record<string, unknown>
        const now = new Date()
        const start = (a.startTime as string | undefined) ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
        const end = (a.endTime as string | undefined) ?? now.toISOString()
        const groupbyday = a.groupByDay !== false
        const res = await apiGet("/get-total-tvl-by-range", { startTime: start, endTime: end, groupbyday })
        const json = await res.json()
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] }
      }

      case "vfat_get_recent_actions": {
        const res = await apiGet("/get-recent-actions")
        const json = await res.json()
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] }
      }

      case "vfat_get_action_volumes": {
        const a = (args ?? {}) as Record<string, unknown>
        const today = new Date().toISOString().slice(0, 10)
        const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
        const startDate = (a.startDate as string | undefined) ?? past
        const endDate = (a.endDate as string | undefined) ?? today
        const groupByDay = a.groupByDay !== false
        const res = await apiGet("/action-volumes", { startDate, endDate, groupByDay })
        let json = (await res.json()) as Array<Record<string, unknown>>
        if (typeof a.chainId === "number") json = json.filter((r) => r.chain_id === a.chainId)
        if (typeof a.actionType === "string") json = json.filter((r) => r.action_type === a.actionType)
        return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }] }
      }

      case "vfat_get_positions_summary": {
        const a = (args ?? {}) as Record<string, unknown>
        const res = await apiGet("/positions-summary")
        const raw = (await res.json()) as { count?: number; data?: Array<Record<string, unknown>> }
        let rows = Array.isArray(raw.data) ? raw.data : []
        const totalCount = typeof raw.count === "number" ? raw.count : rows.length
        if (typeof a.ownerAddress === "string") {
          const v = a.ownerAddress.toLowerCase()
          rows = rows.filter((r) => String(r.owner_address ?? "").toLowerCase() === v)
        }
        if (typeof a.chainId === "number") {
          const key = String(a.chainId)
          rows = rows.filter((r) => {
            const sbc = r.sickles_by_chain as Record<string, unknown> | undefined
            return sbc && Object.prototype.hasOwnProperty.call(sbc, key)
          })
        }
        if (typeof a.minValue === "number") {
          const min = a.minValue
          rows = rows.filter((r) => Number(r.total_value ?? 0) >= min)
        }
        if (a.sortByValue !== false) {
          rows = [...rows].sort((x, y) => Number(y.total_value ?? 0) - Number(x.total_value ?? 0))
        }
        const limit = typeof a.limit === "number" ? a.limit : 100
        const out = rows.slice(0, limit)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: out.length, total_in_catalogue: totalCount, owners: out }, null, 2),
            },
          ],
        }
      }

      case "vfat_get_recent_token_prices": {
        const a = (args ?? {}) as Record<string, unknown>
        const data = (await fetchMaybeBase64Json("/get-most-recent-token-prices")) as Array<Record<string, unknown>>
        let out = Array.isArray(data) ? data : []
        const symbol = typeof a.symbol === "string" ? a.symbol.toLowerCase() : undefined
        const address = typeof a.address === "string" ? a.address.toLowerCase() : undefined
        const chainId = typeof a.chainId === "number" ? a.chainId : undefined
        if (symbol) out = out.filter((t) => String(t.symbol ?? "").toLowerCase() === symbol)
        if (address) out = out.filter((t) => String(t.address ?? "").toLowerCase() === address)
        if (chainId !== undefined) out = out.filter((t) => t.chain_id === chainId)
        const limit = typeof a.limit === "number" ? a.limit : 200
        out = out.slice(0, limit)
        return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log("INFO", `vfat MCP server running on stdio (api=${API_BASE})`)
}

main().catch((err) => {
  log("ERROR", "Fatal", { message: err?.message, stack: err?.stack })
  process.exit(1)
})
