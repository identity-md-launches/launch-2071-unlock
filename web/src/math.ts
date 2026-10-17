import { formatUnits, parseUnits } from "viem";
export const UNIT = 10n ** 18n;
export const SUPPLY = 1_000_000_000n * UNIT;
export const RATES = [
  2500n,
  3500n,
  4500n,
  5500n,
  7000n,
  8500n,
  10000n,
] as const;
export const TARGETS = [
  0, 100000, 250000, 500000, 1000000, 2500000, 5000000,
] as const;
export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export function allowance(
  W: bigint,
  E: bigint,
  S: bigint,
  p: bigint,
  fullyUnlocked = false,
) {
  if ([W, E, S, p].some((x) => x < 0n) || p > 10000n)
    throw Error("Invalid allowance inputs");
  const cap = (E * p) / 10000n;
  const quota = cap > S ? cap - S : 0n;
  const within = fullyUnlocked ? W : min(W, quota);
  return {
    within,
    outside: W - within,
    quota: fullyUnlocked ? null : quota,
    cap,
  };
}
export function scenario(
  W: bigint,
  E: bigint,
  S: bigint,
  p: bigint,
  currentRate: bigint,
  fullyUnlocked = false,
) {
  const now = allowance(W, E, S, currentRate, fullyUnlocked).within;
  const next = allowance(W, E, S, p, p === 10000n || fullyUnlocked).within;
  const achieved = p <= currentRate || fullyUnlocked;
  return {
    within: achieved ? now : next,
    increase: achieved ? 0n : next > now ? next - now : 0n,
    achieved,
  };
}
export function parseAmount(text: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text))
    throw Error("Enter a positive amount with up to 18 decimal places.");
  const n = parseUnits(text, 18);
  if (n <= 0n || n > (1n << 127n) - 1n)
    throw Error(
      "Enter an amount greater than zero and within the router limit.",
    );
  return n;
}
export function number(value: bigint | undefined | null, digits = 4): string {
  if (value === undefined || value === null) return "Unavailable";
  const s = formatUnits(value, 18);
  const [whole, fraction = ""] = s.split(".");
  const f = fraction.slice(0, digits).replace(/0+$/, "");
  if (value > 0n && whole === "0" && (!f || BigInt(f) === 0n))
    return `<${digits === 0 ? "1" : "0." + "0".repeat(digits - 1) + "1"}`;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
}
export const exact = (n: bigint) => formatUnits(n, 18);
export const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const usd = (n: bigint | null | undefined) =>
  n == null ? "Unavailable" : `$${number(n, 2)}`;
export const date = (n: bigint | number) =>
  new Date(Number(n) * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
export const duration = (s: bigint | number) => {
  const n = Math.max(0, Number(s));
  return n >= 3600
    ? `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`
    : `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
};
export function minReceipt(output: bigint, slippageBps: bigint) {
  if (slippageBps < 0n || slippageBps > 500n)
    throw Error("Slippage must be between 0% and 5%.");
  return (output * (10000n - slippageBps)) / 10000n;
}
const Q96 = 1n << 96n;
export function seedAmounts(
  sqrt: bigint,
  lower: bigint,
  upper: bigint,
  L: bigint,
) {
  const x = sqrt < lower ? lower : sqrt > upper ? upper : sqrt;
  return {
    eth: (L * Q96 * (upper - x)) / upper / x,
    tokens: (L * (x - lower)) / Q96,
  };
}
export function spotEth(sqrt: bigint) {
  return sqrt > 0n ? ((1n << 192n) * UNIT) / (sqrt * sqrt) : null;
}
// Exact v4 single-range exact-input swap arithmetic, independently reconciled with router eth_call.
// The official pool accepts only the factory's immutable seed position.
export function swapStep(
  buy: boolean,
  amount: bigint,
  sqrt: bigint,
  limit: bigint,
  L: bigint,
  fee = 12500n,
) {
  if (amount <= 0n || sqrt <= 0n || limit <= 0n || L <= 0n)
    throw Error("Pool has no executable liquidity.");
  const delta0 = (lo: bigint, hi: bigint, up: boolean) =>
    up
      ? ceilDiv(ceilDiv((L << 96n) * (hi - lo), hi), lo)
      : ((L << 96n) * (hi - lo)) / hi / lo;
  const delta1 = (lo: bigint, hi: bigint, up: boolean) =>
    up ? ceilDiv(L * (hi - lo), Q96) : (L * (hi - lo)) / Q96;
  const toLimit = buy ? delta0(limit, sqrt, true) : delta1(sqrt, limit, true);
  const available = (amount * (1000000n - fee)) / 1000000n;
  const reached = available >= toLimit;
  const next = reached
    ? limit
    : buy
      ? ceilDiv((L << 96n) * sqrt, (L << 96n) + available * sqrt)
      : sqrt + (available * Q96) / L;
  // v4 consumes all fee-adjusted input when the target is not reached.
  // Recomputing from the rounded price would misattribute input dust as fee.
  const netInput = reached ? toLimit : available;
  const output = buy ? delta1(next, sqrt, false) : delta0(sqrt, next, false);
  const feeAmount = reached
    ? ceilDiv(netInput * fee, 1000000n - fee)
    : amount - netInput;
  return {
    input: netInput + feeAmount,
    output,
    fee: feeAmount,
    sqrtAfter: next,
    partial: netInput + feeAmount < amount,
  };
}
export function confirmationState(s: {
  tier: number;
  fullyUnlocked: boolean;
  qualifyingSince: bigint;
  lastConfirmation: bigint;
  timestamp: bigint;
  fdv: bigint | null;
  minInterval: bigint;
  maxGap: bigint;
  confirmation: bigint;
  finalConfirmation: bigint;
}) {
  if (s.fullyUnlocked)
    return {
      label: "Permanently unlocked",
      elapsed: 0n,
      required: 0n,
      progress: 100,
    };
  const required = s.tier === 5 ? s.finalConfirmation : s.confirmation;
  const elapsed =
    s.qualifyingSince > 0n && s.lastConfirmation >= s.qualifyingSince
      ? s.lastConfirmation - s.qualifyingSince
      : 0n;
  const gap = s.timestamp - s.lastConfirmation;
  let label = "Waiting for a qualifying observation";
  if (s.qualifyingSince > 0n && gap > s.maxGap)
    label = "Confirmation gap exceeded · next valid call restarts";
  else if (s.fdv === null)
    label = "Verified FDV unavailable · no new confirmation";
  else if (s.fdv < BigInt(TARGETS[s.tier + 1]) * UNIT)
    label =
      s.qualifyingSince > 0n
        ? "Below next target · next valid call resets"
        : "Below next target";
  else if (s.qualifyingSince === 0n)
    label = "Target met · confirmation has not started";
  else if (elapsed >= required)
    label = "Duration reached · valid on-chain update still required";
  else if (gap < s.minInterval)
    label = "Confirming · minimum interval not yet reached";
  else label = "Confirming · another valid update is needed";
  const active =
    s.qualifyingSince > 0n &&
    gap <= s.maxGap &&
    s.fdv !== null &&
    s.fdv >= BigInt(TARGETS[s.tier + 1]) * UNIT;
  return {
    label,
    elapsed,
    required,
    progress: active
      ? Math.min(100, Number((elapsed * 10000n) / required) / 100)
      : 0,
  };
}

// Shortcuts only fill the form. All amounts remain integer token/native wei.
export function shortcutAmount(balance: bigint, percent: number, reserve = 0n) {
  if (balance < 0n || reserve < 0n || ![25, 50, 75, 100].includes(percent))
    throw Error("Invalid shortcut inputs");
  return (
    ((balance > reserve ? balance - reserve : 0n) * BigInt(percent)) / 100n
  );
}
export const gasReserve = (gas: bigint, price: bigint) =>
  ceilDiv(gas * price * 120n, 100n);
