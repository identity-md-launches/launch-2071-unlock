import { type Address, type Hex } from "viem";
import pins from "./mainnet-pins.json";
export {
  NEXT_THRESHOLDS,
  NEXT_RATES,
  NFT_BENEFICIARY,
  VAULT_BENEFICIARY,
  TREASURY_WALLET,
  successorFee,
  type SwapMode,
} from "./candidate";
export { client as mainnetClient } from "./config";
export const TOKEN = pins.addresses.token as Address;
export const HOOK = pins.addresses.hook as Address;
export const VAULT = pins.addresses.vault as Address;
export const ORACLE = pins.addresses.oracle as Address;
export const EVIDENCE = pins.addresses.evidence as Address;
export const DISTRIBUTOR = pins.addresses.distributor as Address;
export const FACTORY = pins.addresses.factory as Address;
export const IMD = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" as const;
export const POOL_MANAGER =
  "0x000000000004444c5dc75cb358380d2e3de08a90" as const;
export const UNIVERSAL_ROUTER =
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af" as const;
export const QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203" as const;
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;
export const REGISTRY = "0xa47fcb220ddd1cddda865f89029bec1b9eca3bf1" as const;
export const STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227" as const;
export const POOL_ID =
  "0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32" as const;
export const IMD_CODEHASH =
  "0x79a1ae149d27d4aae006d4dd75cb834222c9623799bbf34359428aaf66fec3bf" as const;
export const UNIVERSAL_ROUTER_CODEHASH =
  "0x6a5f46971b50c6e1b7eef97902311444e479d734e4f80ad88367783cf373fe7f" as const;
export const SUCCESSOR_FLAGS = 0x3fcc;
export const POOL_KEY = {
  currency0: TOKEN,
  currency1: IMD,
  fee: 12500,
  tickSpacing: 60,
  hooks: HOOK,
} as const;
export interface CandidateDeployment {
  chainId: 1;
  token: Address;
  hook: Address;
  vault: Address;
  runtimeHashes: Record<"token" | "hook" | "vault", Hex>;
}
export const CANDIDATE_DEPLOYMENT: CandidateDeployment = {
  chainId: 1,
  token: TOKEN,
  hook: HOOK,
  vault: VAULT,
  runtimeHashes: pins.runtimeHashes as CandidateDeployment["runtimeHashes"],
};
export const RUNTIME_PINS: Record<string, { address: Address; hash: Hex }> =
  Object.fromEntries(
    Object.entries(pins.addresses)
      .filter(([name]) => name !== "nft")
      .map(([name, address]) => [
        name,
        {
          address: address as Address,
          hash: pins.runtimeHashes[
            name as keyof typeof pins.runtimeHashes
          ] as Hex,
        },
      ]),
  );
Object.assign(RUNTIME_PINS, {
  registry: {
    address: REGISTRY,
    hash: "0x49e6a11ab5df44d8d9ed1c62a93e6068ca209a29fac1eb89e70233101608e6fd",
  },
  imd: { address: IMD, hash: IMD_CODEHASH },
  router: { address: UNIVERSAL_ROUTER, hash: UNIVERSAL_ROUTER_CODEHASH },
  quoter: {
    address: QUOTER,
    hash: "0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441",
  },
  permit2: {
    address: PERMIT2,
    hash: "0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131",
  },
  manager: {
    address: POOL_MANAGER,
    hash: "0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293",
  },
});
export function verifiedMatureQuota(
  E: bigint,
  matureE: bigint,
  S: bigint,
  p: bigint,
  full: boolean,
): bigint {
  if (
    E < 0n ||
    matureE < 0n ||
    matureE > E ||
    S < 0n ||
    p < 2000n ||
    p > 10000n
  )
    throw Error("Invalid mature-credit ledger");
  if (full) return (1n << 256n) - 1n;
  const cap = (matureE * p) / 10000n;
  return cap > S ? cap - S : 0n;
}
