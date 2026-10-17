import { parseAbi, type Abi } from "viem";
import hook from "./abis/UnlkImdHook.json";
import vault from "./abis/ImdFeeVault.json";
import oracle from "./abis/UnlkImdOracle.json";
import evidence from "./abis/MerkleClaimEvidence.json";
import distributor from "./abis/MerkleDistributor.json";
export const hookAbi = hook as Abi;
export const vaultAbi = vault as Abi;
export const oracleAbi = oracle as Abi;
export const evidenceAbi = evidence as Abi;
export const distributorAbi = distributor as Abi;
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
]);
export const permitAbi = parseAbi([
  "function allowance(address,address,address) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const executeAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
