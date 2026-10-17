import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";

export const NFT_BENEFICIARY = "0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9" as const;
export const NFT_COLLECTION = "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d" as const;
export const NEXT_THRESHOLDS = [100000,250000,500000,1000000,2000000,3500000,5000000,7500000,
  10000000,15000000,20000000,25000000,30000000,35000000,40000000,50000000] as const;
export const NEXT_RATES = [2000,2500,3000,3500,4000,4500,5000,5500,6000,6500,7000,7500,8000,8500,9000,9500,10000] as const;
export const fee75 = (base: bigint) => {
  if (base < 0n) throw new Error("ETH amount must be non-negative");
  return base * 75n / 10000n;
};
export function buyPoolInput(gross: bigint): bigint {
  if (gross < 0n) throw new Error("ETH budget must be non-negative");
  const base = gross * 10000n / 10075n;
  return base + 1n + fee75(base + 1n) <= gross ? base + 1n : base;
}
export function sellGrossOutput(net: bigint): bigint {
  if (net < 0n) throw new Error("ETH output must be non-negative");
  return net === 0n ? 0n : (net - 1n) * 10000n / 9925n + 1n;
}
export function candidateQuota(balance: bigint, eligible: bigint, sold: bigint, rate: bigint, fullyUnlocked: boolean) {
  if ([balance,eligible,sold,rate].some(v => v < 0n) || rate > 10000n) throw new Error("Invalid ledger");
  const cap = eligible * rate / 10000n;
  const quota = cap > sold ? cap - sold : 0n;
  return fullyUnlocked ? balance : balance < quota ? balance : quota;
}

// Successor (UnlkHookV3): the only execution route is the deployed Sepolia Universal Router the IMD Explorer
// uses, pinned by address and runtime hash in the hook itself. No custom router exists.
export const UNIVERSAL_ROUTER = "0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b" as const;
export const UNIVERSAL_ROUTER_CODEHASH = "0x14f7c9253a5406bafa90cb512f4a2db2a10513886603e7a9b4a2e72329e944f4" as const;
export const SUCCESSOR_FLAGS = 0x3fcc;

export type SwapMode = "buyExactIn" | "buyExactOut" | "sellExactIn" | "sellExactOut";
/// Treasury fee per standard v4 mode. `poolLeg` is the executed pool ETH (the fee base); `trader` is the ETH
/// the trader pays (buys) or receives (sells). For exact-output buys / exact-input sells `amount` is the
/// executed pool ETH leg from a quote; for exact-input buys it is the gross budget, for exact-output sells the net.
export function successorFee(mode: SwapMode, amount: bigint): {poolLeg:bigint; fee:bigint; trader:bigint} {
  if (amount < 0n) throw new Error("ETH amount must be non-negative");
  if (mode === "buyExactIn") { const poolLeg = buyPoolInput(amount); return {poolLeg, fee: amount - poolLeg, trader: amount}; }
  if (mode === "sellExactOut") { const poolLeg = sellGrossOutput(amount); return {poolLeg, fee: poolLeg - amount, trader: amount}; }
  const fee = fee75(amount);
  return {poolLeg: amount, fee, trader: mode === "buyExactOut" ? amount + fee : amount - fee};
}

// Deliberately absent until an independently reviewed Sepolia release supplies REAL addresses and hashes.
// No address is guessed, and no candidate transaction can be enabled by the current source.
export interface CandidateDeployment {
  chainId: 11155111; token: Address; hook: Address; vault: Address;
  runtimeHashes: Record<"token" | "hook" | "vault", Hex>;
}
export const CANDIDATE_DEPLOYMENT: CandidateDeployment | null = null;

// Mainnet is a separate PUBLIC READ client. It has no wallet transport or signing method.
export const nftClient = createPublicClient({transport: http("https://ethereum-rpc.publicnode.com", {
  timeout: 12000, retryCount: 1, batch: { wait: 20, batchSize: 20 },
})});
export const nftAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);
