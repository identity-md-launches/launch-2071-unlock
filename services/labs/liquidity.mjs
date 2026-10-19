/** V4 reserves are reconstructed per pool position, never from shared manager balances. */
import { parseAbi, parseAbiItem, decodeEventLog, keccak256, stringToHex } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
const MANAGER='0x000000000004444c5dc75cb358380d2e3de08a90', VIEW='0x7ffe42c4a5deea5b0fec41c94c136cf115597227';
const MODIFY=parseAbiItem('event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)');
const INIT=parseAbiItem('event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)');
const topic=keccak256(stringToHex('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)'));
const initTopic=keccak256(stringToHex('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'));
const ABI=parseAbi(['function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)','function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)']);
const tag=n=>'0x'+BigInt(n).toString(16);
export function positionValue(positions,{sqrtPriceX96,tick,activeLiquidity,decimals0,decimals1,usd0,usd1}) {
 if(!Number.isInteger(decimals0)||!Number.isInteger(decimals1)||![usd0,usd1].every(p=>Number.isFinite(p)&&p>0)||BigInt(sqrtPriceX96)<=0n)throw Error('USD reference, decimals or pool state unavailable');
 const s=Number(sqrtPriceX96)/2**96;let total0=0,total1=0,active0=0,active1=0,active=0n;
 for(const p of Object.values(positions)) {
  const raw=BigInt(p.liquidity);if(raw<0n)throw Error('Position replay is incomplete');if(raw===0n)continue;
  const a=1.0001**(p.lower/2),b=1.0001**(p.upper/2),L=Number(raw);if(!(a>0&&b>a))throw Error('Invalid tick range');
  const x=s<=a?L*(1/a-1/b):s<b?L*(1/s-1/b):0;
  const y=s>=b?L*(b-a):s>a?L*(s-a):0;
  total0+=x/10**decimals0;total1+=y/10**decimals1;
  if(p.lower<=tick&&tick<p.upper){active+=raw;active0+=x/10**decimals0;active1+=y/10**decimals1;}
 }
 if(active!==BigInt(activeLiquidity))throw Error('Replayed active liquidity does not match StateView; inventory incomplete');
 const usd=total0*usd0+total1*usd1,activeUsd=active0*usd0+active1*usd1;
 if(![usd,activeUsd].every(Number.isFinite)||usd<0)throw Error('Invalid liquidity valuation');
 return {usd,activeUsd,amount0:total0,amount1:total1,activeLiquidity:active.toString(),currency0Usd:usd0,currency1Usd:usd1};
}
export function applyPositionLogs(positions,logs,poolId) {
 const next=structuredClone(positions),seen=new Set();
 for(const log of [...logs].sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex)-BigInt(b.logIndex)))) {
  const id=`${log.transactionHash}:${log.logIndex}`;if(seen.has(id)||log.removed)continue;seen.add(id);
  const {args}=decodeEventLog({abi:[MODIFY],topics:log.topics,data:log.data,strict:true});if(args.id.toLowerCase()!==poolId.toLowerCase())throw Error('Wrong PoolId in liquidity replay');
  const key=`${args.sender.toLowerCase()}:${args.tickLower}:${args.tickUpper}:${args.salt}`;const p=next[key]||{lower:args.tickLower,upper:args.tickUpper,liquidity:'0'};
  const liquidity=BigInt(p.liquidity)+args.liquidityDelta;if(liquidity<0n)throw Error('Incomplete position history');next[key]={...p,liquidity:liquidity.toString()};
 }
 return next;
}
export function createLiquidityVerifier({store,io,now=()=>Date.now(),pageBlocks=1000,maxPages=6}) {
 return async function check(token,block,prices,blockData) {
  if(!Number.isSafeInteger(token.deploymentBlock)||token.deploymentBlock<=0)throw Error('Verified pool deployment start block is unavailable');
  const key=`liquidity:${token.poolId}`,old=store.get(key);let state=(old?.startBlock===token.deploymentBlock?old:null)||{lastBlock:token.deploymentBlock-1,positions:{},init:false,startBlock:token.deploymentBlock};
  if(state.lastHash){const b=await io.rpc('eth_getBlockByNumber',[tag(state.lastBlock),false]);if(b?.hash!==state.lastHash)state={lastBlock:token.deploymentBlock-1,positions:{},init:false,startBlock:token.deploymentBlock};}
  let pages=0;
  for(let start=state.lastBlock+1;start<=Number(block)&&pages<maxPages;start+=pageBlocks,pages++){
   const end=Math.min(Number(block),start+pageBlocks-1);
   const logs=await io.rpc('eth_getLogs',[{address:MANAGER,fromBlock:tag(start),toBlock:tag(end),topics:[[topic,initTopic],token.poolId]}]);
   if(logs.length>=10000)throw Error('Liquidity log page may be truncated; use a smaller block range');
   for(const log of logs.filter(l=>l.topics[0].toLowerCase()===initTopic)){
    const {args}=decodeEventLog({abi:[INIT],topics:log.topics,data:log.data,strict:true});
    if(args.currency0.toLowerCase()!==token.key.currency0.toLowerCase()||args.currency1.toLowerCase()!==token.key.currency1.toLowerCase()||args.hooks.toLowerCase()!==token.key.hooks.toLowerCase()||args.fee!==token.key.fee||args.tickSpacing!==token.key.tickSpacing)throw Error('Initialize event disagrees with verified PoolKey');state.init=true;state.initializedBlock=Number(BigInt(log.blockNumber));
   }
   state.positions=applyPositionLogs(state.positions,logs.filter(l=>l.topics[0].toLowerCase()===topic),token.poolId);state.lastBlock=end;
   const b=end===Number(block)?blockData:await io.rpc('eth_getBlockByNumber',[tag(end),false]);state.lastHash=b.hash;store.set(key,state);
  }
  if(!state.init||state.lastBlock!==Number(block))throw Error(`Liquidity inventory warming: through block ${state.lastBlock}; requires initialized pool through ${block}`);
  const [slot,active]=await Promise.all([io.read(VIEW,ABI,'getSlot0',[token.poolId],tag(block)),io.read(VIEW,ABI,'getLiquidity',[token.poolId],tag(block))]);
  const value=positionValue(state.positions,{sqrtPriceX96:slot[0],tick:slot[1],activeLiquidity:active,decimals0:token.key.currency0.toLowerCase()===token.address?token.decimals:18,decimals1:token.key.currency1.toLowerCase()===token.address?token.decimals:18,usd0:prices[token.key.currency0.toLowerCase()],usd1:prices[token.key.currency1.toLowerCase()]});
  return {...value,verified:true,complete:true,method:'v4-position-inventory',checkedAt:new Date(now()).toISOString(),block:Number(block),blockHash:blockData.hash,fromBlock:state.startBlock,initializedBlock:state.initializedBlock,notes:'Principal reserves reconstructed per owner/tick/salt position; fee claims excluded. Active position liquidity reconciled exactly to StateView. No shared manager balances.'};
 };
}
