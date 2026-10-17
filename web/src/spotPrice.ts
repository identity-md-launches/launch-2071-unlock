import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { POOL_MANAGER, type CandidateDeployment } from "./mainnet";

/** Existing hookless IMD/native-ETH v4 pool: currency0 = native ETH, currency1 = IMD, fee 10000, spacing 200. */
export const IMD_ETH_POOL_ID = "0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3" as const;
export const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" as const;
export const UNLK_SUPPLY = 1_000_000_000n;
export const MAX_FEED_AGE_SECONDS = 90n * 60n;
const Q192 = 1n << 192n;
const ONE = 10n ** 18n;

/** ETH per IMD (18 decimals) from the IMD/ETH pool's sqrtPriceX96, which encodes IMD per ETH. */
export function ethPerImd(sqrtPriceX96: bigint): bigint {
  if (sqrtPriceX96 <= 0n) throw new Error("IMD/ETH pool not initialized");
  return Q192 * ONE / (sqrtPriceX96 * sqrtPriceX96);
}

/** IMD per UNLK (18 decimals) from the official UNLK/IMD pool; direction follows the sorted PoolKey. */
export function imdPerUnlk(sqrtPriceX96: bigint, unlkIs0: boolean): bigint {
  if (sqrtPriceX96 <= 0n) throw new Error("UNLK/IMD pool not initialized");
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return unlkIs0 ? squared * ONE / Q192 : Q192 * ONE / squared;
}

export interface FeedRound { decimals: number; roundId: bigint; answer: bigint; updatedAt: bigint; answeredInRound: bigint }

/** Same acceptance rules as the on-chain source: 8 decimals, positive complete round, not future, <= 90 min old. */
export function validEthUsd(feed: FeedRound, blockTime: bigint): bigint {
  if (feed.decimals !== 8) throw new Error("ETH/USD feed decimals changed");
  if (feed.roundId === 0n || feed.answer <= 0n || feed.answeredInRound < feed.roundId) throw new Error("ETH/USD round incomplete");
  if (feed.updatedAt > blockTime) throw new Error("ETH/USD timestamp in the future");
  if (blockTime - feed.updatedAt > MAX_FEED_AGE_SECONDS) throw new Error("ETH/USD feed stale");
  return feed.answer;
}

/** USD per IMD and, when the UNLK leg is known, USD per UNLK and indicative FDV (all 18 decimals). */
export function composeSpot(imdEthSqrt: bigint, ethUsd8: bigint, unlk?: { sqrtPriceX96: bigint; unlkIs0: boolean }) {
  const usdPerImd = ethPerImd(imdEthSqrt) * ethUsd8 / 10n ** 8n;
  if (!unlk) return { usdPerImd, usdPerUnlk: null, fdv: null };
  const usdPerUnlk = imdPerUnlk(unlk.sqrtPriceX96, unlk.unlkIs0) * usdPerImd / ONE;
  return { usdPerImd, usdPerUnlk, fdv: usdPerUnlk * UNLK_SUPPLY };
}

/** v4 StateLibrary pool state slot: keccak256(abi.encode(poolId, 6)). */
export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, 6n]));
}

export function decodeSlot0(word: Hex): { sqrtPriceX96: bigint; tick: number; lpFee: number } {
  const value = BigInt(word);
  let tick = Number((value >> 160n) & 0xffffffn);
  if (tick >= 0x800000) tick -= 0x1000000;
  return { sqrtPriceX96: value & ((1n << 160n) - 1n), tick, lpFee: Number((value >> 208n) & 0xffffffn) };
}

export interface SpotSnapshot {
  block: bigint; blockTime: bigint;
  imdEth: { tick: number; sqrtPriceX96: bigint; lpFee: number };
  ethUsd: { answer: bigint; updatedAt: bigint };
  usdPerImd: bigint; usdPerUnlk: bigint | null; fdv: bigint | null;
  unlkUnavailable: string | null;
}

const managerAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);

/** Reads actual pool state and Chainlink at ONE block. Spot is manipulable within a block; display only. */
export async function readSpot(client: PublicClient, deployment: CandidateDeployment | null, official?: { poolId: Hex; unlkIs0: boolean }): Promise<SpotSnapshot> {
  if (await client.getChainId() !== 1) throw new Error("Spot price reads require Ethereum mainnet");
  const blockData = await client.getBlock({ blockTag: "latest" });
  const block = blockData.number;
  const slot0 = (poolId: Hex) => client.readContract({ address: POOL_MANAGER as Address, abi: managerAbi, functionName: "extsload", args: [poolStateSlot(poolId)], blockNumber: block });
  const [imdWord, decimals, round] = await Promise.all([
    slot0(IMD_ETH_POOL_ID),
    client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: "decimals", blockNumber: block }),
    client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: "latestRoundData", blockNumber: block }),
  ]);
  const imdEth = decodeSlot0(imdWord);
  if (imdEth.lpFee !== 10000) throw new Error("IMD/ETH pool fee differs from the verified PoolKey");
  const answer = validEthUsd({ decimals: Number(decimals), roundId: round[0], answer: round[1], updatedAt: round[3], answeredInRound: round[4] }, blockData.timestamp);
  let unlk: { sqrtPriceX96: bigint; unlkIs0: boolean } | undefined;
  let unlkUnavailable: string | null = "Successor UNLK/IMD pool is not deployed: no UNLK price or FDV exists yet.";
  if (deployment && official) {
    const word = decodeSlot0(await slot0(official.poolId));
    if (word.sqrtPriceX96 === 0n) unlkUnavailable = "Official UNLK/IMD pool is not initialized.";
    else { unlk = { sqrtPriceX96: word.sqrtPriceX96, unlkIs0: official.unlkIs0 }; unlkUnavailable = null; }
  }
  const composed = composeSpot(imdEth.sqrtPriceX96, answer, unlk);
  return { block, blockTime: blockData.timestamp, imdEth, ethUsd: { answer, updatedAt: round[3] }, ...composed, unlkUnavailable };
}
