/** Generate disposable cross-language vectors against the actual hook in the existing local fixture. */
import fs from "node:fs";
import { allowance, RATES, UNIT } from "../src/math";

const MAX = (1n << 256n) - 1n;
const ledgers = [
  { W: 1250n * UNIT, E: 1500n * UNIT, S: 250n * UNIT },
  { W: 100n * UNIT, E: 0n, S: 0n },
  { W: 0n, E: 100n * UNIT, S: 0n },
  { W: 2n, E: 7n, S: 0n },
  { W: 1000n * UNIT, E: 3n, S: 1n },
  { W: MAX, E: MAX, S: MAX / 3n },
];
const vectors = ledgers.flatMap((v) =>
  RATES.map((p) => ({ ...v, p, fullyUnlocked: p === 10000n })),
);
// The bypass bit, rather than a bare 100% rate, grants rights to transfer-only holders.
vectors.push({ W: 100n * UNIT, E: 0n, S: 0n, p: 10000n, fullyUnlocked: false });
const cases = vectors.map((v) => ({
  ...v,
  expected: allowance(v.W, v.E, v.S, v.p, v.fullyUnlocked),
}));
const calls = cases
  .map(
    (v) =>
      `check(${v.W}, ${v.E}, ${v.S}, ${v.p}, ${v.fullyUnlocked}, ${v.expected.quota ?? MAX}, ${v.expected.within}, ${v.expected.outside});`,
  )
  .join("\n");
fs.mkdirSync("../test/scratch", { recursive: true });
fs.mkdirSync("../artifacts", { recursive: true });
fs.writeFileSync(
  "../test/scratch/FrontendAllowance.t.sol",
  `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SystemFixture} from "../fixtures/SystemFixture.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
contract FrontendAllowanceTest is SystemFixture {
  using stdStorage for StdStorage;
  // Artificial ledger boundaries run only in the existing local fixture; never on public Sepolia.
  function check(uint256 W, uint256 E, uint256 S, uint16 p, bool full, uint256 expectedQuota, uint256 expectedWithin, uint256 expectedOutside) internal {
    stdstore.target(address(token)).sig(token.balanceOf.selector).with_key(alice).checked_write(W);
    stdstore.target(address(hook)).sig(hook.eligible.selector).with_key(alice).checked_write(E);
    stdstore.target(address(hook)).sig(hook.sold.selector).with_key(alice).checked_write(S);
    stdstore.target(address(hook)).sig(hook.p.selector).enable_packed_slots().checked_write(p);
    stdstore.target(address(hook)).sig(hook.fullyUnlocked.selector).enable_packed_slots().checked_write(full);
    uint256 quota = hook.remainingQuota(alice);
    uint256 balance = token.balanceOf(alice);
    uint256 within = full ? balance : (balance < quota ? balance : quota);
    assertEq(quota, expectedQuota);
    assertEq(within, expectedWithin);
    assertEq(balance - within, expectedOutside);
  }
  function test_FrontendAllowanceMatchesHookAtEveryTier() public {
${calls}
  }
}
`,
);
fs.writeFileSync(
  "../artifacts/allowance-vectors.json",
  JSON.stringify(
    {
      note: "Artificial ledger fixtures compared with the actual UnlkHook.remainingQuota. No public state override or transaction.",
      cases,
    },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  `Generated ${cases.length} exact wallet vectors. Run forge test --match-contract FrontendAllowanceTest.`,
);
