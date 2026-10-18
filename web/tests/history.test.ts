import test from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import {
  abortable,
  buildCandles,
  historyBackoff,
  priceFromSqrt,
  readPoolHistory,
  type PoolTrade,
} from "../src/poolHistory";
import { DEPLOYMENT_BLOCK } from "../src/config";
import { POOL_ID, POOL_MANAGER, STATE_VIEW } from "../src/mainnet";
const hash = `0x${"a".repeat(64)}` as const;
function fixture(logs: any[] = []) {
  const calls: any[] = [];
  const head = {
    number: DEPLOYMENT_BLOCK + 20000n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    hash,
  };
  const reader = {
    getChainId: async () => 1,
    getBlock: async (args: any = {}) => ({
      ...head,
      number: args.blockNumber ?? head.number,
      timestamp:
        head.timestamp -
        (head.number - (args.blockNumber ?? head.number)) * 12n,
    }),
    readContract: async (args: any) => {
      assert.equal(args.address, STATE_VIEW);
      assert.deepEqual(args.args, [POOL_ID]);
      return [2n ** 96n, 0, 0, 12500];
    },
    getLogs: async (args: any) => {
      calls.push(args);
      return logs.filter(
        (l) => l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock,
      );
    },
  };
  return { head, calls, reader, client: reader as unknown as PublicClient };
}
function log(block: bigint, index = 1, overrides: any = {}) {
  return {
    removed: false,
    blockNumber: block,
    blockHash: hash,
    logIndex: index,
    transactionHash: hash,
    args: {
      id: POOL_ID,
      amount0: 4n * 10n ** 18n,
      amount1: -2n * 10n ** 18n,
      sqrtPriceX96: 2n ** 96n,
    },
    ...overrides,
  };
}
test("complete empty coverage pins official pool, block timestamps and current state", async () => {
  const f = fixture();
  const r = await readPoolHistory(10000, undefined, f.client);
  assert.equal(f.calls.length, 5);
  assert.equal(r.from, f.head.number - 9999n);
  assert.equal(r.toHash, hash);
  assert.equal(r.fromTime, Number(f.head.timestamp) - 9999 * 12);
  assert.equal(r.spot, 1);
  assert.deepEqual(r.trades, []);
  for (const c of f.calls) {
    assert.equal(c.address, POOL_MANAGER);
    assert.equal(c.args.id, POOL_ID);
    assert.equal(c.toBlock - c.fromBlock, 1999n);
  }
});
test("signed deltas give executed volumes; sqrt gives spot independently from execution averages", async () => {
  const f = fixture();
  const a = log(f.head.number);
  const b = log(f.head.number, 2, {
    args: {
      id: POOL_ID,
      amount0: -(10n ** 18n),
      amount1: 5n * 10n ** 17n,
      sqrtPriceX96: 2n ** 97n,
    },
  });
  f.reader.getLogs = async (args: any) => {
    f.calls.push(args);
    return [
      a,
      a,
      b,
      { ...a, removed: true },
      { ...a, args: { ...a.args, id: "unrelated" } },
    ];
  };
  const r = await readPoolHistory(2000, undefined, f.client);
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[0].buy, true);
  assert.equal(r.trades[1].buy, false);
  assert.equal(r.trades[0].unlk, 4n * 10n ** 18n);
  assert.equal(r.trades[0].imd, 2n * 10n ** 18n);
  assert.equal(r.trades[0].price, 1);
  assert.equal(r.trades[1].price, 4);
  assert.equal(r.trades[0].time, Number(f.head.timestamp));
});
test("incremental cache replaces overlap, deduplicates and restarts after deep reorg", async () => {
  const f = fixture();
  const block = f.head.number - 15n;
  let logs = [log(block), log(f.head.number, 3)];
  f.reader.getLogs = async (args: any) => {
    f.calls.push(args);
    return logs.filter(
      (l) => l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock,
    );
  };
  await readPoolHistory(2000, undefined, f.client);
  f.head.number += 1n;
  f.head.timestamp += 12n;
  logs = [log(block), log(f.head.number, 3)];
  const next = await readPoolHistory(2000, undefined, f.client);
  assert.equal(f.calls.at(-1).toBlock - f.calls.at(-1).fromBlock, 12n);
  assert.deepEqual(
    next.trades.map((t) => t.block),
    [block, f.head.number],
  );
  const original = f.reader.getBlock;
  f.reader.getBlock = async (args: any = {}) => ({
    ...(await original(args)),
    hash: args.blockNumber === next.to ? `0x${"b".repeat(64)}` : hash,
  });
  f.head.number += 1n;
  f.head.timestamp += 12n;
  logs = [];
  const before = f.calls.length;
  await readPoolHistory(2000, undefined, f.client);
  assert.equal(f.calls[before].toBlock - f.calls[before].fromBlock, 1999n);
});
test("range-limited free providers split scans without losing coverage", async () => {
  const f = fixture();
  f.reader.getLogs = async (args: any) => {
    f.calls.push(args);
    if (args.toBlock - args.fromBlock > 9n)
      throw Error("up to a 10 block range");
    return [];
  };
  const r = await readPoolHistory(2000, undefined, f.client);
  assert.equal(r.to - r.from, 1999n);
  assert.equal(
    f.calls.filter((c) => c.toBlock - c.fromBlock <= 9n).length,
    200,
  );
});
test("stale, wrong-chain, reorg, partial failure and cancellation never become empty history", async () => {
  let f = fixture();
  f.reader.getChainId = async () => 8453;
  await assert.rejects(readPoolHistory(2000, undefined, f.client), /mainnet/);
  f = fixture();
  f.head.timestamp = 1n;
  await assert.rejects(readPoolHistory(2000, undefined, f.client), /stale/);
  f = fixture();
  let heads = 0;
  const original = f.reader.getBlock;
  f.reader.getBlock = async (args: any = {}) => ({
    ...(await original(args)),
    hash:
      args.blockNumber === f.head.number && ++heads > 0
        ? (`0x${"b".repeat(64)}` as const)
        : hash,
  });
  await assert.rejects(readPoolHistory(2000, undefined, f.client), /changed/);
  f = fixture();
  f.reader.getLogs = async () => {
    throw Error("RPC refused range");
  };
  await assert.rejects(readPoolHistory(10000, undefined, f.client), /refused/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readPoolHistory(2000, abort.signal, fixture().client));
  const active = new AbortController();
  const pending = abortable(new Promise<never>(() => {}), active.signal);
  active.abort();
  await assert.rejects(pending);
});
test("OHLC buckets use actual timestamp/order and executed volume, leaving no-trade gaps", () => {
  const trade = (time: number, index: number, p: number): PoolTrade => ({
    block: BigInt(time),
    blockHash: hash,
    time,
    index,
    hash,
    buy: true,
    unlk: 2n,
    imd: 3n,
    price: p,
  });
  const input = [
    trade(121, 3, 4),
    trade(61, 1, 2),
    trade(119, 2, 1),
    trade(360, 4, 3),
  ];
  const c = buildCandles([...input, input[0]], 60);
  assert.deepEqual(
    c.map((c) => c.time),
    [60, 120, 360],
  );
  assert.deepEqual(c[0], {
    time: 60,
    open: 2,
    high: 2,
    low: 1,
    close: 1,
    unlk: 4n,
    imd: 6n,
    trades: 2,
  });
  assert.equal(c[1].trades, 1);
  assert.throws(() => buildCandles([], 7), /interval/);
});
test("price units handle direction, decimal scaling and invalid values; backoff is bounded", () => {
  assert.equal(priceFromSqrt(2n ** 97n), 4);
  assert.equal(priceFromSqrt(2n ** 97n, false), 0.25);
  assert.equal(priceFromSqrt(2n ** 96n, true, 18, 6), 1e12);
  assert.throws(() => priceFromSqrt(0n));
  assert.throws(() => priceFromSqrt(2n ** 160n));
  assert.deepEqual(
    [0, 1, 2, 3, 20].map(historyBackoff),
    [15000, 30000, 60000, 120000, 120000],
  );
});
