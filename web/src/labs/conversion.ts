import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, formatEther, type Abi, type Address, type Hex } from "viem";
import { client, NATIVE, stateAbi } from "../config";
import { IMD, QUOTER, STATE_VIEW, UNIVERSAL_ROUTER, RUNTIME_PINS } from "../mainnet";
import { IMD_ETH_POOL_ID } from "../spotPrice";
import { executeAbi } from "../mainnetAbis";

export const ethImdKey = { currency0: NATIVE, currency1: IMD, fee: 10000, tickSpacing: 200, hooks: NATIVE } as const;
const keyType = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const exactOutputAbi = parseAbi(["function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)"]);
export interface ConversionQuote { amount: bigint; expected: bigint; maximum: bigint; deadline: bigint; block: bigint; quotedAt: number; account: Address; args: readonly [Hex, readonly Hex[], bigint]; value: bigint; slippage: number; lpFee?: number; protocolFee?: number }
export type NativeFunding = Pick<ConversionQuote, "amount" | "expected" | "maximum" | "deadline" | "quotedAt" | "account" | "slippage">;

/** A narrow exception to the existing terminal's zero-ETH funding guard. */
export function assertLabsNativeFunding(action: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint; labsFunding?: NativeFunding }, account: Address, now = Date.now()) {
  const q = action.labsFunding;
  if (!q || action.address.toLowerCase() !== UNIVERSAL_ROUTER.toLowerCase() || action.functionName !== "execute" || q.account.toLowerCase() !== account.toLowerCase() || q.amount <= 0n || q.amount >= 1n << 128n || q.expected <= 0n || !Number.isInteger(q.slippage) || q.slippage < 1 || q.slippage > 500 || q.maximum !== (q.expected * BigInt(10000 + q.slippage) + 9999n) / 10000n || q.maximum >= 1n << 128n || action.value !== q.maximum || !Number.isSafeInteger(q.quotedAt) || q.quotedAt > now + 1000 || now - q.quotedAt > 60000 || q.deadline <= BigInt(Math.floor(now / 1000) + 15) || q.deadline > BigInt(Math.floor(now / 1000) + 121)) throw Error("ETH funding is allowed only for a fresh, verified Labs exact-output IMD conversion to your wallet. Requote this route.");
  const expected = encodeFunctionData({ abi: executeAbi, functionName: "execute", args: conversionArgs(account, q.amount, q.maximum, q.deadline) });
  const provided = encodeFunctionData({ abi: action.abi, functionName: action.functionName, args: action.args ?? [] });
  if (provided !== expected) throw Error("Native conversion calldata changed its pool, output, spending limit or refund recipient. Nothing was signed.");
}

export function conversionArgs(account: Address, amount: bigint, maximum: bigint, deadline: bigint): ConversionQuote["args"] {
  const swap = encodeAbiParameters(parseAbiParameters(`(${keyType} poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)`), [{ poolKey: ethImdKey, zeroForOne: true, amountOut: amount, amountInMaximum: maximum, hookData: "0x" }]);
  const settle = encodeAbiParameters(parseAbiParameters("address,uint256"), [NATIVE, maximum]);
  const take = encodeAbiParameters(parseAbiParameters("address,uint256"), [IMD, amount]);
  const v4 = encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), ["0x080c0f", [swap, settle, take]]);
  // SWEEP refunds unused native ETH to this same customer. No pooled balance.
  const refund = encodeAbiParameters(parseAbiParameters("address,address,uint256"), [NATIVE, account, 0n]);
  return ["0x1004", [v4, refund], deadline];
}

export async function quoteEthToImd(account: Address, amount: bigint, slippage: number): Promise<ConversionQuote> {
  if (amount <= 0n || amount >= 1n << 128n || !Number.isInteger(slippage) || slippage < 1 || slippage > 500) throw Error("Use a positive IMD amount and slippage between 0.01% and 5%.");
  if (await client.getChainId() !== 1) throw Error("Conversion requires Ethereum mainnet.");
  const computed = keccak256(encodeAbiParameters(parseAbiParameters(keyType), [ethImdKey]));
  if (computed !== IMD_ETH_POOL_ID) throw Error("The ETH/IMD PoolKey does not match the verified PoolId.");
  await Promise.all(["router", "quoter", "manager", "imd"].map(async key => {
    const pin = RUNTIME_PINS[key], code = await client.getCode({ address: pin.address });
    if (!code || keccak256(code) !== pin.hash) throw Error(`The ${key} runtime does not match its mainnet record.`);
  }));
  const block = await client.getBlockNumber();
  const [slot, liquidity] = await Promise.all([
    client.readContract({ address: STATE_VIEW, abi: stateAbi, functionName: "getSlot0", args: [IMD_ETH_POOL_ID], blockNumber: block }),
    client.readContract({ address: STATE_VIEW, abi: stateAbi, functionName: "getLiquidity", args: [IMD_ETH_POOL_ID], blockNumber: block }),
  ]);
  if (slot[0] === 0n || liquidity === 0n || slot[3] !== 10000) throw Error("The verified ETH/IMD pool has no executable liquidity or its fee changed.");
  const simulation = await client.simulateContract({ address: QUOTER, abi: exactOutputAbi, functionName: "quoteExactOutputSingle", args: [{ poolKey: ethImdKey, zeroForOne: true, exactAmount: amount, hookData: "0x" }], account, blockNumber: block });
  const expected = simulation.result[0];
  const maximum = (expected * BigInt(10000 + slippage) + 9999n) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
  const args = conversionArgs(account, amount, maximum, deadline);
  await client.simulateContract({ address: UNIVERSAL_ROUTER, abi: executeAbi, functionName: "execute", args, value: maximum, account });
  return { amount, expected, maximum, deadline, block, quotedAt: Date.now(), account, args, value: maximum, slippage, lpFee: slot[3], protocolFee: slot[2] & 0xfff };
}

export function describeConversion(q: ConversionQuote) {
  return [["Receive exactly", `${formatEther(q.amount)} IMD in your wallet`], ["Expected input", `${formatEther(q.expected)} ETH`], ["Maximum input", `${formatEther(q.maximum)} ETH + network gas`], ["Pool fee", q.lpFee === undefined ? "Included in quoted input" : `${q.lpFee / 10000}% · included in quoted input`], ["Protocol fee", q.protocolFee === undefined ? "Included in quoted input" : `${q.protocolFee / 10000}% · compounded with the pool fee`], ["Slippage", `${q.slippage / 100}%`], ["Labs markup", "None"], ["PoolId", IMD_ETH_POOL_ID], ["Expires", new Date(Number(q.deadline) * 1000).toISOString()]] as [string, string][];
}
