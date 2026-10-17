import fs from "node:fs";
import { abi, addresses as a, client, BUY_PROOF } from "../src/config";
import { loadSnapshot, loadWallet, read, b } from "../src/live";
import { indexEvents, loadHolders } from "../src/indexer";
import { swapStep, allowance, parseAmount } from "../src/math";
import { verifyProof, prepareTree, type ClaimTree } from "../src/rewards.ts";
const snapshot = await loadSnapshot();
const index = await indexEvents(snapshot);
const holders = await loadHolders(index, snapshot);
const arithmetic = [];
for (const holder of holders) {
  const wallet = await loadWallet(holder.address, snapshot);
  const quota = await read<bigint>(
    a.hook,
    abi.hook,
    "remainingQuota",
    [holder.address],
    snapshot.block,
  );
  const calculated = allowance(
    wallet.W,
    wallet.E,
    wallet.S,
    snapshot.p,
    snapshot.fullyUnlocked,
  );
  if (!snapshot.fullyUnlocked && quota !== calculated.quota)
    throw Error("Contract quota mismatch");
  arithmetic.push({
    address: holder.address,
    W: wallet.W,
    E: wallet.E,
    S: wallet.S,
    contractRemainingQuota: quota,
    calculated,
    match: true,
  });
}
const tree: ClaimTree = JSON.parse(
  fs.readFileSync("public/evidence/round-0.json", "utf8"),
);
const root = await read<{ root: string }>(
  a.distributor,
  abi.distributor,
  "roundOf",
  [0n],
  snapshot.block,
);
if (root.root !== tree.root) throw Error("Native root mismatch");
for (const leaf of tree.leaves)
  if (!verifyProof(leaf, tree.root))
    throw Error("Invalid proof " + leaf.wallet);
const full = prepareTree(tree);
const buyTx = await client.getTransaction({ hash: BUY_PROOF });
const account = buyTx.from;
const simulations = [];
for (const amount of ["0.000001", "0.001", "0.01"]) {
  const n = parseAmount(amount);
  const request = {
    zeroForOne: true,
    amountSpecified: -n,
    sqrtPriceLimitX96: snapshot.lower,
    maxInput: n,
    minOutput: 1n,
    deadline: snapshot.timestamp + 300n,
  };
  try {
    const sim = await client.simulateContract({
      address: a.router,
      abi: abi.router,
      functionName: "swap",
      args: [request],
      account,
      value: n,
      blockNumber: snapshot.block,
    });
    const output = sim.result as [bigint, bigint];
    const math = swapStep(
      true,
      n,
      snapshot.sqrt,
      snapshot.lower,
      snapshot.positionLiquidity,
    );
    if (output[0] !== math.input || output[1] !== math.output)
      throw Error("Exact swap math mismatch");
    simulations.push({ amount, account, result: output, math, match: true });
  } catch (e) {
    simulations.push({ amount, account, error: (e as Error).message });
  }
}
const result = {
  checkedAt: new Date().toISOString(),
  block: snapshot.block,
  rate: snapshot.p,
  fullyUnlocked: snapshot.fullyUnlocked,
  history: {
    from: index.from,
    to: index.to,
    complete: index.complete,
    eventCount: index.events.length,
    kinds: index.events.reduce(
      (x, e) => ({ ...x, [e.kind]: (x[e.kind] ?? 0) + 1 }),
      {} as Record<string, number>,
    ),
    error: index.error,
  },
  holders,
  arithmetic,
  proofs: {
    count: tree.leaves.length,
    allValid: true,
    completeRoot: full.root,
    nativeRoot: root.root,
  },
  buySimulations: simulations,
  notes: [
    "Only eth_call and read operations. No transaction was broadcast.",
    "No state overrides were used for these live simulations.",
  ],
};
const evidenceJson =
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
fs.mkdirSync("../artifacts", { recursive: true });
fs.writeFileSync("../artifacts/live-interactions.json", evidenceJson);
fs.writeFileSync("public/evidence/live-interactions.json", evidenceJson);
console.log(
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
