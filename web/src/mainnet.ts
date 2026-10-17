import { createPublicClient, http, type Address, type Hex } from "viem";
export { NEXT_THRESHOLDS, NEXT_RATES, NFT_BENEFICIARY, successorFee, type SwapMode } from "./candidate";
export const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" as const;
export const IMD_CODEHASH = "0x79a1ae149d27d4aae006d4dd75cb834222c9623799bbf34359428aaf66fec3bf" as const;
export const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90" as const;
export const UNIVERSAL_ROUTER = "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" as const;
export const UNIVERSAL_ROUTER_CODEHASH = "0x6a5f46971b50c6e1b7eef97902311444e479d734e4f80ad88367783cf373fe7f" as const;
export const SUCCESSOR_FLAGS = 0x3fcc;
export interface CandidateDeployment {
  chainId: 1; token: Address; hook: Address; vault: Address;
  runtimeHashes: Record<"token" | "hook" | "vault", Hex>;
}
// High shared-executor finding and oracle evidence block release. No candidate write path exists.
export const CANDIDATE_DEPLOYMENT: CandidateDeployment | null = null;
export const mainnetClient = createPublicClient({transport:http("https://ethereum-rpc.publicnode.com")});

/** E remains cumulative acquisitions. Only matured buy credit contributes to current quota. */
export function verifiedMatureQuota(E: bigint, matureE: bigint, S: bigint, p: bigint, full: boolean): bigint {
  if (E < 0n || matureE < 0n || matureE > E || S < 0n || p < 2000n || p > 10000n) throw new Error("Invalid candidate ledger");
  if (full) return (1n << 256n) - 1n;
  const cap = matureE * p / 10000n;
  return cap > S ? cap - S : 0n;
}
