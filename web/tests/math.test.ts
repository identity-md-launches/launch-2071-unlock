import test from "node:test";
import assert from "node:assert/strict";
import {
  allowance,
  scenario,
  UNIT,
  RATES,
  parseAmount,
  minReceipt,
  confirmationState,
  swapStep,
} from "../src/math";
import { prepareTree, verifyProof, type ClaimTree } from "../src/rewards.ts";
import fs from "node:fs";

test("wallet allowance uses exact floors, sales and balance caps", () => {
  assert.deepEqual(allowance(1250n * UNIT, 1500n * UNIT, 250n * UNIT, 2500n), {
    within: 125n * UNIT,
    outside: 1125n * UNIT,
    quota: 125n * UNIT,
    cap: 375n * UNIT,
  });
  assert.equal(allowance(2n, 7n, 0n, 3500n).within, 2n);
  assert.equal(allowance(100n, 3n, 1n, 2500n).within, 0n);
  assert.equal(allowance(4n, 1000n, 0n, 2500n).within, 4n);
  assert.equal(allowance(100n * UNIT, 0n, 0n, 8500n).within, 0n);
  assert.equal(
    allowance(100n * UNIT, 0n, 10000n * UNIT, 10000n, true).within,
    100n * UNIT,
  );
  assert.equal(allowance(100n, 10000n, 0n, 10000n, true).quota, null);
  assert.throws(() => allowance(-1n, 0n, 0n, 2500n));
});
test("scenario holds ledger fixed, final unlock includes transfer-only balances, achieved tiers never imply revoked rights", () => {
  assert.equal(
    scenario(1250n * UNIT, 1500n * UNIT, 250n * UNIT, 3500n, 2500n).within,
    275n * UNIT,
  );
  assert.equal(
    scenario(1250n * UNIT, 1500n * UNIT, 250n * UNIT, 3500n, 2500n).increase,
    150n * UNIT,
  );
  assert.equal(scenario(100n, 0n, 0n, 10000n, 2500n).within, 100n);
  assert.equal(scenario(1000n, 1000n, 0n, 2500n, 7000n).within, 700n);
  assert.equal(scenario(1000n, 1000n, 0n, 2500n, 7000n).increase, 0n);
});
test("large BigInt values and all tiers retain monotonic allowance", () => {
  for (let i = 0n; i < 200n; i++) {
    const E = (1n << 190n) + i * UNIT;
    const W = E / 2n;
    const S = E / 7n;
    let before = 0n;
    for (const p of RATES) {
      const c = allowance(W, E, S, p, p === 10000n);
      assert.ok(c.within >= before);
      assert.ok(c.within <= W);
      assert.equal(c.within + c.outside, W);
      before = c.within;
    }
  }
});
test("input and slippage reject unsafe formats and preserve a wei", () => {
  assert.equal(parseAmount("0.000000000000000001"), 1n);
  for (const x of [
    "",
    "0",
    "-1",
    "1e3",
    "1,000",
    " 1",
    "1.0000000000000000001",
    "Infinity",
  ])
    assert.throws(() => parseAmount(x));
  assert.equal(minReceipt(101n, 50n), 100n);
  assert.throws(() => minReceipt(100n, 501n));
});
const base = {
  tier: 0,
  fullyUnlocked: false,
  qualifyingSince: 1000n,
  lastConfirmation: 2000n,
  timestamp: 2200n,
  fdv: 100000n * UNIT,
  minInterval: 240n,
  maxGap: 600n,
  confirmation: 21600n,
  finalConfirmation: 86400n,
};
test("oracle progress distinguishes invalid, stale, gap, below target and elapsed-but-unconfirmed", () => {
  assert.match(confirmationState({ ...base, fdv: null }).label, /unavailable/);
  assert.match(
    confirmationState({ ...base, timestamp: 2700n }).label,
    /gap exceeded/,
  );
  assert.equal(confirmationState({ ...base, timestamp: 2700n }).progress, 0);
  assert.match(confirmationState({ ...base, fdv: 1n }).label, /resets/);
  assert.match(
    confirmationState({ ...base, timestamp: 22700n, lastConfirmation: 22600n })
      .label,
    /valid on-chain update/,
  );
  assert.equal(confirmationState({ ...base, tier: 5 }).required, 86400n);
  assert.equal(
    confirmationState({ ...base, fullyUnlocked: true }).progress,
    100,
  );
});
test("real native round proofs reject wrong amount, recipient, incomplete tree and duplicates", () => {
  const tree: ClaimTree = JSON.parse(
    fs.readFileSync("public/evidence/round-0.json", "utf8"),
  );
  assert.equal(tree.leaves.length, 459);
  assert.equal(prepareTree(tree).root, tree.root);
  for (const leaf of tree.leaves)
    assert.equal(verifyProof(leaf, tree.root), true);
  assert.equal(
    verifyProof(
      {
        ...tree.leaves[0],
        amount: (BigInt(tree.leaves[0].amount) + 1n).toString(),
      },
      tree.root,
    ),
    false,
  );
  assert.equal(
    verifyProof(
      { ...tree.leaves[0], wallet: tree.leaves[1].wallet },
      tree.root,
    ),
    false,
  );
  assert.throws(() => prepareTree({ ...tree, leaves: tree.leaves.slice(1) }));
  assert.throws(() =>
    prepareTree({ ...tree, leaves: [...tree.leaves, tree.leaves[0]] }),
  );
});
test("live same-block buy simulations match exact fee/delta arithmetic", () => {
  const evidence = JSON.parse(
    fs.readFileSync("public/evidence/live-interactions.json", "utf8"),
  );
  assert.ok(evidence.buySimulations.length >= 3);
  for (const s of evidence.buySimulations) {
    assert.equal(s.match, true);
    assert.equal(BigInt(s.result[0]), BigInt(s.math.input));
    assert.equal(BigInt(s.result[1]), BigInt(s.math.output));
    assert.ok(BigInt(s.math.fee) > 0n);
  }
  for (const row of evidence.arithmetic) {
    const got = allowance(
      BigInt(row.W),
      BigInt(row.E),
      BigInt(row.S),
      BigInt(evidence.rate),
      evidence.fullyUnlocked,
    );
    if (!evidence.fullyUnlocked)
      assert.equal(got.quota, BigInt(row.contractRemainingQuota));
    else assert.equal(got.within, BigInt(row.W));
  }
});
test("swap step accounts exact fees and partial fills in both directions", () => {
  const Q = 1n << 96n,
    L = 1000000n * UNIT,
    lo = Q / 2n,
    hi = Q * 2n;
  for (const buy of [true, false]) {
    const full = swapStep(buy, 100n * UNIT, Q, buy ? lo : hi, L);
    assert.equal(full.input, 100n * UNIT);
    assert.ok(full.output > 0n);
    assert.equal(full.partial, false);
    const partial = swapStep(buy, 10000000n * UNIT, Q, buy ? lo : hi, L);
    assert.equal(partial.partial, true);
    assert.equal(partial.sqrtAfter, buy ? lo : hi);
    assert.equal(
      partial.fee,
      ((partial.input - partial.fee) * 12500n + 987499n) / 987500n,
    );
  }
});

test("percentage fills floor in wei, reserve gas and never exceed spendable balance", async () => {
  const { shortcutAmount, gasReserve } = await import("../src/math");
  const reserve = gasReserve(230001n, 17000000000n);
  assert.equal(reserve, 4692020400000000n);
  for (const percent of [25, 50, 75, 100]) {
    const result = shortcutAmount(UNIT, percent, reserve);
    assert.equal(result, ((UNIT - reserve) * BigInt(percent)) / 100n);
    assert.ok(result + reserve <= UNIT);
  }
  assert.equal(shortcutAmount(7n, 25), 1n);
  assert.equal(shortcutAmount(10n, 100, 11n), 0n);
  assert.throws(() => shortcutAmount(10n, 101));
  assert.throws(() => shortcutAmount(-1n, 25));
});
test("confirmation progress does not increase merely because the clock advances", () => {
  const s = {
    ...base,
    qualifyingSince: 1000n,
    lastConfirmation: 2000n,
    timestamp: 2001n,
  };
  assert.equal(
    confirmationState(s).progress,
    confirmationState({ ...s, timestamp: 2200n }).progress,
  );
  assert.equal(confirmationState({ ...s, fdv: null }).progress, 0);
  assert.equal(confirmationState({ ...s, fdv: 1n }).progress, 0);
});
