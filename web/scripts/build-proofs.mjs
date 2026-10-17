import fs from "node:fs";
import { keccak256, encodeAbiParameters, concatHex } from "viem";
const launch = await fetch(
  "https://api.imd.fun/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929",
).then((r) => {
  if (!r.ok) throw Error(`Launch API HTTP ${r.status}`);
  return r.json();
});
const hash = (r) =>
  keccak256(
    keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [r.wallet, BigInt(r.amount)],
      ),
    ),
  );
const pair = (a, b) =>
  keccak256(concatHex(a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
const rows = launch.allocations
  .map((r) => ({ wallet: r.wallet, amount: r.amount }))
  .map((r) => ({ ...r, hash: hash(r) }))
  .sort((a, b) => (a.hash > b.hash ? -1 : a.hash < b.hash ? 1 : 0));
const nodes = Array(rows.length - 1).fill("0x");
nodes.push(...rows.map((r) => r.hash));
for (let i = rows.length - 2; i >= 0; i--)
  nodes[i] = pair(nodes[2 * i + 1], nodes[2 * i + 2]);
if (
  nodes[0] !== launch.merkleRoot ||
  launch.chainId !== 1 ||
  launch.launchNumber !== 2071
)
  throw Error("Launch identity or reconstructed root mismatch");
const leaves = rows.map((r, i) => {
  let index = rows.length - 1 + i;
  const proof = [];
  while (index > 0) {
    proof.push(nodes[index % 2 === 0 ? index - 1 : index + 1]);
    index = Math.floor((index - 1) / 2);
  }
  return { wallet: r.wallet, amount: r.amount, proof };
});
const path = new URL("../public/claims/round-0.json", import.meta.url);
fs.mkdirSync(new URL("../public/claims/", import.meta.url), {
  recursive: true,
});
fs.writeFileSync(
  path,
  JSON.stringify({
    chainId: 1,
    distributor: "0xc70795e2d8dfac6131038dcba84aa2aaed1ceed1",
    round: 0,
    root: nodes[0],
    leaves,
  }),
);
console.log(
  `Reconstructed ${leaves.length} native proofs: ${nodes[0]}. UI additionally checks the onchain root before use.`,
);
