import { parseAbiItem, type PublicClient } from "viem";
import { mainnetClient, POOL_ID, POOL_MANAGER, STATE_VIEW } from "./mainnet";
import { DEPLOYMENT_BLOCK, stateAbi } from "./config";

export const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
export interface PoolTrade {
  block: bigint;
  blockHash: string;
  time: number; // Unix seconds from the canonical block, never an event index.
  index: number;
  hash: `0x${string}`;
  buy: boolean;
  unlk: bigint;
  imd: bigint;
  price: number; // Post-swap pool spot, NOT amount1 / amount0.
}
export interface PoolHistory {
  from: bigint;
  fromTime: number;
  to: bigint;
  toTime: number;
  toHash: string;
  readAt: number;
  spot: number;
  trades: PoolTrade[];
}
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  unlk: bigint;
  imd: bigint;
  trades: number;
}
// Currency0 is UNLK, currency1 is IMD; both have 18 decimals, checked by the mainnet reader.
export function priceFromSqrt(
  sqrt: bigint,
  tokenIs0 = true,
  decimals0 = 18,
  decimals1 = 18,
): number {
  if (sqrt <= 0n || sqrt >= 2n ** 160n) throw Error("Invalid pool price");
  const ratio = (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (decimals0 - decimals1);
  const price = tokenIs0 ? ratio : 1 / ratio;
  if (!Number.isFinite(price) || price <= 0) throw Error("Invalid pool price");
  return price;
}
export function buildCandles(trades: PoolTrade[], interval: number): Candle[] {
  if (![60, 300, 900, 3600, 14400, 86400].includes(interval))
    throw Error("Unsupported candle interval");
  const candles = new Map<number, Candle>();
  const ordered = [...trades].sort(
    (a, b) =>
      a.time - b.time ||
      (a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1),
  );
  const seen = new Set<string>();
  for (const t of ordered) {
    const id = `${t.hash}:${t.index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const time = Math.floor(t.time / interval) * interval;
    const c = candles.get(time);
    if (c) {
      c.high = Math.max(c.high, t.price);
      c.low = Math.min(c.low, t.price);
      c.close = t.price;
      c.unlk += t.unlk;
      c.imd += t.imd;
      c.trades++;
    } else
      candles.set(time, {
        time,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        unlk: t.unlk,
        imd: t.imd,
        trades: 1,
      });
  }
  // No carry-forward bars: a missing bucket has no trades and no candle.
  return [...candles.values()];
}
export const historyBackoff = (failures: number) =>
  Math.min(120000, 15000 * 2 ** Math.min(3, failures));
const caches = new WeakMap<PublicClient, Map<number, PoolHistory>>();
// Stops awaiting promptly on tab/unmount/range change. The shared HTTP transport's bounded
// request may finish in the background; its result can neither update UI nor enter the cache.
export function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", cancel);
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        cleanup();
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
export function cachedPoolHistory(
  count: number,
  reader: PublicClient = mainnetClient,
): PoolHistory | null {
  return caches.get(reader)?.get(count) ?? null;
}
export async function readPoolHistory(
  count: number,
  signal?: AbortSignal,
  reader: PublicClient = mainnetClient,
): Promise<PoolHistory> {
  if (count !== 2000 && count !== 10000)
    throw Error("Choose a supported block range.");
  const wait = <T>(p: Promise<T>) => abortable(p, signal);
  signal?.throwIfAborted();
  if ((await wait(reader.getChainId())) !== 1)
    throw Error("History requires Ethereum mainnet.");
  const head = await wait(reader.getBlock({ blockTag: "latest" }));
  if (!head.hash || Date.now() / 1000 - Number(head.timestamp) > 90)
    throw Error("History RPC is stale. Retry with current mainnet data.");
  const from =
    head.number - BigInt(count) + 1n > DEPLOYMENT_BLOCK
      ? head.number - BigInt(count) + 1n
      : DEPLOYMENT_BLOCK;
  let previous = cachedPoolHistory(count, reader);
  if (
    previous &&
    (previous.to > head.number ||
      previous.to < from ||
      (await wait(reader.getBlock({ blockNumber: previous.to }))).hash !==
        previous.toHash)
  )
    previous = null;
  // Rescan the last 12 blocks even on an unchanged head; deeper reorganizations trigger a full scan above.
  const startAt = previous
    ? previous.to - 11n > from
      ? previous.to - 11n
      : from
    : from;
  const trades: PoolTrade[] =
    previous?.trades.filter((t) => t.block >= from && t.block < startAt) ?? [];
  const blocks = new Map<bigint, { hash: string | null; timestamp: bigint }>([
    [head.number, head],
  ]);
  async function blockAt(number: bigint) {
    const cached = blocks.get(number);
    if (cached) return cached;
    const block = await wait(reader.getBlock({ blockNumber: number }));
    blocks.set(number, block);
    return block;
  }
  async function logsIn(
    start: bigint,
    end: bigint,
  ): Promise<Awaited<ReturnType<typeof reader.getLogs<typeof swapEvent>>>> {
    try {
      return await wait(
        reader.getLogs({
          address: POOL_MANAGER,
          event: swapEvent,
          args: { id: POOL_ID },
          fromBlock: start,
          toBlock: end,
          strict: true,
        }),
      );
    } catch (error) {
      signal?.throwIfAborted();
      // Free providers sometimes impose a smaller range/result cap. Split only those errors.
      if (
        end <= start ||
        !/range|too many|limit.*(?:result|block)|response size/i.test(
          String(error),
        )
      )
        throw error;
      const match = String(error).match(/up to (?:a )?(\d+) block/i);
      const cap = match ? BigInt(match[1]) : (end - start + 1n) / 2n;
      const result: Awaited<ReturnType<typeof logsIn>> = [];
      for (let at = start; at <= end; at += cap * 4n) {
        const ranges = Array.from(
          { length: 4 },
          (_, i) => at + BigInt(i) * cap,
        ).filter((a) => a <= end);
        const pages = await Promise.all(
          ranges.map((a) => logsIn(a, a + cap - 1n < end ? a + cap - 1n : end)),
        );
        result.push(...pages.flat());
      }
      return result;
    }
  }
  for (let start = startAt; start <= head.number; start += 2000n) {
    signal?.throwIfAborted();
    const end = start + 1999n < head.number ? start + 1999n : head.number;
    const logs = await logsIn(start, end);
    const valid = logs.filter(
      (l) =>
        !l.removed &&
        l.blockNumber !== null &&
        l.transactionHash !== null &&
        l.logIndex !== null &&
        (!l.args.id || l.args.id.toLowerCase() === POOL_ID),
    );
    const numbers = [...new Set(valid.map((l) => l.blockNumber!))];
    for (let i = 0; i < numbers.length; i += 4)
      await Promise.all(numbers.slice(i, i + 4).map(blockAt));
    for (const log of valid) {
      const b = blocks.get(log.blockNumber!)!;
      if (!b.hash || (log.blockHash && log.blockHash !== b.hash))
        throw Error("History changed during the read. Refresh to retry.");
      const { amount0, amount1, sqrtPriceX96 } = log.args;
      if (
        amount0 === undefined ||
        amount1 === undefined ||
        sqrtPriceX96 === undefined
      )
        throw Error("Incomplete Swap event");
      const abs = (n: bigint) => (n < 0n ? -n : n);
      trades.push({
        block: log.blockNumber!,
        blockHash: b.hash,
        time: Number(b.timestamp),
        index: log.logIndex!,
        hash: log.transactionHash!,
        buy: amount0 > 0n,
        unlk: abs(amount0),
        imd: abs(amount1),
        price: priceFromSqrt(sqrtPriceX96),
      });
    }
  }
  const [first, slot, confirmed] = await Promise.all([
    blockAt(from),
    wait(
      reader.readContract({
        address: STATE_VIEW,
        abi: stateAbi,
        functionName: "getSlot0",
        args: [POOL_ID],
        blockNumber: head.number,
      }),
    ),
    wait(reader.getBlock({ blockNumber: head.number })),
  ]);
  if (confirmed.hash !== head.hash)
    throw Error("History changed during the read. Refresh to retry.");
  if (Date.now() / 1000 - Number(head.timestamp) > 90)
    throw Error("History became stale during the scan. Retry.");
  signal?.throwIfAborted();
  const data: PoolHistory = {
    from,
    fromTime: Number(first.timestamp),
    to: head.number,
    toTime: Number(head.timestamp),
    toHash: head.hash,
    readAt: Date.now(),
    spot: priceFromSqrt(slot[0]),
    trades: [
      ...new Map(trades.map((t) => [`${t.hash}:${t.index}`, t])).values(),
    ].sort((a, b) =>
      a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1,
    ),
  };
  const cache = caches.get(reader) ?? new Map();
  cache.set(count, data);
  caches.set(reader, cache);
  return data;
}
