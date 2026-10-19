import { useEffect, useState } from "react";

export type LabsSession = {
  token: string;
  eligible: boolean;
  address: string;
};

export type LabsDataProps = { apiBase: string; session: LabsSession | null };

export type Market = {
  address: string;
  identity?: { verified: boolean; sourceUrl: string; owner?: string };
  pool?: { id: string; dex: string; version: string; verified: boolean; quoteSymbol?: string };
  liquidityCheck?: { verified: boolean; usd: number; activeUsd: number; method: string; complete: boolean; checkedAt: string; block: number };
  sellCheck?: { success: boolean; chainId: number; account: string; amountRaw: string; amountUsd: number; token: string; poolId: string; method: string; stateOverrides: boolean; callHash: string; checkedAt: string; block: number };
  listedAt?: string | null;
  launchedAt?: string | null;
  logo?: string | null;
  pick?: { label: string; sourceUrl: string } | null;
  priceChange1h?: number | null;
  priceChange7d?: number | null;
  marketCapEvidence?: string | null;
  decimals?: number;
  profile?: {description:string;website:string;social:string;socials?:string[];banner:boolean;label:string};
  sparkline?: number[];
  sponsored?: { label: string; expiresAt: string; description?: string; banner?: boolean; website?: string };
  symbol: string | null;
  name: string;
  chainId: number;
  launchNumber?: number | null;
  launchId?: string | null;
  createdAt?: string | number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  poolId?: string | null;
  projectUrl?: string | null;
  sourceUrl?: string | null;
  repoUrl?: string | null;
  poolUrl?: string | null;
  chartUrl?: string | null;
  source?: string | null;
  observedAt?: string | number | null;
  status?: string;
  chart?: Array<{ time: number | string; price: number }>;
};

export type MarketsData = {
  updatedAt: string | null;
  mode: "cached" | "snapshot" | "warming";
  chainId: number;
  block?: number;
  eligibilityUnknown?: boolean;
  stale?: boolean;
  excluded?: Array<{ address: string; reasons: string[]; checkedAt?: string | null }>;
  featured: Market | null;
  markets: Market[];
  coverage: {
    registryPages?: number;
    registryLimit?: number;
    notes: string[];
    source?: string;
  };
  errors: string[];
};

export type RadarEvent = {
  id: string;
  type: "buy" | "sell" | "transfer" | "liquidity";
  hash: string;
  block: number;
  time: number | string;
  token: string;
  symbol: string;
  amount: string | null;
  amountUsd: number | null;
  wallet: string | null;
  attribution: string;
  priceUsd?: number | null;
  priceQuote?: number | null;
  quoteAmount?: string | null;
  ambiguousRouting?: boolean;
  sale?: { seller:string;buyer:string;amountEth:string;sourceUrl:string;basis:string };
  relatedActivity?: string | null;
  from?: string | null;
  to?: string | null;
  poolId?: string | null;
};

export type RadarWallet = {
  address: string;
  label: string | null;
  holdings: Array<{ address: string; symbol: string; balance: string | null; usd: number | null }>;
  netFlow: Array<{ chainId?: number; address?: string; symbol: string; decimals?: number | null; amountRaw?: string; amount: string | null }>;
  source: string;
  category?: "imd" | "nft" | "public";
  attributionUrl?: string;
  nfts?: Array<{ collection: string; tokenId: string; name: string; evidenceUrl: string }>;
};

export type RadarPeriod = "1h" | "24h" | "7d";

export type RadarData = {
  updatedAt: string | null;
  mode: "cached" | "snapshot" | "warming";
  period: RadarPeriod;
  coverage: {
    fromBlock: number | null;
    toBlock: number | null;
    fromTime: number | string | null;
    toTime: number | string | null;
    missingHistory?: boolean;
    notes: string[];
  };
  pools: Array<{
    poolId?: string;
    id?: string;
    address?: string;
    symbol?: string;
    name?: string;
    version?: string;
    token?: string;
  }>;
  events: RadarEvent[];
  nftEvents?: RadarEvent[];
  extraUpdatedAt?: string;
  unresolvedPublicIdentities?: string[];
  wallets: RadarWallet[];
  nextCursor: string | null;
  totalEvents?: number;
  snapshotPageSize?: number;
  errors: string[];
};

export const isAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);

export function safeLink(value: string | null | undefined): string | undefined {
  if (!value || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith(".local") || host.endsWith(".internal")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function apiUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (!trimmed) throw Error("The LABS service has not been configured.");
  const url = new URL(`${trimmed}/${path.replace(/^\/+/, "")}`, location.href);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw Error("The LABS service URL must use HTTPS.");
  }
  if (url.username || url.password) throw Error("The LABS service URL cannot include credentials.");
  return url.toString();
}

export async function holderRequest<T>(
  base: string,
  path: string,
  session: LabsSession | null,
  options: RequestInit = {},
): Promise<T> {
  if (!session?.eligible) throw Error("Sign in with a wallet holding a positive UNLK balance to use holder tools.");
  let response: Response;
  try {
    response = await fetch(apiUrl(base, path), {
      ...options,
      signal: options.signal || AbortSignal.timeout(25_000),
      redirect: "error",
      credentials: "omit",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        Authorization: `Bearer ${session.token}`,
      },
    });
  } catch {
    throw Error("Unable to reach the holder service. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401) throw Error("Your login expired. Sign in again to continue.");
    if (response.status === 403) throw Error("Holder access needs a positive UNLK balance on Ethereum. Refresh your login after checking your balance.");
    if (response.status === 429) throw Error("The service quota is reached. Try again after the retry period.");
    let message = "Holder tools are unavailable. Check service status and try again.";
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error.slice(0, 300);
      else if (typeof result.message === "string") message = result.message.slice(0, 300);
    } catch { /* Use the recoverable default error. */ }
    throw Error(message);
  }
  return response.json() as Promise<T>;
}

export async function downloadHolderCsv(
  base: string,
  kind: "markets" | "radar",
  session: LabsSession | null,
): Promise<void> {
  if (!session?.eligible) throw Error("Sign in with a wallet holding a positive UNLK balance to export data.");
  let response: Response;
  try {
    response = await fetch(apiUrl(base, `holder/export?kind=${kind}`), {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(25_000),
      redirect: "error",
      credentials: "omit",
    });
  } catch {
    throw Error("Unable to reach the export service. Check your connection and try again.");
  }
  if (response.status === 401) throw Error("Your login expired. Sign in again to export data.");
  if (response.status === 403) throw Error("The server could not verify a positive UNLK balance. Check your balance and sign in again.");
  if (!response.ok) throw Error("The export is unavailable. Check service status and try again.");
  if (!(response.headers.get("content-type") || "").includes("text/csv")) throw Error("The server did not return a CSV file. Check service configuration.");
  const blob = await response.blob();
  if (blob.size > 2_000_000) throw Error("The export exceeds the download limit. Use a smaller scope.");
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `unlock-labs-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function timestamp(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const result = typeof value === "number"
    ? (value < 1e12 ? value * 1000 : value)
    : /^\d+$/.test(value) ? timestamp(Number(value)) : Date.parse(value);
  return result != null && Number.isFinite(result) ? result : null;
}

export function dateLabel(value: string | number | null | undefined): string {
  const time = timestamp(value);
  return time == null ? "Unavailable" : new Date(time).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

export function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  if (value !== 0 && Math.abs(value) < 0.01) return `$${value.toLocaleString("en-US", { maximumSignificantDigits: 5 })}`;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function amountLabel(value: string | number | null | undefined): string {
  if (value == null || value === "") return "Unavailable";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  if (numeric !== 0 && Math.abs(numeric) < 0.000001) return numeric.toExponential(4);
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 6, maximumSignificantDigits: 9 });
}

export function shortAddress(address: string): string {
  return isAddress(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function useLabsResource<T>(
  apiBase: string,
  path: string,
  snapshotPath: string,
  validate: (value: unknown) => value is T,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fallback, setFallback] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function read(url: string): Promise<T> {
      const request = new AbortController();
      const cancel = () => request.abort();
      controller.signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => request.abort(), 20_000);
      let response: Response;
      try {
        response = await fetch(url, { signal: request.signal, credentials: "omit", redirect: "error" });
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", cancel);
      }
      if (!response.ok) throw Error(`Service returned ${response.status}.`);
      const result: unknown = await response.json();
      if (!validate(result)) throw Error("The data response is incomplete.");
      return result;
    }
    async function loadData() {
      let serviceError = "";
      if (apiBase) {
        try {
          const result = await read(apiUrl(apiBase, path));
          if (!controller.signal.aborted) {
            setData(result);
            setFallback(false);
          }
          return;
        } catch (failure) {
          if (controller.signal.aborted) return;
          serviceError = failure instanceof Error ? failure.message : "Unable to reach the service.";
        }
      }
      try {
        const result = await read(snapshotPath);
        if (!controller.signal.aborted) {
          setData(result);
          setFallback(true);
          setError(apiBase ? `Backend unavailable (${serviceError}) Showing the bundled snapshot.` : "Bundled snapshot. Live refresh requires the LABS service.");
        }
      } catch {
        if (!controller.signal.aborted) {
          setData(null);
          setFallback(true);
          setError("Market data could not load. Check your connection and try refreshing.");
        }
      }
    }
    void loadData().finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBase, path, snapshotPath, revision, validate]);
  return { data, loading, error, fallback, refresh: () => setRevision((value) => value + 1) };
}

export function isMarketsData(value: unknown): value is MarketsData {
  const object = value as MarketsData;
  return !!object && (typeof object.updatedAt === "string" || (object.mode === "warming" && object.updatedAt === null)) && Array.isArray(object.markets) && object.markets.every((market) => isAddress(market.address) && (typeof market.symbol === "string" || market.symbol === null)) && !!object.coverage && Array.isArray(object.coverage.notes) && Array.isArray(object.errors);
}

export function isRadarData(value: unknown): value is RadarData {
  const object = value as RadarData;
  return !!object && (typeof object.updatedAt === "string" || (object.mode === "warming" && object.updatedAt === null)) && Array.isArray(object.events) && Array.isArray(object.wallets) && Array.isArray(object.pools) && !!object.coverage && Array.isArray(object.coverage.notes) && Array.isArray(object.errors);
}
