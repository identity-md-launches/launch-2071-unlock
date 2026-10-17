import {
  keccak256,
  encodeAbiParameters,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import { abi, addresses as a, client, stateAbi, NATIVE } from "./config";
import verified from "./verified.json";
import { allowance, seedAmounts, spotEth, UNIT } from "./math";
export const b = verified.bindings as typeof verified.bindings & {
  rewards: Address;
  oracle: Address;
  factory: Address;
  payer: Address;
  feed: Address;
  poolId: Hex;
};
export const read = <T>(
  address: Address,
  ab: Abi,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<T> =>
  client.readContract({
    address,
    abi: ab,
    functionName,
    args,
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  }) as Promise<T>;
const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
let verifiedAt = 0;
export async function verifyBindings(force = false) {
  if (!force && Date.now() - verifiedAt < 60000) return;
  if ((await client.getChainId()) !== 11155111)
    throw Error("RPC returned the wrong network. Transactions are disabled.");
  await Promise.all(
    Object.values(verified.contracts).map(async (c) => {
      const code = await client.getCode({ address: c.address as Address });
      if (!code || keccak256(code) !== c.runtimeHash)
        throw Error(
          "Deployed runtime does not match the verified source. Transactions are disabled.",
        );
    }),
  );
  const checks: [Address, Abi, string, unknown][] = [
    [a.hook, abi.hook, "router", a.router],
    [a.hook, abi.hook, "rewards", b.rewards],
    [a.hook, abi.hook, "oracle", b.oracle],
    [a.token, abi.token, "totalSupply", 1000000000n * 10n ** 18n],
    [a.token, abi.token, "decimals", 18],
    [a.hook, abi.hook, "token", a.token],
    [a.hook, abi.hook, "poolManager", a.manager],
    [a.hook, abi.hook, "activated", true],
    [a.router, abi.router, "hook", a.hook],
    [a.router, abi.router, "poolManager", a.manager],
    [b.oracle, abi.oracle, "hook", a.hook],
    [b.oracle, abi.oracle, "poolManager", a.manager],
    [b.oracle, abi.oracle, "token", a.token],
    [b.oracle, abi.oracle, "poolId", b.poolId],
    [b.rewards, abi.evidence, "token", a.token],
    [b.rewards, abi.evidence, "distributor", a.distributor],
    [a.distributor, abi.distributor, "token", a.token],
  ];
  await Promise.all(
    checks.map(async ([address, ab, fn, expected]) => {
      const actual = await read<unknown>(address, ab, fn);
      if (
        typeof expected === "string"
          ? typeof actual !== "string" || !same(actual, expected)
          : actual !== expected
      )
        throw Error(`Contract binding ${fn} could not be verified.`);
    }),
  );
  const key = await read<{
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  }>(a.hook, abi.hook, "poolKey");
  if (
    !same(key.currency0, NATIVE) ||
    !same(key.currency1, a.token) ||
    key.fee !== 12500 ||
    key.tickSpacing !== 60 ||
    !same(key.hooks, a.hook) ||
    keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
      ),
    ) !== b.poolId
  )
    throw Error("The official PoolKey changed or could not be verified.");
  verifiedAt = Date.now();
}
export interface Observation {
  time: bigint;
  tick: number;
  liquid: boolean;
  tickCumulative: bigint;
  badSeconds: bigint;
}
export interface Snapshot {
  block: bigint;
  hash: Hex;
  timestamp: bigint;
  fetchedAt: number;
  verified: boolean;
  p: bigint;
  tier: number;
  fullyUnlocked: boolean;
  qualifyingSince: bigint;
  lastConfirmation: bigint;
  sqrt: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
  liquidity: bigint;
  positionLiquidity: bigint;
  lower: bigint;
  upper: bigint;
  seedTokens: bigint;
  seedQuoteCapacity: bigint;
  poolEth: bigint;
  poolTokens: bigint;
  fdv: bigint | null;
  spot: bigint | null;
  ethUsd: bigint | null;
  spotUsd: bigint | null;
  spotFdv: bigint | null;
  feedTime: bigint;
  observations: bigint;
  first: Observation | null;
  last: Observation | null;
  oracleError: string | null;
  window: bigint;
  checkpointAge: bigint;
  feedAge: bigint;
  minLiquidity: bigint;
  minCapacity: bigint;
  confirmation: bigint;
  finalConfirmation: bigint;
  minInterval: bigint;
  maxGap: bigint;
  roundCount: bigint;
  pendingPayer: [Address, bigint];
}
export async function loadSnapshot(): Promise<Snapshot> {
  if (!ticks) await initTicks();
  const block = await client.getBlock();
  const n = block.number;
  await verifyBindings();
  const h = <T>(fn: string, args: readonly unknown[] = []) =>
    read<T>(a.hook, abi.hook, fn, args, n);
  const o = <T>(fn: string, args: readonly unknown[] = []) =>
    read<T>(b.oracle, abi.oracle, fn, args, n);
  const [
    p,
    tier,
    fullyUnlocked,
    lastConfirmation,
    seedTokens,
    seedQuoteCapacity,
    slot,
    position,
    liquidity,
    lower,
    upper,
    observations,
    fdv,
    feed,
    decimals,
    roundCount,
    pendingPayer,
  ] = await Promise.all([
    h<number>("p"),
    h<number>("tier"),
    h<boolean>("fullyUnlocked"),
    h<bigint>("lastConfirmation"),
    h<bigint>("seedTokens"),
    h<bigint>("seedQuoteCapacity"),
    read<[bigint, number, number, number]>(
      a.stateView,
      stateAbi,
      "getSlot0",
      [b.poolId],
      n,
    ),
    read<[bigint, bigint, bigint]>(
      a.stateView,
      stateAbi,
      "getPositionInfo",
      [
        b.poolId,
        b.factory,
        verifiedStateLower(),
        verifiedStateUpper(),
        "0x" + "00".repeat(32),
      ],
      n,
    ),
    read<bigint>(a.stateView, stateAbi, "getLiquidity", [b.poolId], n),
    o<bigint>("rangeLower"),
    o<bigint>("rangeUpper"),
    o<bigint>("observationCount"),
    o<bigint>("fdvUsd").catch(() => null),
    read<[bigint, bigint, bigint, bigint, bigint]>(
      b.feed,
      abi.feed,
      "latestRoundData",
      [],
      n,
    ).catch(() => null),
    read<number>(b.feed, abi.feed, "decimals", [], n).catch(() => null),
    read<bigint>(a.distributor, abi.distributor, "roundCount", [], n),
    h<[Address, bigint]>("pendingPayerCredit"),
  ]);
  const observation = async (i: bigint): Promise<Observation> => {
    const x = await o<[bigint, number, boolean, bigint, bigint]>(
      "observations",
      [i],
    );
    return {
      time: x[0],
      tick: x[1],
      liquid: x[2],
      tickCumulative: x[3],
      badSeconds: x[4],
    };
  };
  const [
    first,
    last,
    qualifyingSince,
    window,
    checkpointAge,
    feedAge,
    minLiquidity,
    minCapacity,
    confirmation,
    finalConfirmation,
    minInterval,
    maxGap,
  ] = await Promise.all([
    observations > 0n ? observation(0n) : null,
    observations > 0n ? observation(observations - 1n) : null,
    tier < 6 ? h<bigint>("qualifyingSince", [BigInt(tier)]) : 0n,
    ...[
      "WINDOW",
      "MAX_CHECKPOINT_AGE",
      "MAX_FEED_AGE",
      "MIN_LIQUIDITY",
      "MIN_SEED_QUOTE_CAPACITY",
    ].map((x) => o<bigint>(x)),
    ...[
      "CONFIRMATION",
      "FINAL_CONFIRMATION",
      "MIN_CONFIRMATION_INTERVAL",
      "MAX_CONFIRMATION_GAP",
    ].map((x) => h<bigint>(x)),
  ]);
  const validFeed =
    feed &&
    decimals === 8 &&
    feed[0] > 0n &&
    feed[1] > 0n &&
    feed[2] > 0n &&
    feed[2] <= feed[3] &&
    feed[3] <= block.timestamp &&
    feed[3] > 0n &&
    feed[4] >= feed[0] &&
    block.timestamp - feed[3] <= feedAge &&
    feed[1] <= 1000000n * 10n ** 8n;
  const ethUsd = validFeed ? feed[1] * 10n ** 10n : null;
  const spot = spotEth(slot[0]);
  const spotUsd =
    spot !== null && ethUsd !== null ? (spot * ethUsd) / UNIT : null;
  let oracleError: string | null = null;
  if (fdv === null) {
    if (!last) oracleError = "No oracle observations yet.";
    else if (block.timestamp - last.time > checkpointAge)
      oracleError = "The latest checkpoint is older than five minutes.";
    else if (!first || block.timestamp - first.time < window)
      oracleError = "The two-hour observation window is still warming up.";
    else if (!last.liquid)
      oracleError = "The latest observation fails the liquidity or fee checks.";
    else if (!validFeed) oracleError = "The ETH/USD feed is stale or invalid.";
    else
      oracleError =
        "The TWAP window contains invalid observations or the oracle rejected the data.";
  }
  const pool = seedAmounts(slot[0], lower, upper, position[0]);
  return {
    block: n,
    hash: block.hash,
    timestamp: block.timestamp,
    fetchedAt: Date.now(),
    verified: true,
    p: BigInt(p),
    tier,
    fullyUnlocked,
    qualifyingSince,
    lastConfirmation,
    sqrt: slot[0],
    tick: slot[1],
    protocolFee: slot[2],
    lpFee: slot[3],
    liquidity,
    positionLiquidity: position[0],
    lower,
    upper,
    seedTokens,
    seedQuoteCapacity,
    poolEth: pool.eth,
    poolTokens: pool.tokens,
    fdv,
    spot,
    ethUsd,
    spotUsd,
    spotFdv: spotUsd === null ? null : spotUsd * 1000000000n,
    feedTime: feed?.[3] ?? 0n,
    observations,
    first,
    last,
    oracleError,
    window,
    checkpointAge,
    feedAge,
    minLiquidity,
    minCapacity,
    confirmation,
    finalConfirmation,
    minInterval,
    maxGap,
    roundCount,
    pendingPayer,
  };
}
// Seed ticks are read from the verified oracle at setup, and are immutable after binding.
let ticks: { lower: number; upper: number } | undefined;
export async function initTicks() {
  const [lower, upper] = await Promise.all([
    read<number>(a.hook, abi.hook, "seedTickLower"),
    read<number>(a.hook, abi.hook, "seedTickUpper"),
  ]);
  ticks = { lower, upper };
}
function verifiedStateLower() {
  if (!ticks) throw Error("Seed ticks are not loaded");
  return ticks.lower;
}
function verifiedStateUpper() {
  if (!ticks) throw Error("Seed ticks are not loaded");
  return ticks.upper;
}
export interface WalletState {
  address: Address;
  block: bigint;
  W: bigint;
  E: bigint;
  S: bigint;
  native: bigint;
  credit: bigint;
  approval: bigint;
  pendingReward: bigint;
  attestedAmount: bigint;
  creditedAmount: bigint;
  within: bigint;
  outside: bigint;
  quota: bigint | null;
}
export async function loadWallet(
  address: Address,
  s: Snapshot,
): Promise<WalletState> {
  const n = s.block;
  const [
    W,
    E,
    S,
    native,
    credit,
    approval,
    pendingReward,
    attestedAmount,
    creditedAmount,
  ] = await Promise.all([
    read<bigint>(a.token, abi.token, "balanceOf", [address], n),
    read<bigint>(a.hook, abi.hook, "eligible", [address], n),
    read<bigint>(a.hook, abi.hook, "sold", [address], n),
    client.getBalance({ address, blockNumber: n }),
    read<bigint>(a.router, abi.router, "nativeCredit", [address], n),
    read<bigint>(a.token, abi.token, "allowance", [address, a.router], n),
    read<bigint>(a.hook, abi.hook, "pendingRewardCredit", [address], n),
    read<bigint>(b.rewards, abi.evidence, "claimed", [address], n),
    read<bigint>(a.hook, abi.hook, "claimedCredit", [address], n),
  ]);
  return {
    address,
    block: n,
    W,
    E,
    S,
    native,
    credit,
    approval,
    pendingReward,
    attestedAmount,
    creditedAmount,
    ...allowance(W, E, S, s.p, s.fullyUnlocked),
  };
}
