import { createPublicClient, fallback, http, parseAbi, type PublicClient } from "viem";
import { CHAIN_ID, DEPLOYMENT_BLOCK, RPC_URLS, chain } from "../config";
import { IMD, POOL_ID, POOL_KEY, POOL_MANAGER, TOKEN } from "../mainnet";
import { abortable, buildCandles, priceFromSqrt, swapEvent, type PoolTrade } from "../poolHistory";
import type { ChartHistory } from "./data";

export const INDEX_KEY = `unlock-pool-index-v1:${CHAIN_ID}:${POOL_ID}`;
const PAGE_BLOCKS = 2000n, MAX_PAGES = 12, MAX_TRADES = 6000;
interface Index {
  pool: string; chainId: 1; from: bigint; fromTime: number; to: bigint; toTime: number; toHash: string;
  readAt: number; trades: PoolTrade[]; capped: boolean;
}
const memory = new WeakMap<PublicClient, Index>();
let recentIndex: Index | null = null;
const abs = (v: bigint) => v < 0n ? -v : v;
const ordered = (a: PoolTrade, b: PoolTrade) => a.block === b.block ? a.index-b.index : a.block < b.block ? -1 : 1;
function storedIndex(): Index | null {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) || "null");
    if (!raw || raw.pool !== POOL_ID || raw.chainId !== 1 || !Array.isArray(raw.trades) || raw.trades.length > MAX_TRADES) return null;
    const data: Index = { ...raw, from: BigInt(raw.from), to: BigInt(raw.to), trades: raw.trades.map((t: PoolTrade) => ({ ...t, block: BigInt(t.block), unlk: BigInt(t.unlk), imd: BigInt(t.imd) })) };
    if (data.from < DEPLOYMENT_BLOCK || data.to < data.from || !/^0x[\da-f]{64}$/i.test(data.toHash) || !Number.isFinite(data.readAt) || data.readAt > Date.now()+60000 || !Number.isFinite(data.fromTime) || !Number.isFinite(data.toTime)) return null;
    if (data.trades.some(t => t.block < data.from || t.block > data.to || !Number.isSafeInteger(t.time) || t.time < data.fromTime || t.time > data.toTime || !Number.isFinite(t.price) || t.price <= 0 || t.unlk < 0n || t.imd < 0n || !/^0x[\da-f]{64}$/i.test(t.hash))) return null;
    return data;
  } catch { return null; }
}
function saveIndex(data: Index) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(data, (_,v) => typeof v === "bigint" ? v.toString() : v)); } catch { /* memory-only if storage is unavailable */ }
}
export function indexedCandles(data: Index, interval: number): ChartHistory {
  return {
    version: 1, pool: POOL_ID, chainId: 1, currency: "IMD", interval, readAt: data.readAt,
    source: "rpc", blockCoverage: { from: data.from.toString(), to: data.to.toString(), fromTime: data.fromTime, toTime: data.toTime },
    candles: buildCandles(data.trades, interval).map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: Number(c.imd)/1e18 })),
    olderAvailable: data.from > DEPLOYMENT_BLOCK && !data.capped, truncated: data.capped,
  };
}
export function cachedIndex(interval: number) { const data = storedIndex(); return data ? indexedCandles(data, interval) : null; }

/** Bounded newest-first replay, persisted only after a complete canonical page. Never sends transactions. */
export async function readIndexedHistory(interval: number, signal: AbortSignal, onPage: (history: ChartHistory) => void, reader?: PublicClient): Promise<ChartHistory> {
  const client = reader ?? createPublicClient({ chain, transport: fallback(RPC_URLS.map(url => http(url, {
    batch: { wait: 20, batchSize: 30 }, timeout: 8000, retryCount: 0, fetchOptions: { signal },
  })), { rank: false, retryCount: 0 }) });
  const wait = <T>(p: Promise<T>) => abortable(p, signal);
  if (await wait(client.getChainId()) !== 1) throw Error("Chart RPC is not Ethereum mainnet. Retry using the mainnet providers.");
  const decimals = parseAbi(["function decimals() view returns (uint8)"]);
  const [d0,d1] = await Promise.all([TOKEN,IMD].map(address => wait(client.readContract({ address, abi: decimals, functionName: "decimals" }))));
  if (d0 !== 18 || d1 !== 18 || POOL_KEY.currency0.toLowerCase() !== TOKEN.toLowerCase() || POOL_KEY.currency1 !== IMD) throw Error("Chart currency order/decimals verification failed.");
  const head = await wait(client.getBlock({ blockTag: "latest" }));
  if (!head.hash || head.number < DEPLOYMENT_BLOCK || Math.abs(Date.now()/1000-Number(head.timestamp)) > 120) throw Error("Mainnet chart RPC is stale. Retry the provider.");
  let previous = memory.get(client) ?? (!reader ? storedIndex() ?? recentIndex : null);
  if (previous && (previous.to > head.number || (await wait(client.getBlock({ blockNumber: previous.to }))).hash !== previous.toHash)) previous = null;
  const blockCache = new Map<bigint, {hash: string | null; timestamp: bigint}>([[head.number,head]]);
  const atBlock = async (number: bigint) => {
    let b = blockCache.get(number);
    if (!b) { b = await wait(client.getBlock({ blockNumber: number })); blockCache.set(number,b); }
    return b;
  };
  let logRequests = 0;
  async function logsIn(fromBlock: bigint, toBlock: bigint): Promise<Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>>> {
    if (++logRequests > 96) throw Error("RPC log-range limits reached the bounded request budget. Completed pages are saved; retry to resume, or choose GeckoTerminal.");
    try { return await wait(client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: POOL_ID }, fromBlock, toBlock, strict: true })); }
    catch (e) {
      signal.throwIfAborted();
      if (toBlock <= fromBlock || !/range|too many|limit.*(?:result|block)|response size/i.test(String(e))) throw e;
      const middle = (fromBlock+toBlock)/2n;
      // Sequential splits bound concurrent work on a restrictive free provider.
      return [...await logsIn(fromBlock,middle), ...await logsIn(middle+1n,toBlock)];
    }
  }
  let current: Index = previous ?? { pool: POOL_ID, chainId: 1, from: head.number+1n, fromTime: Number(head.timestamp), to: head.number, toTime: Number(head.timestamp), toHash: head.hash, readAt: 0, trades: [], capped: false };
  async function scanPage(from: bigint, to: bigint, replace = false) {
    const logs = await logsIn(from,to);
    const valid = logs.filter(l => !l.removed && l.args.id?.toLowerCase() === POOL_ID && l.blockNumber !== null && l.transactionHash !== null && l.logIndex !== null);
    const numbers = [...new Set(valid.map(l => l.blockNumber!))];
    for (let i=0;i<numbers.length;i+=4) await Promise.all(numbers.slice(i,i+4).map(atBlock));
    const trades: PoolTrade[] = [];
    for (const l of valid) {
      const b = await atBlock(l.blockNumber!);
      if (!b.hash || b.hash !== l.blockHash) throw Error("Pool history reorganized during the read. Retry to reconcile it.");
      const { amount0,amount1,sqrtPriceX96 }=l.args;
      if (amount0 === undefined || amount1 === undefined || sqrtPriceX96 === undefined) throw Error("Incomplete official-pool Swap event.");
      trades.push({ block:l.blockNumber!, blockHash:b.hash, time:Number(b.timestamp), index:l.logIndex!, hash:l.transactionHash!, buy:amount0>0n, unlk:abs(amount0), imd:abs(amount1), price:priceFromSqrt(sqrtPriceX96) });
    }
    const kept = current.trades.filter(t => !replace || t.block < from || t.block > to);
    let combined = [...new Map([...kept,...trades].map(t => [`${t.hash}:${t.index}`,t])).values()].sort(ordered);
    let first = from < current.from ? from : current.from;
    let capped = current.capped;
    if (combined.length > MAX_TRADES) {
      const boundary=combined[combined.length-MAX_TRADES].block;
      // Keep only complete blocks when bounding the cache.
      combined=combined.filter(t=>t.block>boundary);first=boundary+1n;capped=true;
    }
    const through = to > current.to ? to : current.to;
    const [firstBlock,lastBlock,confirmed] = await Promise.all([atBlock(first),atBlock(through),wait(client.getBlock({ blockNumber:head.number }))]);
    if (confirmed.hash !== head.hash) throw Error("Mainnet head changed during replay. Retry to reconcile the chart.");
    signal.throwIfAborted();
    current = { pool:POOL_ID, chainId:1, from:first, fromTime:Number(firstBlock.timestamp), to:through, toTime:Number(lastBlock.timestamp), toHash:lastBlock.hash!, readAt:Date.now(), trades:combined, capped };
    memory.set(client,current); if (!reader) { recentIndex = current; saveIndex(current); } onPage(indexedCandles(current,interval));
  }
  let pages=0;
  if (previous) {
    let start = previous.to-11n > previous.from ? previous.to-11n : previous.from;
    if (head.number-start > PAGE_BLOCKS*BigInt(MAX_PAGES-1)) {
      // A long offline gap is replayed on the next read rather than claiming unscanned coverage.
      previous=null;
      current={...current,from:head.number+1n,trades:[],capped:false};
    } else for (;start<=head.number;start+=PAGE_BLOCKS) { await scanPage(start,start+PAGE_BLOCKS-1n<head.number?start+PAGE_BLOCKS-1n:head.number,true);pages++; }
  }
  for (let end=current.from-1n; end>=DEPLOYMENT_BLOCK && pages<MAX_PAGES && !current.capped; pages++,end=current.from-1n) {
    const from=end-PAGE_BLOCKS+1n>DEPLOYMENT_BLOCK?end-PAGE_BLOCKS+1n:DEPLOYMENT_BLOCK;
    await scanPage(from,end);
  }
  if (!current.readAt) throw Error("No mainnet chart page was verified. Retry the RPC source.");
  return indexedCandles(current,interval);
}
