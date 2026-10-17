import {
  keccak256,
  encodeAbiParameters,
  concatHex,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { NATIVE } from "./config";
export interface Leaf {
  wallet: Address;
  amount: string;
  proof: Hex[];
}
export interface ClaimTree {
  root: Hex;
  leaves: Leaf[];
  round?: number;
}
export const leafHash = (account: Address, amount: bigint) =>
  keccak256(
    keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [account, amount],
      ),
    ),
  );
export const pairHash = (a: Hex, b: Hex) =>
  keccak256(concatHex(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
export function verifyProof(leaf: Leaf, root: Hex) {
  try {
    if (
      !isAddress(leaf.wallet) ||
      leaf.wallet.toLowerCase() === NATIVE ||
      !/^\d+$/.test(leaf.amount) ||
      !Array.isArray(leaf.proof) ||
      leaf.proof.length > 256 ||
      !/^0x[\da-fA-F]{64}$/.test(root)
    )
      return false;
    let h = leafHash(leaf.wallet, BigInt(leaf.amount));
    for (const p of leaf.proof) {
      if (!/^0x[\da-fA-F]{64}$/.test(p)) return false;
      h = pairHash(h, p);
    }
    return h.toLowerCase() === root.toLowerCase();
  } catch {
    return false;
  }
}
export function prepareTree(tree: ClaimTree) {
  if (
    !Array.isArray(tree.leaves) ||
    tree.leaves.length === 0 ||
    tree.leaves.length > 100000
  )
    throw Error("Supply a complete tree with 1–100,000 unique recipients.");
  const seen = new Set<string>();
  const rows = tree.leaves
    .map((leaf) => {
      if (
        !isAddress(leaf.wallet) ||
        leaf.wallet.toLowerCase() === NATIVE ||
        seen.has(leaf.wallet.toLowerCase())
      )
        throw Error(
          "The complete tree contains an invalid or duplicate recipient.",
        );
      seen.add(leaf.wallet.toLowerCase());
      if (!/^\d+$/.test(leaf.amount))
        throw Error("Amounts must be exact unsigned token wei strings.");
      const amount = BigInt(leaf.amount);
      return {
        hash: leafHash(leaf.wallet, amount),
        wallet: leaf.wallet,
        amount,
      };
    })
    .sort((a, b) => (a.hash > b.hash ? -1 : a.hash < b.hash ? 1 : 0));
  const nodes: Hex[] = Array(rows.length - 1).fill("0x");
  nodes.push(...rows.map((r) => r.hash));
  for (let i = rows.length - 2; i >= 0; i--)
    nodes[i] = pairHash(nodes[2 * i + 1], nodes[2 * i + 2]);
  if (nodes[0].toLowerCase() !== tree.root.toLowerCase())
    throw Error(
      "The complete tree does not reproduce the native distributor root.",
    );
  return {
    accounts: rows.map((r) => r.wallet),
    amounts: rows.map((r) => r.amount),
    root: nodes[0],
  };
}
