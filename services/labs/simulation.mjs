import { parseAbi, parseAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256 } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import {takeWork} from './rpc.mjs';
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

const PERMIT2='0x000000000022d473030f116ddee9f6b43ac78ba3';
const TOKEN=parseAbi(['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)']);
const PERMIT=parseAbi(['function allowance(address,address,address) view returns(uint160 amount,uint48 expiration,uint48 nonce)']);
const QUOTA=parseAbi(['function remainingQuota(address) view returns(uint256)']);
const SWAP_TOPIC=keccak256(new TextEncoder().encode('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)'));
const TRANSFER_TOPIC=keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'));
const tag=n=>'0x'+BigInt(n).toString(16);
export function currentSellPlan(token,account,balance,allowance,permit,quota,blockTime){
 if(!(token.priceUsd>0)||!Number.isInteger(token.decimals)||!token.sqrtPriceX96)throw Error('Checked block pricing is unavailable');
 const unit=10**token.decimals,target=BigInt(Math.max(1,Math.floor(5/token.priceUsd*unit)));
 let amount=[target,balance,allowance,permit[0],...(quota==null?[]:[quota])].reduce((a,b)=>a<b?a:b);
 if(Number(permit[1])<blockTime)throw Error('Account Permit2 allowance expired');
 if(amount<=0n||Number(amount)/unit*token.priceUsd<1)throw Error('Account balance, allowance or hook quota cannot cover a representative $1 sell');
 const ratio=(Number(BigInt(token.sqrtPriceX96))/2**96)**2,zero=token.key.currency0.toLowerCase()===token.address;
 // Exact block spot, pool fee, plus 10% maximum impact/slippage. Full router call
 // must actually deliver this minimum using real account state; spot alone never admits.
 const quote=Number(amount)*(zero?ratio:1/ratio)*(1-token.key.fee/1e6)*0.90;
 if(!Number.isFinite(quote)||quote<1)throw Error('Positive checked minimum quote is unavailable');
 return {account,amountRaw:amount.toString(),minimumQuoteRaw:BigInt(Math.floor(quote)).toString()};
}
async function discoverSellers({io,store,token,block}){
 const key=`sellers:${token.address}`,state=store.get(key)||{candidates:[],before:Number(block)+1};
 // Scan recent successful swaps backwards in bounded pages. Persist the cursor.
 const to=state.before>Number(block)?Number(block):state.before-1,from=Math.max(token.deploymentBlock||0,to-499);
 if(to<from){state.before=Number(block)+1;store.set(key,state);return state.candidates;}
 const logs=await io.rpc('eth_getLogs',[{address:'0x000000000004444c5dc75cb358380d2e3de08a90',fromBlock:tag(from),toBlock:tag(to),topics:[SWAP_TOPIC,token.poolId]}]);
 if(logs.length>=10000)throw Error('Seller log page may be truncated; provider range needs reduction');
 const hashes=[...new Set(logs.filter(l=>!l.removed).map(l=>l.transactionHash))].slice(-8).reverse();
 for(const hash of hashes){try{const [tx,receipt]=await Promise.all([io.rpc('eth_getTransactionByHash',[hash]),io.rpc('eth_getTransactionReceipt',[hash])]);if(!tx?.from||receipt?.status!=='0x1'||receipt.blockHash!==logs.find(l=>l.transactionHash===hash)?.blockHash)continue;const account=tx.from.toLowerCase();
  // Receipt must evidence this EOA actually acquiring or selling this exact asset.
  const topic='0x'+account.slice(2).padStart(64,'0');const transfer=receipt.logs?.find(l=>l.address.toLowerCase()===token.address&&l.topics[0]===TRANSFER_TOPIC&&(l.topics[1]?.toLowerCase()===topic||l.topics[2]?.toLowerCase()===topic)&&BigInt(l.data)>0n);if(!transfer)continue;
  state.candidates=state.candidates.filter(c=>c.account!==account);state.candidates.push({account,hash,block:Number(BigInt(receipt.blockNumber)),blockHash:receipt.blockHash,basis:'Successful exact-pool swap receipt with matching token transfer and transaction sender'});
 }catch(e){if(/quota|429|provider|fetch/i.test(e.message))throw e;}}
 state.candidates=state.candidates.slice(-64);state.before=from;store.set(key,state);return state.candidates;
}
export async function automaticSell({io,store,token,plan,block,blockData,now=Date.now()}){
 let candidates=store.get(`sellers:${token.address}`)?.candidates||[];
 const indexed=(store.get('radar.index')?.events||[]).filter(e=>e.token===token.address&&e.wallet&&e.attributionState?.status==='reconciled').map(e=>({account:e.wallet,hash:e.hash,block:e.block,basis:'Indexed reconciled swap'}));
 candidates=[...indexed,...candidates];try{candidates.push(...await discoverSellers({io,store,token,block}));}catch(e){store.set(`seller-discovery-error:${token.address}`,{error:e.message,block:Number(block)});if(!candidates.length)throw e;}
 candidates=[...new Map(candidates.map(c=>[c.account.toLowerCase(),c])).values()];
 if(plan?.account&&!candidates.some(c=>c.account===plan.account))throw Error('Configured seller has no evidenced successful swap; bootstrap seller discovery first');
 const seen=new Set(),failures=[];
 for(const candidate of takeWork(store,`sellerCandidates:${token.address}`,candidates,8)){
  const account=candidate.account.toLowerCase();if(seen.has(account))continue;seen.add(account);if(seen.size>8)break;
  try{const [balance,allowance,permit]=await Promise.all([io.read(token.address,TOKEN,'balanceOf',[account],tag(block)),io.read(token.address,TOKEN,'allowance',[account,PERMIT2],tag(block)),io.read(PERMIT2,PERMIT,'allowance',[account,token.address,ROUTER],tag(block))]);
   // Only this reviewed hook exposes a known rights interface. Other hooks are
   // enforced by the full-route eth_call, never bypassed or overridden.
   const rights=token.key.hooks.toLowerCase()==='0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc'?await io.read(token.key.hooks,QUOTA,'remainingQuota',[account],tag(block)):null;
   const current=currentSellPlan(token,account,balance,allowance,permit,rights,Number(BigInt(blockData.timestamp)));
   const check=await simulateSell(io,token,current,block,blockData,now);return {...check,sellerEvidence:candidate,allowanceChecked:true,hookRights: rights?.toString()??'Full-route hook execution',failedCandidates:failures,providerProvenance:io.provenance?.slice(-8)};
  }catch(e){failures.push({account,reason:e.message,scope:'account-specific or unknown; no token-wide unsellability inferred'});if(/Bounded RPC|Provider|429|fetch failed/i.test(e.message))break;}
 }
 store.set(`seller-status:${token.address}`,{failures,candidates:candidates.length,block:Number(block),at:new Date(now).toISOString()});
 throw Error(candidates.length?`No eligible representative seller yet (${failures.length} accounts checked): ${failures.map(f=>f.reason).join('; ').slice(0,400)}`:'Seller indexing: no evidenced successful swap account discovered yet');
}
