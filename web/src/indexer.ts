import {
  decodeEventLog,
  parseAbiItem,
  type Address,
  type Hex,
  type Log,
} from "viem";
import {
  client,
  addresses as a,
  abi,
  DEPLOYMENT_BLOCK,
  NATIVE,
} from "./config";
import { b, read, type Snapshot } from "./live";
import { allowance, SUPPLY } from "./math";
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
export interface IndexedEvent {
  id: string;
  kind: string;
  block: bigint;
  hash: Hex;
  index: number;
  time: bigint;
  account?: Address;
  from?: Address;
  to?: Address;
  amount?: bigint;
  input?: bigint;
  output?: bigint;
  amount0?: bigint;
  amount1?: bigint;
  sqrt?: bigint;
  tick?: number;
  fee?: number;
}
export interface IndexData {
  from: bigint;
  to: bigint;
  hash: Hex;
  events: IndexedEvent[];
  complete: boolean;
  error?: string;
  fetchedAt: number;
}
export interface Holder {
  address: Address;
  balance: bigint;
  E: bigint | null;
  S: bigint | null;
  within: bigint | null;
  share: string;
  label: string;
}
const CACHE = "unlk-1560-events-v1";
export const serialize = (x: unknown) =>
  JSON.stringify(x, (_, v) =>
    typeof v === "bigint" ? { $bigint: v.toString() } : v,
  );
export const deserialize = <T>(x: string): T =>
  JSON.parse(x, (_, v) =>
    v && typeof v === "object" && Object.keys(v).length === 1 && "$bigint" in v
      ? BigInt(v.$bigint)
      : v,
  );
let memory: IndexData | undefined;
let running: Promise<IndexData> | undefined;
async function rangeLogs(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  try {
    const [contractLogs, swapLogs] = await Promise.all([
      client.getLogs({
        address: [a.token, a.router, a.hook, a.distributor, b.rewards],
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: a.manager,
        event: swapEvent,
        args: { id: b.poolId },
        fromBlock,
        toBlock,
      }),
    ]);
    return [...contractLogs, ...swapLogs] as Log[];
  } catch (e) {
    if (toBlock - fromBlock < 10n) throw e;
    const mid = (toBlock + fromBlock) / 2n;
    return [
      ...(await rangeLogs(fromBlock, mid)),
      ...(await rangeLogs(mid + 1n, toBlock)),
    ];
  }
}
export async function indexEvents(s: Snapshot): Promise<IndexData> {
  if (running) return running;
  running = updateIndex(s).finally(() => {
    running = undefined;
  });
  return running;
}
async function updateIndex(s: Snapshot): Promise<IndexData> {
  if (!memory && typeof localStorage !== "undefined")
    try {
      const x = localStorage.getItem(CACHE);
      if (x) {
        const parsed = deserialize<IndexData>(x);
        if (
          parsed.from === DEPLOYMENT_BLOCK &&
          Array.isArray(parsed.events) &&
          parsed.to < s.block
        )
          memory = parsed;
      }
    } catch {
      /* cache is optional */
    }
  // Revalidate the cached anchor and reread a 12-block overlap. No unconfirmed receipt is represented as finalized history.
  const to = s.block > 2n ? s.block - 2n : s.block;
  if (memory && memory.to > to) memory = undefined;
  if (memory) {
    try {
      const old = await client.getBlock({ blockNumber: memory.to });
      if (old.hash !== memory.hash) memory = undefined;
    } catch {
      memory = undefined;
    }
  }
  if (memory && memory.to === to) return memory;
  const start = memory
    ? memory.to - 12n > DEPLOYMENT_BLOCK
      ? memory.to - 12n
      : DEPLOYMENT_BLOCK
    : DEPLOYMENT_BLOCK;
  let events = memory ? memory.events.filter((e) => e.block < start) : [];
  let covered = start - 1n;
  try {
    for (let from = start; from <= to; from += 2000n) {
      const end = from + 1999n > to ? to : from + 1999n;
      const logs = await rangeLogs(from, end);
      const times = new Map<bigint, bigint>();
      const numbers = [
        ...new Set(
          logs.map((l) => l.blockNumber).filter((x): x is bigint => x !== null),
        ),
      ];
      for (let i = 0; i < numbers.length; i += 20)
        await Promise.all(
          numbers.slice(i, i + 20).map(async (n) => {
            times.set(n, (await client.getBlock({ blockNumber: n })).timestamp);
          }),
        );
      for (const log of logs) {
        if (
          log.removed ||
          log.blockNumber === null ||
          log.transactionHash === null ||
          log.logIndex === null
        )
          continue;
        const contract = log.address.toLowerCase();
        const eventAbi =
          contract === a.token
            ? abi.token
            : contract === a.router
              ? abi.router
              : contract === a.hook
                ? abi.hook
                : contract === a.distributor
                  ? abi.distributor
                  : contract === b.rewards.toLowerCase()
                    ? abi.evidence
                    : [swapEvent];
        try {
          const decoded = decodeEventLog({
            abi: eventAbi,
            data: log.data,
            topics: log.topics,
            strict: true,
          });
          const v = decoded.args as Record<string, any>;
          const kind = decoded.eventName;
          if (
            ![
              "Transfer",
              "Executed",
              "Swap",
              "Claimed",
              "Attested",
              "Credit",
              "Sale",
              "Milestone",
              "NativeCredit",
              "NativeWithdrawn",
            ].includes(kind!)
          )
            continue;
          if (kind === "Swap" && v.id !== b.poolId) continue;
          events.push({
            id: log.transactionHash + ":" + log.logIndex,
            kind: kind!,
            block: log.blockNumber,
            hash: log.transactionHash,
            index: log.logIndex,
            time: times.get(log.blockNumber)!,
            account: v.trader ?? v.account ?? v.recipient,
            from: v.from,
            to: v.to,
            amount: v.amount ?? v.value,
            input: v.input,
            output: v.output,
            amount0: v.amount0,
            amount1: v.amount1,
            sqrt: v.sqrtPriceX96,
            tick: v.tick,
            fee: v.fee,
          });
        } catch {
          /* unrelated events are intentionally outside this index */
        }
      }
      covered = end;
    }
    const unique = [...new Map(events.map((e) => [e.id, e])).values()].sort(
      (x, y) =>
        x.block === y.block ? x.index - y.index : x.block < y.block ? -1 : 1,
    );
    const anchor = await client.getBlock({ blockNumber: to });
    memory = {
      from: DEPLOYMENT_BLOCK,
      to,
      hash: anchor.hash,
      events: unique,
      complete: true,
      fetchedAt: Date.now(),
    };
    try {
      localStorage.setItem(CACHE, serialize(memory));
    } catch {
      /* storage disabled or full: continue with memory */
    }
    return memory;
  } catch (e) {
    return {
      from: DEPLOYMENT_BLOCK,
      to: covered,
      hash: memory?.hash ?? s.hash,
      events,
      complete: false,
      error: e instanceof Error ? e.message : "RPC history unavailable",
      fetchedAt: Date.now(),
    };
  }
}
export async function loadHolders(
  index: IndexData,
  s: Snapshot,
): Promise<Holder[]> {
  const candidates = [
    ...new Set(
      index.events
        .filter((e) => e.kind === "Transfer")
        .flatMap((e) => [e.from, e.to])
        .filter((x): x is Address => !!x && x.toLowerCase() !== NATIVE),
    ),
  ];
  const rows: Holder[] = [];
  for (let i = 0; i < candidates.length; i += 20)
    await Promise.all(
      candidates.slice(i, i + 20).map(async (address) => {
        const balance = await read<bigint>(
          a.token,
          abi.token,
          "balanceOf",
          [address],
          s.block,
        );
        if (balance === 0n) return;
        const [E, S] = await Promise.all([
          read<bigint>(a.hook, abi.hook, "eligible", [address], s.block).catch(
            () => null,
          ),
          read<bigint>(a.hook, abi.hook, "sold", [address], s.block).catch(
            () => null,
          ),
        ]);
        const label =
          address.toLowerCase() === a.manager
            ? "PoolManager · shared infrastructure"
            : address.toLowerCase() === a.distributor
              ? "Reward distributor"
              : address.toLowerCase() === a.router
                ? "Official router"
                : address.toLowerCase() === b.payer.toLowerCase()
                  ? "Original payer"
                  : address.toLowerCase() === b.factory.toLowerCase()
                    ? "Launch factory"
                    : "Wallet / contract";
        const share = (balance * 1000000n) / SUPPLY;
        rows.push({
          address,
          balance,
          E,
          S,
          within:
            E !== null && S !== null
              ? allowance(balance, E, S, s.p, s.fullyUnlocked).within
              : null,
          share: `${share / 10000n}.${(share % 10000n).toString().padStart(4, "0")}%`,
          label,
        });
      }),
    );
  return rows.sort((x, y) =>
    x.balance > y.balance
      ? -1
      : x.balance < y.balance
        ? 1
        : x.address.localeCompare(y.address),
  );
}
