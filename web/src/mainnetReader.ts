import { keccak256, parseAbi, type Address, type PublicClient } from "viem";
import { IMD, IMD_CODEHASH, POOL_MANAGER, NFT_BENEFICIARY, NEXT_RATES, SUCCESSOR_FLAGS, UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODEHASH, type CandidateDeployment } from "./mainnet";
import { candidateQuota } from "./candidate";
import { verifiedMatureQuota } from "./mainnet";

const hookAbi = parseAbi([
  "function activated() view returns (bool)", "function token() view returns (address)",
  "function UNIVERSAL_ROUTER() view returns (address)", "function nftFeeVault() view returns (address)",
  "function oracle() view returns (address)", "function poolManager() view returns (address)",
  "function quoteToken() view returns (address)", "function tokenIs0() view returns (bool)",
  "function FEE() view returns (uint24)", "function FLAGS() view returns (uint160)",
  "function p() view returns (uint16)", "function tier() view returns (uint8)",
  "function fullyUnlocked() view returns (bool)", "function eligible(address) view returns (uint256)",
  "function spendableEligible(address) view returns (uint256)",
  "function sold(address) view returns (uint256)", "function remainingQuota(address) view returns (uint256)",
]);
const vaultAbi = parseAbi([
  "function quoteToken() view returns (address)",
  "function hook() view returns (address)", "function poolManager() view returns (address)",
  "function BENEFICIARY() view returns (address)", "function totalAccrued() view returns (uint256)",
  "function totalWithdrawn() view returns (uint256)", "function totalRedeemed() view returns (uint256)",
  "function claimable() view returns (uint256)", "function pendingClaims() view returns (uint256)",
  "function donations() view returns (uint256)", "function donationsWithdrawn() view returns (uint256)",
]);
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const oracleAbi = parseAbi(["function fdvUsd() view returns (uint256)"]);
export interface CandidateSnapshot {
  block: bigint; readAt: number; p: number; tier: number; fullyUnlocked: boolean;
  fdv: bigint | null; oracleError: string | null;
  wallet: {address:Address; balance:bigint; E:bigint; matureE:bigint; immatureE:bigint; S:bigint; quota:bigint; sellable:bigint; imdBalance:bigint; imdApproval:bigint; permit2Allowance:bigint; permit2Expiration:number} | null;
  vault: {accrued:bigint; withdrawn:bigint; redeemed:bigint; claimable:bigint; pendingClaims:bigint; donations:bigint; donationsWithdrawn:bigint; unlkBalance:bigint};
}

/// Future read adapter only. The application has no candidate deployment and enables no candidate writes.
export async function readMainnetCandidate(deployment: CandidateDeployment | null, client: PublicClient, wallet?: Address): Promise<CandidateSnapshot> {
  if (!deployment) throw new Error("Candidate is not deployed");
  if (await client.getChainId() !== 1 || deployment.chainId !== 1) throw new Error("Candidate reads require Ethereum mainnet");
  const block = await client.getBlockNumber({cacheTime:0});
  await Promise.all((["token","hook","vault"] as const).map(async role => {
    const code=await client.getBytecode({address:deployment[role],blockNumber:block});
    if (!code || code==="0x" || keccak256(code)!==deployment.runtimeHashes[role]) throw new Error(`Candidate ${role} code hash mismatch`);
  }));
  const imdCode=await client.getBytecode({address:IMD,blockNumber:block});
  if(!imdCode || keccak256(imdCode)!==IMD_CODEHASH) throw new Error("IMD runtime mismatch");
  const routerCode=await client.getBytecode({address:UNIVERSAL_ROUTER,blockNumber:block});
  if (!routerCode || keccak256(routerCode)!==UNIVERSAL_ROUTER_CODEHASH) throw new Error("Universal Router code hash mismatch");
  const hookRead = async (name:string,args?:readonly unknown[]) => client.readContract({address:deployment.hook,abi:hookAbi,functionName:name,args,blockNumber:block} as any);
  const vaultRead = async (name:string) => client.readContract({address:deployment.vault,abi:vaultAbi,functionName:name,blockNumber:block} as any);
  const [activated,token,router,vault,oracle,manager,fee,flags,p,tier,fullyUnlocked,beneficiary,vaultHook,vaultManager] = await Promise.all([
    hookRead("activated"),hookRead("token"),hookRead("UNIVERSAL_ROUTER"),hookRead("nftFeeVault"),hookRead("oracle"),hookRead("poolManager"),
    hookRead("FEE"),hookRead("FLAGS"),hookRead("p"),hookRead("tier"),hookRead("fullyUnlocked"),vaultRead("BENEFICIARY"),vaultRead("hook"),vaultRead("poolManager"),
  ]);
  const same=(a:unknown,b:string)=>typeof a==="string"&&a.toLowerCase()===b.toLowerCase();
  if (!same(manager,POOL_MANAGER) || !activated || !same(token,deployment.token) || !same(router,UNIVERSAL_ROUTER) || !same(vault,deployment.vault) ||
      !same(vaultHook,deployment.hook) || !same(beneficiary,NFT_BENEFICIARY) || !same(vaultManager,String(manager)) ||
      Number(fee)!==12500 || Number(flags)!==SUCCESSOR_FLAGS || NEXT_RATES[Number(tier)]!==Number(p) || fullyUnlocked!==(Number(tier)===16)) throw new Error("Candidate binding or rules mismatch");
  const quoteAbi = parseAbi(["function decimals() view returns (uint8)","function allowance(address,address) view returns (uint256)","function balanceOf(address) view returns (uint256)"]);
  const [hookQuote,vaultQuote,quoteDecimals]=await Promise.all([hookRead("quoteToken"),vaultRead("quoteToken"),
    client.readContract({address:IMD,abi:quoteAbi,functionName:"decimals",blockNumber:block})]);
  if(!same(hookQuote,IMD)||!same(vaultQuote,IMD)||Number(quoteDecimals)!==18) throw new Error("IMD quote currency mismatch");
  const names=["totalAccrued","totalWithdrawn","totalRedeemed","claimable","pendingClaims","donations","donationsWithdrawn"];
  const [accrued,withdrawn,redeemed,claimable,pendingClaims,donations,donationsWithdrawn]=(await Promise.all(names.map(vaultRead))) as bigint[];
  if (withdrawn>redeemed || redeemed>accrued || claimable!==redeemed-withdrawn || pendingClaims!==accrued-redeemed) throw new Error("Vault accounting inconsistent");
  // IMD fee claims are separate from unsolicited UNLK and token donations.
  const unlkBalance=await client.readContract({address:deployment.token,abi:tokenAbi,functionName:"balanceOf",args:[deployment.vault],blockNumber:block}) as bigint;
  let personal: CandidateSnapshot["wallet"]=null;
  if (wallet) {
    const [balance,E,matureE,S,quota]=await Promise.all([
      client.readContract({address:deployment.token,abi:tokenAbi,functionName:"balanceOf",args:[wallet],blockNumber:block}),
      hookRead("eligible",[wallet]),hookRead("spendableEligible",[wallet]),hookRead("sold",[wallet]),hookRead("remainingQuota",[wallet]),
    ]) as bigint[];
    const expectedQuota=verifiedMatureQuota(E,matureE,S,BigInt(Number(p)),Boolean(fullyUnlocked));
    if (quota!==expectedQuota) throw new Error("Candidate quota does not match its ledger");
    const [imdBalance,imdApproval]=await Promise.all([
      client.readContract({address:IMD,abi:quoteAbi,functionName:"balanceOf",args:[wallet],blockNumber:block}),
      client.readContract({address:IMD,abi:quoteAbi,functionName:"allowance",args:[wallet,"0x000000000022D473030F116dDEE9F6B43aC78BA3"],blockNumber:block})]);
    const [permit2Allowance,permit2Expiration]=await client.readContract({address:"0x000000000022D473030F116dDEE9F6B43aC78BA3",
      abi:parseAbi(["function allowance(address,address,address) view returns (uint160,uint48,uint48)"]),
      functionName:"allowance",args:[wallet,IMD,UNIVERSAL_ROUTER],blockNumber:block});
    personal={address:wallet,balance,E,matureE,immatureE:E-matureE,S,quota,imdBalance,imdApproval,permit2Allowance,permit2Expiration,sellable:candidateQuota(balance,matureE,S,BigInt(Number(p)),Boolean(fullyUnlocked))};
  }
  let fdv: bigint | null=null; let oracleError: string | null=null;
  try { fdv=await client.readContract({address:oracle as Address,abi:oracleAbi,functionName:"fdvUsd",blockNumber:block}); }
  catch { oracleError="Gate FDV unavailable: official pool state or the separate sampled IMD/USD reference fails history, freshness, depth or warm-up checks. Existing gates remain open."; }
  return {block,readAt:Date.now(),p:Number(p),tier:Number(tier),fullyUnlocked:Boolean(fullyUnlocked),fdv,oracleError,wallet:personal,
    vault:{accrued,withdrawn,redeemed,claimable,pendingClaims,donations,donationsWithdrawn,unlkBalance}};
}
