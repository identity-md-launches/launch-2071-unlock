import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
} from "viem";
import { encodeImdSwap } from "../src/mainnetSwap";
import {
  TOKEN,
  HOOK,
  IMD,
  POOL_ID,
  POOL_KEY,
  UNIVERSAL_ROUTER,
  verifiedMatureQuota,
  successorFee,
} from "../src/mainnet";
import { executeAbi } from "../src/mainnetAbis";
import {
  parseAmount,
  parseSlippage,
  fmt,
  quoteCurrent,
  feeBreakdown,
  type Quote,
} from "../src/trading";
import { verifyProof } from "../src/rewards";
test("all standard modes enforce launch2071 sorted key, empty hookData, execution-account take and zero native funding", () => {
  for (const mode of [
    "buyExactIn",
    "buyExactOut",
    "sellExactIn",
    "sellExactOut",
  ] as const) {
    const plan = encodeImdSwap(TOKEN, HOOK, mode, 100n, 1n, 999n);
    assert.equal(plan.to, UNIVERSAL_ROUTER);
    assert.equal(plan.value, 0n);
    const { args } = decodeFunctionData({ abi: executeAbi, data: plan.data });
    assert.equal(args![0], "0x10");
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      args![1][0],
    );
    assert.equal(actions, mode.endsWith("ExactIn") ? "0x060c0f" : "0x080c0f");
    const [swap] = decodeAbiParameters(
      parseAbiParameters(
        "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amount,uint128 limit,bytes hookData)",
      ),
      params[0],
    );
    assert.equal(swap.poolKey.currency0.toLowerCase(), TOKEN.toLowerCase());
    assert.equal(swap.poolKey.currency1.toLowerCase(), IMD.toLowerCase());
    assert.equal(swap.poolKey.fee, 12500);
    assert.equal(swap.poolKey.tickSpacing, 60);
    assert.equal(swap.hookData, "0x");
    assert.equal(swap.zeroForOne, !mode.startsWith("buy"));
    // The single dynamic tuple is prefixed by an ABI offset. Decode its actual type as the router does.

    const [input] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[1],
    );
    const [output] = decodeAbiParameters(
      parseAbiParameters("address,uint256"),
      params[2],
    );
    assert.equal(
      input.toLowerCase(),
      (mode.startsWith("buy") ? IMD : TOKEN).toLowerCase(),
    );
    assert.equal(
      output.toLowerCase(),
      (mode.startsWith("buy") ? TOKEN : IMD).toLowerCase(),
    );
  }
  assert.throws(
    () => encodeImdSwap(IMD, HOOK, "buyExactIn", 1n, 1n, 999n),
    /verified/,
  );
  assert.throws(
    () => encodeImdSwap(TOKEN, IMD, "buyExactIn", 1n, 1n, 999n),
    /verified/,
  );
});
test("PoolKey hashes to deployed PoolId", () => {
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
    ),
    [POOL_KEY],
  );
  assert.equal(keccak256(encoded), POOL_ID);
  assert(BigInt(TOKEN) < BigInt(IMD));
});
test("mature accounting counts past sales and bypasses for every holder at final gate", () => {
  assert.equal(verifiedMatureQuota(1000n, 1000n, 200n, 3000n, false), 100n);
  assert.equal(verifiedMatureQuota(1500n, 1000n, 300n, 3000n, false), 0n);
  assert.equal(verifiedMatureQuota(1500n, 1500n, 300n, 3000n, false), 150n);
  assert.equal(
    verifiedMatureQuota(0n, 0n, 100n, 10000n, true),
    (1n << 256n) - 1n,
  );
  assert.throws(() => verifiedMatureQuota(1n, 2n, 0n, 2000n, false));
});
test("raw units and fee rounding preserve conservation", () => {
  for (let amount = 0n; amount < 20000n; amount++) {
    const b = successorFee("buyExactIn", amount);
    assert.equal(b.poolLeg + b.fee, amount);
    const s = successorFee("sellExactOut", amount);
    assert.equal(s.poolLeg - s.fee, amount);
    const net = amount - (amount * 75n) / 10000n;
    const f = feeBreakdown(false, 1n, net, 0, 12500);
    assert(f.poolLeg === amount || f.poolLeg === amount - 1n);
  }
});
test("protocol fee uses direction and compounded pips", () => {
  const packed = 1000 | (2000 << 12);
  const buy = feeBreakdown(true, 10n ** 18n, 10n ** 18n, packed, 12500);
  const sell = feeBreakdown(false, 10n ** 18n, 10n ** 18n, packed, 12500);
  assert.equal(buy.protocolPips, 2000n);
  assert.equal(sell.protocolPips, 1000n);
  assert.equal(buy.effectivePips, 14475n);
  assert.equal(sell.effectivePips, 13488n);
});
test("amount validation rejects floats, zero, exponent, excess decimals and uint128 overflow", () => {
  assert.equal(parseAmount("0.000000000000000001"), 1n);
  for (const x of [
    "0",
    "-1",
    "1e3",
    "NaN",
    "0.0000000000000000001",
    String(1n << 128n),
  ])
    assert.throws(() => parseAmount(x));
});
test("quote invalidates on account, direction, amount, slippage or 30 second expiry", () => {
  const q = {
    account: TOKEN,
    buy: true,
    amount: 1n,
    slippage: 50,
    createdAt: 1000,
  } as Quote;
  assert(quoteCurrent(q, TOKEN, true, 1n, 50, 2000));
  assert(!quoteCurrent(q, IMD, true, 1n, 50, 2000));
  assert(!quoteCurrent(q, TOKEN, false, 1n, 50, 2000));
  assert(!quoteCurrent(q, TOKEN, true, 2n, 50, 2000));
  assert(!quoteCurrent(q, TOKEN, true, 1n, 100, 2000));
  assert(!quoteCurrent(q, TOKEN, true, 1n, 50, 31000));
});
test("all delivered native proofs match the certified onchain root", () => {
  const tree = JSON.parse(
    fs.readFileSync("public/claims/round-0.json", "utf8"),
  );
  assert.equal(
    tree.root,
    "0x95d12621d6d028111c44dad35069cf1ffb0441e910fcafedecb1752e6ce2c5e8",
  );
  assert.equal(tree.leaves.length, 461);
  assert(tree.leaves.every((leaf: any) => verifyProof(leaf, tree.root)));
  assert.equal(
    tree.leaves.reduce((s: bigint, l: any) => s + BigInt(l.amount), 0n),
    100000000n * 10n ** 18n,
  );
});

test("slippage decimal parsing avoids floating-point bps drift", () => {
  assert.equal(parseSlippage("0.29"), 29);
  assert.equal(parseSlippage("3.33"), 333);
  assert.equal(parseSlippage("0.01"), 1);
  assert.equal(parseSlippage("5"), 500);
  for (const s of ["0", "5.01", "1e2", "2.001"])
    assert.throws(() => parseSlippage(s));
});
test("display formatting keeps bigint precision and never rounds a nonzero balance to zero", () => {
  assert.equal(fmt(1n), "<0.000001");
  assert.equal(fmt(123456789012345678901234567890n), "123,456,789,012.345678");
  assert.equal(fmt(null), "Unavailable");
  assert.equal(fmt(0n), "0");
});
