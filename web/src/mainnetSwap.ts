import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { IMD, UNIVERSAL_ROUTER, CANDIDATE_DEPLOYMENT } from "./mainnet";
export type ImdSwapMode = "buyExactIn" | "buyExactOut" | "sellExactIn" | "sellExactOut";
const keyType = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const exactIn = parseAbiParameters(`(${keyType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)`);
const exactOut = parseAbiParameters(`(${keyType} poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)`);
const executeAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);

/// Offline unsigned Explorer-compatible plan. `limit` comes from the fee-inclusive Quoter plus slippage.
/// No wallet transport or submit method exists here; the page remains disabled while release is blocked.
export function encodeImdSwap(token: Address, hook: Address, mode: ImdSwapMode, amount: bigint, limit: bigint, deadline: bigint) {
  if (BigInt(token)===0n || BigInt(hook)===0n || token.toLowerCase()===IMD.toLowerCase()) throw new Error("Invalid official pool identity");
  if(amount<=0n || limit<=0n || amount>=(1n<<128n) || limit>=(1n<<128n) || deadline<=0n) throw new Error("Invalid amount, fee-inclusive limit or expiry");
  const token0=BigInt(token)<BigInt(IMD);
  const key={currency0:token0?token:IMD,currency1:token0?IMD:token,fee:12500,tickSpacing:60,hooks:hook};
  const buy=mode.startsWith("buy");
  const input=buy?IMD:token; const output=buy?token:IMD;
  const exactInput=mode.endsWith("ExactIn");
  const swap=exactInput
    ? encodeAbiParameters(exactIn,[{poolKey:key,zeroForOne:buy!==token0,amountIn:amount,amountOutMinimum:limit,hookData:"0x"}])
    : encodeAbiParameters(exactOut,[{poolKey:key,zeroForOne:buy!==token0,amountOut:amount,amountInMaximum:limit,hookData:"0x"}]);
  const params=[swap,
    encodeAbiParameters(parseAbiParameters("address,uint256"),[input,exactInput?amount:limit]),
    encodeAbiParameters(parseAbiParameters("address,uint256"),[output,exactInput?limit:amount])];
  const actions=(exactInput?"0x060c0f":"0x080c0f") as Hex;
  const inputs=[encodeAbiParameters(parseAbiParameters("bytes,bytes[]"),[actions,params])];
  return {to:UNIVERSAL_ROUTER,data:encodeFunctionData({abi:executeAbi,functionName:"execute",args:["0x10",inputs,deadline]}),value:0n};
}
export function requireMainnetRelease() {
  if(!CANDIDATE_DEPLOYMENT) throw new Error("Mainnet candidate writes disabled: High shared-executor finding and IMD/USD evidence require review");
  return CANDIDATE_DEPLOYMENT;
}
