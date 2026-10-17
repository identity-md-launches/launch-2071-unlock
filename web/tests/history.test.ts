import test from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import { readPoolHistory } from "../src/poolHistory";
import { DEPLOYMENT_BLOCK } from "../src/config";
import { POOL_ID, POOL_MANAGER } from "../src/mainnet";
const hash = `0x${"a".repeat(64)}` as const;
function fixture(logs: unknown[] = []) {
  const calls: any[] = [];
  const head = {
    number: DEPLOYMENT_BLOCK + 20000n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    hash,
  };
  const reader = {
    getChainId: async () => 1,
    getBlock: async () => head,
    getLogs: async (args: unknown) => {
      calls.push(args);
      return logs;
    },
  };
  return { head, calls, reader };
}
test("history reports bounded complete empty coverage and pins the official pool", async () => {
  const f = fixture();
  const r = await readPoolHistory(
    10000,
    undefined,
    f.reader as unknown as PublicClient,
  );
  assert.equal(f.calls.length, 5);
  assert.equal(r.from, f.head.number - 9999n);
  assert.equal(r.to, f.head.number);
  assert.equal(r.toHash, hash);
  assert.deepEqual(r.trades, []);
  for (const call of f.calls) {
    assert.equal(call.address, POOL_MANAGER);
    assert.equal(call.args.id, POOL_ID);
    assert.equal(call.toBlock - call.fromBlock, 1999n);
  }
});
test("history uses actual v4 signed deltas for buy/sell and pool-leg amounts", async () => {
  const f = fixture([
    {
      removed: false,
      blockNumber: DEPLOYMENT_BLOCK + 20000n,
      logIndex: 1,
      transactionHash: hash,
      args: {
        amount0: 4n * 10n ** 18n,
        amount1: -2n * 10n ** 18n,
        sqrtPriceX96: 2n ** 96n,
      },
    },
    {
      removed: false,
      blockNumber: DEPLOYMENT_BLOCK + 20000n,
      logIndex: 2,
      transactionHash: hash,
      args: {
        amount0: -1n * 10n ** 18n,
        amount1: 5n * 10n ** 17n,
        sqrtPriceX96: 2n ** 96n,
      },
    },
  ]);
  const r = await readPoolHistory(
    2000,
    undefined,
    f.reader as unknown as PublicClient,
  );
  assert.equal(r.trades[0].buy, true);
  assert.equal(r.trades[1].buy, false);
  assert.equal(r.trades[0].unlk, 4n * 10n ** 18n);
  assert.equal(r.trades[0].imd, 2n * 10n ** 18n);
  assert.equal(r.trades[0].price, 1);
});
test("history rejects stale or wrong-chain data, reorgs, incomplete scans and cancellation", async () => {
  const f = fixture();
  await assert.rejects(
    readPoolHistory(2000, undefined, {
      ...f.reader,
      getChainId: async () => 8453,
    } as unknown as PublicClient),
    /mainnet/,
  );
  await assert.rejects(
    readPoolHistory(2000, undefined, {
      ...f.reader,
      getBlock: async () => ({ ...f.head, timestamp: 1n }),
    } as unknown as PublicClient),
    /stale/,
  );
  let reads = 0;
  await assert.rejects(
    readPoolHistory(2000, undefined, {
      ...f.reader,
      getBlock: async () => ({
        ...f.head,
        hash: ++reads === 1 ? hash : "changed",
      }),
    } as unknown as PublicClient),
    /changed/,
  );
  await assert.rejects(
    readPoolHistory(10000, undefined, {
      ...f.reader,
      getLogs: async () => {
        throw Error("RPC refused range");
      },
    } as unknown as PublicClient),
    /refused/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    readPoolHistory(2000, abort.signal, f.reader as unknown as PublicClient),
  );
});
