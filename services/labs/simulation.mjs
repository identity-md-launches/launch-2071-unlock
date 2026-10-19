import { parseAbi, parseAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256 } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
const ROUTER='0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const abi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
export function sellCall(token,plan,blockTime) {
 if(!/^0x[\da-f]{40}$/i.test(plan?.account||'')||!/^\d+$/.test(plan?.amountRaw||'')||BigInt(plan.amountRaw)<=0n||BigInt(plan.amountRaw)>=1n<<128n||!/^\d+$/.test(plan.minimumQuoteRaw||'')||BigInt(plan.minimumQuoteRaw)<=0n)throw Error('Configure a real representative seller, amount and positive minimum quote output');
 const key=token.key,zeroForOne=key.currency0.toLowerCase()===token.address,quote=zeroForOne?key.currency1:key.currency0;
 const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'),[{poolKey:key,zeroForOne,amountIn:BigInt(plan.amountRaw),amountOutMinimum:BigInt(plan.minimumQuoteRaw),hookData:'0x'}]);
 const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[token.address,BigInt(plan.amountRaw)]),take=encodeAbiParameters(parseAbiParameters('address,uint256'),[quote,BigInt(plan.minimumQuoteRaw)]);
 return {from:plan.account.toLowerCase(),to:ROUTER,data:encodeFunctionData({abi,functionName:'execute',args:['0x10',[encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]])],BigInt(blockTime)+120n]}),value:'0x0'};
}
export async function simulateSell(io,token,plan,block,blockData,now=Date.now()) {
 const blockMs=Number(BigInt(blockData.timestamp))*1000;if(now-blockMs>600000||blockMs>now+30000)throw Error('Simulation block is stale or from the future');
 const tx=sellCall(token,plan,Number(BigInt(blockData.timestamp))),tag='0x'+BigInt(block).toString(16);
 if(BigInt(await io.rpc('eth_chainId'))!==1n)throw Error('Simulation RPC is not Ethereum');
 const accountCode=await io.rpc('eth_getCode',[tx.from,tag]);if(accountCode!=='0x'&&!accountCode.startsWith('0xef0100'))throw Error('Representative seller must be an existing EOA or delegated EOA; unknown contract execution is unsupported');
 const amountUsd=Number(BigInt(plan.amountRaw))/10**token.decimals*token.priceUsd;if(!Number.isFinite(amountUsd)||amountUsd<1)throw Error('Representative sell must be worth at least $1 at the checked spot price');
 // This executes the actual router, settlement and token transfer with the account's real
 // balances, approvals and quota. No state overrides, quoter-only success or writes.
 const result=await io.rpc('eth_call',[tx,tag]);if(result!=='0x')throw Error('Unexpected Universal Router return data');
 return {success:true,chainId:1,account:tx.from,token:token.address,poolId:token.poolId,amountRaw:plan.amountRaw,amountUsd,minimumQuoteRaw:plan.minimumQuoteRaw,method:'router-eth_call',stateOverrides:false,callHash:keccak256(tx.data),checkedAt:new Date(now).toISOString(),block:Number(block),blockHash:blockData.hash,notes:'Full-route exact-input sell; specific to this account, size and confirmed block. No guarantee for every holder. No transaction was sent.'};
}
