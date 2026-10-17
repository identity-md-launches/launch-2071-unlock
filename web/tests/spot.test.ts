import test from "node:test";
import assert from "node:assert/strict";
import { composeSpot, decodeSlot0, ethPerImd, imdPerUnlk, poolStateSlot, validEthUsd, IMD_ETH_POOL_ID } from "../src/spotPrice";

// Recorded block 26203792: tick 58773 (~357 IMD per ETH) and Chainlink ETH/USD 2452.69414514.
const sqrtAt58773 = BigInt(Math.floor(Math.sqrt(1.0001 ** 58773) * 2 ** 48)) * (1n << 48n);
const ethUsd = 245269414514n;

test("IMD/ETH direction: ETH per IMD is the inverse of the pool's IMD-per-ETH price", () => {
  const perImd = Number(ethPerImd(sqrtAt58773)) / 1e18;
  assert.ok(Math.abs(perImd - 1 / 1.0001 ** 58773) / perImd < 1e-9);
  const usd = Number(composeSpot(sqrtAt58773, ethUsd).usdPerImd) / 1e18;
  assert.ok(usd > 6.8 && usd < 6.9, `USD per IMD ${usd}`);
});

test("UNLK leg follows sorted PoolKey order and FDV uses fixed 1B supply", () => {
  const sqrtTwo = BigInt(Math.floor(Math.SQRT2 * 2 ** 48)) * (1n << 48n); // currency1 per currency0 = 2
  assert.ok(Math.abs(Number(imdPerUnlk(sqrtTwo, true)) / 1e18 - 2) < 1e-9);
  assert.ok(Math.abs(Number(imdPerUnlk(sqrtTwo, false)) / 1e18 - 0.5) < 1e-9);
  const spot = composeSpot(sqrtAt58773, ethUsd, { sqrtPriceX96: sqrtTwo, unlkIs0: false });
  assert.equal(spot.fdv, spot.usdPerUnlk! * 1_000_000_000n);
  assert.ok(Math.abs(Number(spot.usdPerUnlk!) / Number(spot.usdPerImd) - 0.5) < 1e-9);
  assert.equal(composeSpot(sqrtAt58773, ethUsd).fdv, null, "no UNLK pool: FDV unavailable, never zero");
});

test("Chainlink validation mirrors the contract and fails closed", () => {
  const ok = { decimals: 8, roundId: 5n, answer: ethUsd, updatedAt: 1000n, answeredInRound: 5n };
  assert.equal(validEthUsd(ok, 1000n + 5400n), ethUsd);
  assert.throws(() => validEthUsd(ok, 1000n + 5401n), /stale/);
  assert.throws(() => validEthUsd({ ...ok, updatedAt: 2000n }, 1000n), /future/);
  assert.throws(() => validEthUsd({ ...ok, answer: 0n }, 1000n), /incomplete/);
  assert.throws(() => validEthUsd({ ...ok, answeredInRound: 4n }, 1000n), /incomplete/);
  assert.throws(() => validEthUsd({ ...ok, decimals: 18 }, 1000n), /decimals/);
  assert.throws(() => ethPerImd(0n), /not initialized/);
});

test("slot0 decoding handles negative ticks and the v4 state slot", () => {
  const word = (BigInt(10000) << 208n) | (BigInt(0x3e83e8) << 184n) | (BigInt(0x1000000 - 5) << 160n) | 123n;
  const decoded = decodeSlot0(`0x${word.toString(16).padStart(64, "0")}`);
  assert.deepEqual(decoded, { sqrtPriceX96: 123n, tick: -5, lpFee: 10000 });
  assert.match(poolStateSlot(IMD_ETH_POOL_ID), /^0x[0-9a-f]{64}$/);
});
