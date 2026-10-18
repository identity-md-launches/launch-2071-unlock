import { parseAbi } from "viem";

// NFT_BENEFICIARY is retained only as a legacy beneficiary alias; inventory uses TREASURY_WALLET.
export {
  VAULT_BENEFICIARY,
  VAULT_BENEFICIARY as NFT_BENEFICIARY,
  TREASURY_WALLET,
} from "./treasury";
export const NFT_COLLECTION =
  "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d" as const;
export const NEXT_THRESHOLDS = [
  100000, 250000, 500000, 1000000, 2000000, 3500000, 5000000, 7500000, 10000000,
  15000000, 20000000, 25000000, 30000000, 35000000, 40000000, 50000000,
] as const;
export const NEXT_RATES = [
  2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000,
  8500, 9000, 9500, 10000,
] as const;
export const fee75 = (base: bigint) => {
  if (base < 0n) throw new Error("IMD amount must be non-negative");
  return (base * 75n) / 10000n;
};
export function buyPoolInput(gross: bigint): bigint {
  if (gross < 0n) throw new Error("IMD budget must be non-negative");
  const base = (gross * 10000n) / 10075n;
  return base + 1n + fee75(base + 1n) <= gross ? base + 1n : base;
}
export function sellGrossOutput(net: bigint): bigint {
  if (net < 0n) throw new Error("IMD output must be non-negative");
  return net === 0n ? 0n : ((net - 1n) * 10000n) / 9925n + 1n;
}
export function candidateQuota(
  balance: bigint,
  eligible: bigint,
  sold: bigint,
  rate: bigint,
  fullyUnlocked: boolean,
) {
  if ([balance, eligible, sold, rate].some((v) => v < 0n) || rate > 10000n)
    throw new Error("Invalid ledger");
  const cap = (eligible * rate) / 10000n;
  const quota = cap > sold ? cap - sold : 0n;
  return fullyUnlocked ? balance : balance < quota ? balance : quota;
}

export type SwapMode =
  | "buyExactIn"
  | "buyExactOut"
  | "sellExactIn"
  | "sellExactOut";
/// Treasury fee per standard v4 mode. `poolLeg` is the executed pool IMD (the fee base); `trader` is the IMD
/// the trader pays (buys) or receives (sells). For exact-output buys / exact-input sells `amount` is the
/// executed pool IMD leg from a quote; for exact-input buys it is the gross budget, for exact-output sells the net.
export function successorFee(
  mode: SwapMode,
  amount: bigint,
): { poolLeg: bigint; fee: bigint; trader: bigint } {
  if (amount < 0n) throw new Error("IMD amount must be non-negative");
  if (mode === "buyExactIn") {
    const poolLeg = buyPoolInput(amount);
    return { poolLeg, fee: amount - poolLeg, trader: amount };
  }
  if (mode === "sellExactOut") {
    const poolLeg = sellGrossOutput(amount);
    return { poolLeg, fee: poolLeg - amount, trader: amount };
  }
  const fee = fee75(amount);
  return {
    poolLeg: amount,
    fee,
    trader: mode === "buyExactOut" ? amount + fee : amount - fee,
  };
}

// Compatibility exports now resolve to the verified launch 2071 deployment.
export {
  CANDIDATE_DEPLOYMENT,
  UNIVERSAL_ROUTER,
  UNIVERSAL_ROUTER_CODEHASH,
  SUCCESSOR_FLAGS,
} from "./mainnet";
export type { CandidateDeployment } from "./mainnet";
export { client as nftClient } from "./config";
export const nftAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);
