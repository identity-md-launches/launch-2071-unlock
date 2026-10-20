import { IMD, POOL_ID, TOKEN } from "../mainnet";

export type Currency = "IMD" | "USD";
export const INTERVALS = [
  { label: "1m", seconds: 60, frame: "minute", aggregate: 1 },
  { label: "5m", seconds: 300, frame: "minute", aggregate: 5 },
  { label: "15m", seconds: 900, frame: "minute", aggregate: 15 },
  { label: "1h", seconds: 3600, frame: "hour", aggregate: 1 },
  { label: "4h", seconds: 14400, frame: "hour", aggregate: 4 },
  { label: "1D", seconds: 86400, frame: "day", aggregate: 1 },
] as const;
export type Interval = (typeof INTERVALS)[number];
export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // GeckoTerminal quote-currency leg: IMD for token, USD for usd.
}
export interface ChartHistory {
  version: 1;
  pool: typeof POOL_ID;
  chainId: 1;
  interval: number;
  currency: Currency;
  readAt: number;
  candles: ChartCandle[];
  olderAvailable: boolean;
  truncated: boolean;
  source?: "rpc";
  blockCoverage?: { from: string; to: string; fromTime: number; toTime: number };
  indexing?: boolean;
}
export const API = "https://api.geckoterminal.com/api/v2";
export const POOL_URL = `${API}/networks/eth/pools/${POOL_ID}`;
export const CACHE_KEY = `unlock-official-chart-v1:1:${POOL_ID}`;
export const MAX_CANDLES = 3000;
export const PAGE_SIZE = 1000;
const MAX_CACHE_ENTRIES = 6;
let verifiedPoolAt = 0;
export class ChartProviderError extends Error {
  constructor(message: string, public retryAfter = 30) { super(message); }
}
function record(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Malformed chart response.");
  return v as Record<string, any>;
}
function same(a: unknown, b: string) { return typeof a === "string" && a.toLowerCase() === b.toLowerCase(); }
export function verifyPool(value: unknown) {
  const data = record(record(value).data);
  if (!same(data.id, `eth_${POOL_ID}`) || !same(data.attributes?.address, POOL_ID) ||
    !same(data.relationships?.base_token?.data?.id, `eth_${TOKEN}`) ||
    !same(data.relationships?.quote_token?.data?.id, `eth_${IMD}`) ||
    data.relationships?.dex?.data?.id !== "uniswap-v4-ethereum") {
    throw Error("Provider pool identity mismatch. Expected the official Ethereum UNLK / IMD v4 PoolId; data withheld.");
  }
}
export function parseCandles(value: unknown, interval: number): ChartCandle[] {
  const root = record(value);
  if (!same(root.meta?.base?.address, TOKEN) || !same(root.meta?.quote?.address, IMD)) {
    throw Error("Provider currency identity mismatch. Chart data withheld; retry the source.");
  }
  const rows = root.data?.attributes?.ohlcv_list;
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE) throw Error("Invalid OHLCV response length.");
  const candles: ChartCandle[] = rows.map((r: unknown) => {
    if (!Array.isArray(r) || r.length !== 6 || r.some(n => typeof n !== "number" || !Number.isFinite(n)))
      throw Error("Invalid OHLCV values. Chart data withheld.");
    const [time, open, high, low, close, volume] = r as number[];
    if (!Number.isSafeInteger(time) || time <= 0 || time % interval || time > Date.now() / 1000 + interval ||
      Math.min(open, high, low, close) <= 0 || low > Math.min(open, close) || high < Math.max(open, close) || volume < 0)
      throw Error("Invalid OHLCV bounds. Chart data withheld.");
    return { time, open, high, low, close, volume };
  });
  // Empty intervals are explicitly disabled at the source. Zero-volume observations are not candles.
  return [...new Map(candles.filter(c => c.volume > 0).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
}
export function candleURL(interval: Interval, currency: Currency, before?: number, limit = PAGE_SIZE) {
  const url = new URL(`${POOL_URL}/ohlcv/${interval.frame}`);
  url.search = new URLSearchParams({
    aggregate: String(interval.aggregate), limit: String(limit), currency: currency === "USD" ? "usd" : "token",
    token: "base", include_empty_intervals: "false", ...(before ? { before_timestamp: String(before) } : {}),
  }).toString();
  return url.href;
}
export async function readJSON(url: string, signal: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(18000);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.any([signal, timeout]), credentials: "omit", headers: { Accept: "application/json" } });
  } catch {
    signal.throwIfAborted();
    throw new ChartProviderError(timeout.aborted
      ? "GeckoTerminal timed out. Retry the chart or choose Ethereum logs for IMD history."
      : "Cannot reach GeckoTerminal. Check your connection, retry, or choose Ethereum logs for IMD history.");
  }
  if (!response.ok) {
    const retry = Math.max(30, Math.min(300, Number(response.headers.get("retry-after")) || 30));
    throw new ChartProviderError(response.status === 429
      ? `GeckoTerminal rate limit (429). Wait ${retry}s, then retry; the cached chart stays available.`
      : `GeckoTerminal returned HTTP ${response.status}. Retry the chart or check the source link.`, retry);
  }
  return response.json();
}
export async function readChartPage(interval: Interval, currency: Currency, signal: AbortSignal, previous: ChartHistory | null, older = false): Promise<ChartHistory> {
  if (Date.now() - verifiedPoolAt > 600000) {
    verifyPool(await readJSON(POOL_URL, signal));
    signal.throwIfAborted();
    verifiedPoolAt = Date.now();
  }
  const before = older && previous?.candles.length ? previous.candles[0].time - 1 : undefined;
  const incremental = !older && previous?.candles.length && Date.now() - previous.readAt < 86400000;
  let raw = await readJSON(candleURL(interval, currency, before, incremental ? 100 : PAGE_SIZE), signal);
  let page = parseCandles(raw, interval.seconds);
  if (incremental && page.length === 100 && previous && page[0].time > previous.candles.at(-1)!.time) {
    raw = await readJSON(candleURL(interval, currency), signal);
    page = parseCandles(raw, interval.seconds);
  }
  signal.throwIfAborted();
  if (older && before !== undefined && page.some(c => c.time > before)) throw Error("Provider did not honor the history cursor; pagination stopped.");
  // A refreshed page is authoritative over its entire overlap, including removed/reconciled bars.
  // An empty newest page is retained as an explicit empty result, never replaced with fabricated bars.
  if (previous?.source === "rpc") previous = null;
  const retained = older ? previous?.candles ?? [] : page.length
    ? previous?.candles.filter(c => c.time < page[0].time) ?? [] : [];
  const merged = [...new Map([...retained, ...page].map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
  const truncated = Boolean(previous?.truncated || merged.length > MAX_CANDLES);
  const result: ChartHistory = {
    version: 1, pool: POOL_ID, chainId: 1, interval: interval.seconds, currency, readAt: Date.now(),
    candles: merged.slice(-MAX_CANDLES), truncated,
    olderAvailable: !truncated && (older || !previous ? page.length >= PAGE_SIZE : previous.olderAvailable),
  };
  saveHistory(result);
  return result;
}
function validHistory(v: unknown, interval: number, currency: Currency): v is ChartHistory {
  try {
    const r = record(v);
    if (r.version !== 1 || r.pool !== POOL_ID || r.chainId !== 1 || r.interval !== interval || r.currency !== currency ||
      typeof r.readAt !== "number" || r.readAt <= 0 || r.readAt > Date.now() + 60000 ||
      typeof r.olderAvailable !== "boolean" || typeof r.truncated !== "boolean" ||
      !Array.isArray(r.candles) || r.candles.length > MAX_CANDLES) return false;
    const parsed = parseCandles({ meta: { base: { address: TOKEN }, quote: { address: IMD } }, data: { attributes: {
      ohlcv_list: r.candles.slice(0, PAGE_SIZE).map((c: ChartCandle) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
    } } }, interval);
    if (parsed.length !== Math.min(PAGE_SIZE, r.candles.length)) return false;
    return r.candles.every((c: ChartCandle, i: number) => Number.isSafeInteger(c.time) && c.time % interval === 0 &&
      [c.open,c.high,c.low,c.close,c.volume].every(n => Number.isFinite(n) && n > 0) && c.low <= Math.min(c.open,c.close) &&
      c.high >= Math.max(c.open,c.close) && (!i || r.candles[i-1].time < c.time));
  } catch { return false; }
}
export function cachedHistory(interval: number, currency: Currency): ChartHistory | null {
  try {
    const entries = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    if (!Array.isArray(entries)) return null;
    return entries.find(e => validHistory(e, interval, currency)) ?? null;
  } catch { return null; }
}
export function saveHistory(history: ChartHistory) {
  try {
    const prior = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    const entries = Array.isArray(prior) ? prior.filter(e => e && !(e.interval === history.interval && e.currency === history.currency)) : [];
    localStorage.setItem(CACHE_KEY, JSON.stringify([history, ...entries].slice(0, MAX_CACHE_ENTRIES)));
  } catch { /* Storage unavailable/full: live chart remains usable in memory. */ }
}
export const formatPrice = (n: number) => n.toLocaleString("en", { maximumSignificantDigits: 6 });
export const formatTime = (n: number) => new Date(n * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
