export const POLICY: { minimumLiquidityUsd: number; maxAgeMs: number; maxBlockLag: number };
export function eligibility(m: any, now?: number, head?: number | null): { eligible: boolean; reasons: string[]; checkedAt: string | null; block: number | null };
export function admittedMarkets<T>(data: { markets?: T[]; featured?: T | null; block?: number; eligibilityUnknown?: boolean; stale?: boolean } | null, now?: number): T[];
export function compareNullable(a: number | null | undefined, b: number | null | undefined, direction?: string): number;
export function validCandles<T>(rows: T[], field?: string): T[];
export function traderPnl(events: any[], balance: number | null, markUsd: number | null, completeHistory?: boolean): { status: string; realized: number | null; unrealized: number | null; knownSold: number; unknownSold: number; knownAmount: number; proceeds: number; note: string };
export function coincidentFlows(events: any[], watched: string[], windowSeconds?: number): Array<{ key: string; token: string; symbol: string; type: string; from: number; to: number; wallets: string[]; rows: any[]; label: string }>;
