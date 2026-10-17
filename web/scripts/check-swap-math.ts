/** Cross-language fee/delta regression: the frontend's BigInt math versus the vendored v4 SwapMath. No network write. */
import fs from "node:fs";
import { loadSnapshot } from "../src/live";
import { swapStep } from "../src/math";
const s = await loadSnapshot();
const amounts = [
  1n,
  10n,
  10000n,
  10n ** 12n,
  10n ** 18n,
  10n ** 24n,
  (1n << 127n) - 1n,
];
const vectors = [];
for (const buy of [true, false])
  for (const amount of amounts) {
    const limit = buy ? s.lower : s.upper;
    vectors.push({
      buy,
      amount,
      sqrt: s.sqrt,
      limit,
      L: s.positionLiquidity,
      ...swapStep(buy, amount, s.sqrt, limit, s.positionLiquidity),
    });
  }
const calls = vectors
  .map(
    (v) =>
      `check(${v.sqrt},${v.limit},${v.L},${v.amount},${v.sqrtAfter},${v.input - v.fee},${v.output},${v.fee});`,
  )
  .join("\n");
fs.mkdirSync("../test/scratch", { recursive: true });
fs.mkdirSync("../artifacts", { recursive: true });
fs.writeFileSync(
  "../test/scratch/FrontendSwapMath.t.sol",
  `// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\nimport {Test} from "forge-std/Test.sol";\nimport {SwapMath} from "v4-core/src/libraries/SwapMath.sol";\ncontract FrontendSwapMathTest is Test {\nfunction check(uint160 current,uint160 target,uint128 L,uint256 amount,uint160 expectedSqrt,uint256 expectedIn,uint256 expectedOut,uint256 expectedFee) internal pure { (uint160 actualSqrt,uint256 actualIn,uint256 actualOut,uint256 actualFee)=SwapMath.computeSwapStep(current,target,L,-int256(amount),12500); assertEq(actualSqrt,expectedSqrt);assertEq(actualIn,expectedIn);assertEq(actualOut,expectedOut);assertEq(actualFee,expectedFee);}\nfunction test_BigIntFrontendMatchesV4IncludingBothDirectionsAndPartialFills() public pure {\n${calls}\n}\n}\n`,
);
fs.writeFileSync(
  "../artifacts/swap-math-vectors.json",
  JSON.stringify(
    { block: s.block, vectors },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  `Generated ${vectors.length} same-block swap vectors, including both directions and partial fills. Run forge test --match-contract FrontendSwapMathTest.`,
);
