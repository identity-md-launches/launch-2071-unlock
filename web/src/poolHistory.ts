import { parseAbiItem, type PublicClient } from "viem";
import { mainnetClient, POOL_ID, POOL_MANAGER } from "./mainnet";
import { DEPLOYMENT_BLOCK } from "./config";

export const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
export interface PoolTrade {
  block: bigint;
  index: number;
  hash: `0x${string}`;
  buy: boolean;
  unlk: bigint;
  imd: bigint;
  price: number;
}
export interface PoolHistory {
  from: bigint;
  to: bigint;
  toHash: string;
  trades: PoolTrade[];
}
// Bounded, explicitly stated coverage. No implied all-time data or synthetic candles.
export async function readPoolHistory(
  count: number,
  signal?: AbortSignal,
  reader: PublicClient = mainnetClient,
): Promise<PoolHistory> {
  if (count !== 2000 && count !== 10000)
    throw Error("Choose a supported block range.");
  if ((await reader.getChainId()) !== 1)
    throw Error("History requires Ethereum mainnet.");
  const head = await reader.getBlock({ blockTag: "latest" });
  if (Date.now() / 1000 - Number(head.timestamp) > 90)
    throw Error("History RPC is stale. Retry with current mainnet data.");
  const from =
    head.number - BigInt(count) + 1n > DEPLOYMENT_BLOCK
      ? head.number - BigInt(count) + 1n
      : DEPLOYMENT_BLOCK;
  const trades: PoolTrade[] = [];
  for (let start = from; start <= head.number; start += 2000n) {
    signal?.throwIfAborted();
    const end = start + 1999n < head.number ? start + 1999n : head.number;
    const logs = await reader.getLogs({
      address: POOL_MANAGER,
      event: swapEvent,
      args: { id: POOL_ID },
      fromBlock: start,
      toBlock: end,
      strict: true,
    });
    signal?.throwIfAborted();
    for (const log of logs) {
      if (
        log.removed ||
        log.blockNumber === null ||
        log.transactionHash === null ||
        log.logIndex === null
      )
        continue;
      const { amount0, amount1, sqrtPriceX96 } = log.args;
      const abs = (n: bigint) => (n < 0n ? -n : n);
      trades.push({
        block: log.blockNumber,
        index: log.logIndex,
        hash: log.transactionHash,
        buy: amount0 > 0n,
        unlk: abs(amount0),
        imd: abs(amount1),
        price: (Number(sqrtPriceX96) / 2 ** 96) ** 2,
      });
    }
  }
  // Do not mix a reorged endpoint head into an apparently complete range.
  const confirmed = await reader.getBlock({ blockNumber: head.number });
  if (confirmed.hash !== head.hash)
    throw Error("History changed during the read. Refresh to retry.");
  return {
    from,
    to: head.number,
    toHash: head.hash,
    trades: trades.sort((a, b) =>
      a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1,
    ),
  };
}
