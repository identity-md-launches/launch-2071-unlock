import {
  decodeFunctionData,
  encodeFunctionData,
  formatEther,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import {
  mainnetClient as client,
  POOL_KEY,
  TOKEN,
  HOOK,
  IMD,
  QUOTER,
  UNIVERSAL_ROUTER,
  PERMIT2,
  successorFee,
} from "./mainnet";
import {
  quoterAbi,
  executeAbi,
  erc20Abi,
  permitAbi,
  hookAbi,
} from "./mainnetAbis";
import { readMainnetCandidate, type CandidateSnapshot } from "./mainnetReader";
import { encodeImdSwap } from "./mainnetSwap";
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function parseAmount(text: string) {
  if (!/^\d+(?:\.\d{0,18})?$/.test(text) || text.length > 50)
    throw Error("Enter an amount with up to 18 decimals.");
  const n = parseEther(text);
  if (n <= 0n || n >= 1n << 128n)
    throw Error("Enter a positive amount below the router limit.");
  return n;
}
export function parseSlippage(text: string): number {
  const match = /^(\d{1,2})(?:\.(\d{0,2}))?$/.exec(text);
  if (!match)
    throw Error(
      "Choose slippage between 0.01% and 5%, with up to two decimals.",
    );
  const bps = Number(
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")),
  );
  if (bps < 1 || bps > 500)
    throw Error("Choose slippage between 0.01% and 5%.");
  return bps;
}
export interface Quote {
  account: Address;
  buy: boolean;
  amount: bigint;
  output: bigint;
  minimum: bigint;
  block: bigint;
  createdAt: number;
  deadline: bigint;
  data: Hex;
  poolLeg: bigint;
  treasury: bigint;
  poolFee: bigint;
  protocolPips: bigint;
  effectivePips: bigint;
  impactBps: bigint;
  slippage: number;
}
export function feeBreakdown(
  buy: boolean,
  amount: bigint,
  output: bigint,
  protocolFee: number,
  lpFee: number,
) {
  const poolLeg = buy ? successorFee("buyExactIn", amount).poolLeg : null;
  // Sell inversion returns the smallest compatible leg. Net output can hide one wei of fee.
  const leg = buy
    ? poolLeg!
    : output === 0n
      ? 0n
      : ((output - 1n) * 10000n) / 9925n + 1n;
  const treasury = buy ? amount - leg : (leg * 75n) / 10000n;
  const proto = BigInt(buy ? (protocolFee >> 12) & 0xfff : protocolFee & 0xfff);
  const effective = proto + BigInt(lpFee) - (proto * BigInt(lpFee)) / 1000000n;
  const input = buy ? leg : amount;
  return {
    poolLeg: leg,
    treasury,
    poolFee: ceilDiv(input * effective, 1000000n),
    protocolPips: proto,
    effectivePips: effective,
  };
}
export async function getQuote(
  account: Address,
  buy: boolean,
  amount: bigint,
  slippage: number,
  snapshot: CandidateSnapshot,
): Promise<Quote> {
  if (!snapshot.activated) throw Error("Trading not yet activated");
  if (Date.now() - snapshot.readAt > 45000)
    throw Error("State is stale. Refresh before quoting.");
  if (!Number.isInteger(slippage) || slippage < 1 || slippage > 500)
    throw Error("Choose slippage between 0.01% and 5%.");
  const result = await client.simulateContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: POOL_KEY,
        zeroForOne: !buy,
        exactAmount: amount,
        hookData: "0x",
      },
    ],
    account,
    blockNumber: snapshot.block,
  });
  const output = result.result[0];
  if (output <= 0n) throw Error("No output is available for this amount.");
  const minimum = (output * BigInt(10000 - slippage)) / 10000n;
  if (minimum === 0n)
    throw Error("Minimum output rounds to zero. Increase amount.");
  const deadline = snapshot.blockTime + 300n;
  const plan = encodeImdSwap(
    TOKEN,
    HOOK,
    buy ? "buyExactIn" : "sellExactIn",
    amount,
    minimum,
    deadline,
  );
  const square = snapshot.sqrtPrice * snapshot.sqrtPrice,
    q192 = 1n << 192n;
  const f = feeBreakdown(
    buy,
    amount,
    output,
    snapshot.protocolFee,
    snapshot.lpFee,
  );
  const effectiveCost = buy ? amount - f.poolLeg + f.poolFee : amount;
  const feeAdjusted = buy
    ? ((amount - effectiveCost) * q192) / square
    : ((((amount - f.poolFee) * square) / q192) * 9925n) / 10000n;
  const impactBps =
    feeAdjusted > output ? ((feeAdjusted - output) * 10000n) / feeAdjusted : 0n;
  return {
    account,
    buy,
    amount,
    output,
    minimum,
    block: snapshot.block,
    createdAt: Date.now(),
    deadline,
    data: plan.data,
    slippage,
    ...f,
    impactBps,
  };
}
export function quoteCurrent(
  q: Quote,
  account: Address | undefined,
  buy: boolean,
  amount: bigint,
  slippage: number,
  now = Date.now(),
) {
  return (
    q.account.toLowerCase() === account?.toLowerCase() &&
    q.buy === buy &&
    q.amount === amount &&
    q.slippage === slippage &&
    now - q.createdAt < 30000
  );
}
export async function validateQuote(q: Quote) {
  if (Date.now() - q.createdAt >= 30000)
    throw Error("Quote expired. Get a new quote; nothing was sent.");
  const fresh = await readMainnetCandidate(null, client, q.account);
  validateQuoteSnapshot(q, fresh);
}
export function validateQuoteSnapshot(q: Quote, fresh: CandidateSnapshot, now = Date.now()) {
  // A fresh read can itself be slow. Enforce the advertised lifetime after it resolves.
  if (now - q.createdAt >= 30000 || now < q.createdAt)
    throw Error("Quote expired. Get a new quote; nothing was sent.");
  if (
    !fresh.activated ||
    now - fresh.readAt > 45000 ||
    now / 1000 - Number(fresh.blockTime) > 90 ||
    fresh.block > q.block + 3n ||
    fresh.block < q.block ||
    fresh.blockTime >= q.deadline ||
    BigInt(Math.floor(now / 1000)) >= q.deadline
  )
    throw Error("Quote or activation state changed. Get a new quote.");
  if (
    !fresh.wallet ||
    (q.buy ? fresh.wallet.imdBalance : fresh.wallet.sellable) < q.amount
  )
    throw Error(
      q.buy
        ? "Insufficient IMD balance"
        : "Sale exceeds balance or mature quota. Refresh selling rights.",
    );
}
export const swapArgs = (q: Quote) =>
  decodeFunctionData({ abi: executeAbi, data: q.data }).args!;
export function fmt(x: bigint | undefined | null, max = 6): string {
  if (x === null || x === undefined) return "Unavailable";
  const negative = x < 0n,
    abs = negative ? -x : x;
  if (abs > 0n && abs < 10n ** BigInt(18 - max))
    return `${negative ? "−" : ""}<${max === 0 ? "1" : `0.${"0".repeat(max - 1)}1`}`;
  const [whole, fraction = ""] = formatEther(abs).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = fraction.slice(0, max).replace(/0+$/, "");
  return `${negative ? "−" : ""}${grouped}${decimals ? `.${decimals}` : ""}`;
}
export const exact = (x: bigint) => formatEther(x);
export {
  erc20Abi,
  permitAbi,
  executeAbi,
  hookAbi,
  IMD,
  TOKEN,
  HOOK,
  PERMIT2,
  UNIVERSAL_ROUTER,
  encodeFunctionData,
};
