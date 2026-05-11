/**
 * On-chain helpers for decoding Uniswap V3 / Aerodrome Slipstream LP positions.
 *
 * Two NPM (NonfungiblePositionManager) flavours are supported because their
 * `positions(uint256)` tuple differs:
 *   - Uniswap V3:           ... uint24 fee, int24 tickLower ...
 *   - Aerodrome Slipstream: ... int24 tickSpacing, int24 tickLower ...
 */
import {
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
} from "viem"

export const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  130: "https://unichain-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  146: "https://sonic.drpc.org",
  252: "https://rpc.frax.com",
  480: "https://worldchain-mainnet.g.alchemy.com/public",
  5000: "https://rpc.mantle.xyz",
  8453: "https://base-rpc.publicnode.com",
  34443: "https://mainnet.mode.network",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  42220: "https://forno.celo.org",
  43114: "https://avalanche-c-chain-rpc.publicnode.com",
  57073: "https://rpc-gel.inkonchain.com",
  59144: "https://linea-rpc.publicnode.com",
  80094: "https://rpc.berachain.com",
  534352: "https://rpc.scroll.io",
}

export type NpmAbiKind = "uniswap-v3" | "aerodrome-slipstream"

export interface KnownManager {
  address: Address
  protocol: string
  abi: NpmAbiKind
}

/**
 * Curated list of NonfungiblePositionManager contracts per chain.
 * Extend as needed. Addresses are EIP-55 checksummed.
 */
function npm(address: string, protocol: string, abi: NpmAbiKind): KnownManager {
  return { address: getAddress(address), protocol, abi }
}

export const KNOWN_NFT_MANAGERS: Record<number, KnownManager[]> = {
  1: [npm("0xc36442b4a4522e871399cd717abdd847ab11fe88", "uniswap-v3", "uniswap-v3")],
  10: [
    npm("0xc36442b4a4522e871399cd717abdd847ab11fe88", "uniswap-v3", "uniswap-v3"),
    npm("0x416b433906b1b72fa758e166e239c43d68dc6f29", "velodrome-slipstream", "aerodrome-slipstream"),
  ],
  8453: [
    npm("0x827922686190790b37229fd06084350e74485b72", "aerodrome-slipstream", "aerodrome-slipstream"),
    npm("0x03a520b32c04bf3beef7beb72e919cf822ed34f1", "uniswap-v3", "uniswap-v3"),
  ],
  42161: [npm("0xc36442b4a4522e871399cd717abdd847ab11fe88", "uniswap-v3", "uniswap-v3")],
  137: [npm("0xc36442b4a4522e871399cd717abdd847ab11fe88", "uniswap-v3", "uniswap-v3")],
}

export const UNI_V3_NPM_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
])

export const AERO_SLIPSTREAM_NPM_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
])

export const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
])

export const POOL_VIEW_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
])

// Event ABIs for decoding tx receipts
export const POOL_MINT_EVENT = parseAbi([
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
])
export const POOL_BURN_EVENT = parseAbi([
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
])
export const POOL_COLLECT_EVENT = parseAbi([
  "event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)",
])
export const NPM_INCREASE_EVENT = parseAbi([
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
])
export const NPM_DECREASE_EVENT = parseAbi([
  "event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
])
export const NPM_COLLECT_EVENT = parseAbi([
  "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
])

export const TOPICS = {
  POOL_MINT: "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",
  POOL_BURN: "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c",
  POOL_COLLECT: "0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0",
  NPM_INCREASE: "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f",
  NPM_DECREASE: "0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4",
  NPM_COLLECT: "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01",
} as const

export function makeClient(chainId: number, rpcUrl?: string): PublicClient {
  const url = rpcUrl ?? DEFAULT_RPC_URLS[chainId]
  if (!url) {
    throw new Error(`No default RPC for chainId ${chainId}; pass rpcUrl explicitly.`)
  }
  return createPublicClient({ transport: http(url) }) as PublicClient
}

/**
 * Convert a tick to a human price ratio (token1 per token0).
 *   raw = 1.0001^tick                                  (token1 per token0 in raw units)
 *   human = raw * 10^(dec0 - dec1)
 *
 * If you want token0 per token1 (e.g. USDC per cbBTC when USDC is token0),
 * invert the result with 1/x.
 */
export function tickToPrice1Per0(tick: number, decimals0: number, decimals1: number): number {
  return 1.0001 ** tick * 10 ** (decimals0 - decimals1)
}

const erc20Cache = new Map<string, { symbol: string; decimals: number; name: string }>()

export async function getErc20(client: PublicClient, address: Address, chainId: number) {
  const key = `${chainId}:${address.toLowerCase()}`
  const hit = erc20Cache.get(key)
  if (hit) return hit
  const [symbol, decimals, name] = await Promise.all([
    client
      .readContract({ address, abi: ERC20_ABI, functionName: "symbol" })
      .then((v) => String(v))
      .catch(() => "UNKNOWN"),
    client
      .readContract({ address, abi: ERC20_ABI, functionName: "decimals" })
      .then((v) => Number(v))
      .catch(() => 18),
    client
      .readContract({ address, abi: ERC20_ABI, functionName: "name" })
      .then((v) => String(v))
      .catch(() => "Unknown"),
  ])
  const out = { symbol, decimals, name }
  erc20Cache.set(key, out)
  return out
}

export type DecodedPosition = {
  tokenId: string
  nft_manager: Address
  protocol: string
  token0: { address: Address; symbol: string; decimals: number }
  token1: { address: Address; symbol: string; decimals: number }
  fee?: number
  tickSpacing?: number
  tickLower: number
  tickUpper: number
  liquidity: string
  tokensOwed0: string
  tokensOwed1: string
  /** token1 per token0 at tickLower (human units) */
  priceLower_1per0: number
  /** token1 per token0 at tickUpper (human units) */
  priceUpper_1per0: number
  /** token0 per token1 at tickLower (often more intuitive when token0 is the stable) */
  priceLower_0per1: number
  priceUpper_0per1: number
  /** Whether liquidity > 0 (false ⇒ position has been fully withdrawn) */
  active: boolean
}

export async function readPosition(
  client: PublicClient,
  manager: KnownManager,
  tokenId: bigint,
  chainId: number,
): Promise<DecodedPosition> {
  if (manager.abi === "aerodrome-slipstream") {
    const r = (await client.readContract({
      address: manager.address,
      abi: AERO_SLIPSTREAM_NPM_ABI,
      functionName: "positions",
      args: [tokenId],
    })) as readonly [
      bigint,
      Address,
      Address,
      Address,
      number,
      number,
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]
    const [, , token0Addr, token1Addr, tickSpacing, tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] = r
    const [t0, t1] = await Promise.all([
      getErc20(client, token0Addr, chainId),
      getErc20(client, token1Addr, chainId),
    ])
    const pL = tickToPrice1Per0(tickLower, t0.decimals, t1.decimals)
    const pU = tickToPrice1Per0(tickUpper, t0.decimals, t1.decimals)
    return {
      tokenId: tokenId.toString(),
      nft_manager: manager.address,
      protocol: manager.protocol,
      token0: { address: token0Addr, symbol: t0.symbol, decimals: t0.decimals },
      token1: { address: token1Addr, symbol: t1.symbol, decimals: t1.decimals },
      tickSpacing,
      tickLower,
      tickUpper,
      liquidity: liquidity.toString(),
      tokensOwed0: tokensOwed0.toString(),
      tokensOwed1: tokensOwed1.toString(),
      priceLower_1per0: pL,
      priceUpper_1per0: pU,
      priceLower_0per1: 1 / pL,
      priceUpper_0per1: 1 / pU,
      active: liquidity > 0n,
    }
  }

  const r = (await client.readContract({
    address: manager.address,
    abi: UNI_V3_NPM_ABI,
    functionName: "positions",
    args: [tokenId],
  })) as readonly [
    bigint,
    Address,
    Address,
    Address,
    number,
    number,
    number,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ]
  const [, , token0Addr, token1Addr, fee, tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] = r
  const [t0, t1] = await Promise.all([
    getErc20(client, token0Addr, chainId),
    getErc20(client, token1Addr, chainId),
  ])
  const pL = tickToPrice1Per0(tickLower, t0.decimals, t1.decimals)
  const pU = tickToPrice1Per0(tickUpper, t0.decimals, t1.decimals)
  return {
    tokenId: tokenId.toString(),
    nft_manager: manager.address,
    protocol: manager.protocol,
    token0: { address: token0Addr, symbol: t0.symbol, decimals: t0.decimals },
    token1: { address: token1Addr, symbol: t1.symbol, decimals: t1.decimals },
    fee,
    tickLower,
    tickUpper,
    liquidity: liquidity.toString(),
    tokensOwed0: tokensOwed0.toString(),
    tokensOwed1: tokensOwed1.toString(),
    priceLower_1per0: pL,
    priceUpper_1per0: pU,
    priceLower_0per1: 1 / pL,
    priceUpper_0per1: 1 / pU,
    active: liquidity > 0n,
  }
}

/**
 * Walk through every token owned by `owner` under `manager` and return decoded positions.
 */
export async function listPositionsForManager(
  client: PublicClient,
  manager: KnownManager,
  owner: Address,
  chainId: number,
): Promise<DecodedPosition[]> {
  const abi = manager.abi === "aerodrome-slipstream" ? AERO_SLIPSTREAM_NPM_ABI : UNI_V3_NPM_ABI
  const balance = (await client.readContract({
    address: manager.address,
    abi,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint
  const count = Number(balance)
  if (count === 0) return []
  const tokenIds = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      client.readContract({
        address: manager.address,
        abi,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, BigInt(i)],
      }) as Promise<bigint>,
    ),
  )
  return Promise.all(tokenIds.map((id) => readPosition(client, manager, id, chainId)))
}

export type DecodedLpEvent =
  | {
      kind: "pool_mint"
      pool_address: Address
      owner: Address
      tickLower: number
      tickUpper: number
      liquidity: string
      amount0_raw: string
      amount1_raw: string
      logIndex: number
    }
  | {
      kind: "pool_burn"
      pool_address: Address
      owner: Address
      tickLower: number
      tickUpper: number
      liquidity: string
      amount0_raw: string
      amount1_raw: string
      logIndex: number
    }
  | {
      kind: "pool_collect"
      pool_address: Address
      owner: Address
      recipient: Address
      tickLower: number
      tickUpper: number
      amount0_raw: string
      amount1_raw: string
      logIndex: number
    }
  | {
      kind: "npm_increase_liquidity"
      nft_manager: Address
      tokenId: string
      liquidity: string
      amount0_raw: string
      amount1_raw: string
      logIndex: number
    }
  | {
      kind: "npm_decrease_liquidity"
      nft_manager: Address
      tokenId: string
      liquidity: string
      amount0_raw: string
      amount1_raw: string
      logIndex: number
    }
  | {
      kind: "npm_collect"
      nft_manager: Address
      tokenId: string
      recipient: Address
      amount0_raw: string
      amount1_raw: string
      logIndex: number
    }

export function decodeLpLogs(logs: readonly Log[]): DecodedLpEvent[] {
  const out: DecodedLpEvent[] = []
  for (const log of logs) {
    const sig = log.topics[0]
    if (!sig) continue
    const logIndex = Number(log.logIndex ?? 0)
    try {
      if (sig === TOPICS.POOL_MINT) {
        const d = decodeEventLog({ abi: POOL_MINT_EVENT, data: log.data, topics: log.topics })
        const a = d.args as {
          sender: Address
          owner: Address
          tickLower: number
          tickUpper: number
          amount: bigint
          amount0: bigint
          amount1: bigint
        }
        out.push({
          kind: "pool_mint",
          pool_address: getAddress(log.address),
          owner: a.owner,
          tickLower: a.tickLower,
          tickUpper: a.tickUpper,
          liquidity: a.amount.toString(),
          amount0_raw: a.amount0.toString(),
          amount1_raw: a.amount1.toString(),
          logIndex,
        })
      } else if (sig === TOPICS.POOL_BURN) {
        const d = decodeEventLog({ abi: POOL_BURN_EVENT, data: log.data, topics: log.topics })
        const a = d.args as {
          owner: Address
          tickLower: number
          tickUpper: number
          amount: bigint
          amount0: bigint
          amount1: bigint
        }
        out.push({
          kind: "pool_burn",
          pool_address: getAddress(log.address),
          owner: a.owner,
          tickLower: a.tickLower,
          tickUpper: a.tickUpper,
          liquidity: a.amount.toString(),
          amount0_raw: a.amount0.toString(),
          amount1_raw: a.amount1.toString(),
          logIndex,
        })
      } else if (sig === TOPICS.POOL_COLLECT) {
        const d = decodeEventLog({ abi: POOL_COLLECT_EVENT, data: log.data, topics: log.topics })
        const a = d.args as {
          owner: Address
          recipient: Address
          tickLower: number
          tickUpper: number
          amount0: bigint
          amount1: bigint
        }
        out.push({
          kind: "pool_collect",
          pool_address: getAddress(log.address),
          owner: a.owner,
          recipient: a.recipient,
          tickLower: a.tickLower,
          tickUpper: a.tickUpper,
          amount0_raw: a.amount0.toString(),
          amount1_raw: a.amount1.toString(),
          logIndex,
        })
      } else if (sig === TOPICS.NPM_INCREASE) {
        const d = decodeEventLog({ abi: NPM_INCREASE_EVENT, data: log.data, topics: log.topics })
        const a = d.args as { tokenId: bigint; liquidity: bigint; amount0: bigint; amount1: bigint }
        out.push({
          kind: "npm_increase_liquidity",
          nft_manager: getAddress(log.address),
          tokenId: a.tokenId.toString(),
          liquidity: a.liquidity.toString(),
          amount0_raw: a.amount0.toString(),
          amount1_raw: a.amount1.toString(),
          logIndex,
        })
      } else if (sig === TOPICS.NPM_DECREASE) {
        const d = decodeEventLog({ abi: NPM_DECREASE_EVENT, data: log.data, topics: log.topics })
        const a = d.args as { tokenId: bigint; liquidity: bigint; amount0: bigint; amount1: bigint }
        out.push({
          kind: "npm_decrease_liquidity",
          nft_manager: getAddress(log.address),
          tokenId: a.tokenId.toString(),
          liquidity: a.liquidity.toString(),
          amount0_raw: a.amount0.toString(),
          amount1_raw: a.amount1.toString(),
          logIndex,
        })
      } else if (sig === TOPICS.NPM_COLLECT) {
        const d = decodeEventLog({ abi: NPM_COLLECT_EVENT, data: log.data, topics: log.topics })
        const a = d.args as { tokenId: bigint; recipient: Address; amount0: bigint; amount1: bigint }
        out.push({
          kind: "npm_collect",
          nft_manager: getAddress(log.address),
          tokenId: a.tokenId.toString(),
          recipient: a.recipient,
          amount0_raw: a.amount0.toString(),
          amount1_raw: a.amount1.toString(),
          logIndex,
        })
      }
    } catch {
      // Decode failure on an event we thought we recognised — skip silently.
    }
  }
  return out
}

/**
 * Best-effort enrichment: for each pool/NPM referenced in `events`, look up
 * token0/token1 metadata so the caller can scale raw amounts to human units.
 */
export async function enrichLpEvents(
  client: PublicClient,
  events: DecodedLpEvent[],
  chainId: number,
): Promise<Record<string, { token0: { address: Address; symbol: string; decimals: number }; token1: { address: Address; symbol: string; decimals: number } }>> {
  const pools = new Set<Address>()
  for (const e of events) {
    if (e.kind === "pool_mint" || e.kind === "pool_burn" || e.kind === "pool_collect") {
      pools.add(e.pool_address)
    }
  }
  const out: Record<string, { token0: { address: Address; symbol: string; decimals: number }; token1: { address: Address; symbol: string; decimals: number } }> = {}
  await Promise.all(
    [...pools].map(async (pool) => {
      try {
        const [t0Addr, t1Addr] = await Promise.all([
          client.readContract({ address: pool, abi: POOL_VIEW_ABI, functionName: "token0" }) as Promise<Address>,
          client.readContract({ address: pool, abi: POOL_VIEW_ABI, functionName: "token1" }) as Promise<Address>,
        ])
        const [t0, t1] = await Promise.all([
          getErc20(client, t0Addr, chainId),
          getErc20(client, t1Addr, chainId),
        ])
        out[pool.toLowerCase()] = {
          token0: { address: t0Addr, symbol: t0.symbol, decimals: t0.decimals },
          token1: { address: t1Addr, symbol: t1.symbol, decimals: t1.decimals },
        }
      } catch {
        // pool isn't a v3-style pool, skip
      }
    }),
  )
  return out
}
