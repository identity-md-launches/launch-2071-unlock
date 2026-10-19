import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,parseAbiItem} from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import {poolId,IMD_KEY,IMD_ETH_POOL,UNLK,IMD,mapDex,selectLaunches,createMarketServices,createRpc} from './markets.mjs';
import {amountString,classifyPoolLog,receiptNet,createIndexer} from './indexer.mjs';
const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222';
const transfer=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
function transferLog(from,to,value,token=IMD){return {address:token,topics:encodeEventTopics({abi:[transfer],eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])};}
test('known IMD v4 PoolId exactly matches canonical key; rejects unsorted or unsafe keys',()=>{assert.equal(poolId(IMD_KEY),IMD_ETH_POOL);assert.throws(()=>poolId({...IMD_KEY,currency0:IMD,currency1:IMD_KEY.currency0}));assert.throws(()=>poolId({...IMD_KEY,hooks:'https://bad.test'}));});
test('absent metrics remain unavailable and circulating supply is not invented',()=>{assert.deepEqual(mapDex(),{priceUsd:null,priceChange24h:null,volume24h:null,liquidityUsd:null,fdv:null,marketCap:null,marketCapEvidence:null});assert.equal(mapDex({priceUsd:'0',marketCap:123}).priceUsd,0);assert.equal(mapDex({marketCap:123}).marketCap,123);assert.match(mapDex({marketCap:123}).marketCapEvidence,/provider-reported/);assert.equal(mapDex({fdv:123}).marketCap,null);});
test('registry discovery accepts actual live mainnet token pools and excludes ambiguous IMUSD',()=>{
 const row={id:'a',chainId:1,status:'live',launchNumber:1,artifacts:[{role:'token',name:'Token',address:UNLK}],seeded:{pools:[{...IMD_KEY,currency0:UNLK,currency1:IMD}]}};
 assert.equal(selectLaunches([row]).length,1);assert.equal(selectLaunches([{...row,chainId:4663}]).length,0);assert.equal(selectLaunches([{...row,artifacts:[{role:'token',name:'IMUSD',address:UNLK}]}]).length,0);
});
test('amount decimals do not lose atomic precision',()=>{assert.equal(amountString(-1000000000000000001n),'-1.000000000000000001');assert.equal(amountString(0n),'0');assert.equal(amountString(1234000n,6),'1.234');});
test('v4 swap direction uses signed caller delta; liquidity is a separate operation',()=>{
 const swap=parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
 const topics=encodeEventTopics({abi:[swap],eventName:'Swap',args:{id:IMD_ETH_POOL,sender:A}});
 const data=encodeAbiParameters([{type:'int128'},{type:'int128'},{type:'uint160'},{type:'uint128'},{type:'int24'},{type:'uint24'}],[-1n,2n,1n<<96n,10n,0,10000]);
 const buy=classifyPoolLog({topics,data},{key:IMD_KEY,address:IMD,decimals:18});assert.equal(buy.type,'buy');assert.equal(buy.tokenDelta,'2');assert.equal(buy.wallet,undefined);
 const liq=parseAbiItem('event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)');
 const change=classifyPoolLog({topics:encodeEventTopics({abi:[liq],eventName:'ModifyLiquidity',args:{id:IMD_ETH_POOL,sender:A}}),data:encodeAbiParameters([{type:'int24'},{type:'int24'},{type:'int256'},{type:'bytes32'}],[-60,60,100n,'0x'+'00'.repeat(32)])},{key:IMD_KEY,address:IMD,decimals:18});assert.equal(change.type,'liquidity');assert.equal(change.amount,null);
});
test('attribution reconciles only transfers of the specific token and wallet',()=>{const receipt={logs:[transferLog(A,B,10n),transferLog(B,A,3n),transferLog(A,B,500n,UNLK)]};assert.equal(receiptNet(receipt,IMD,A),-7n);assert.equal(receiptNet(receipt,IMD,B),7n);});
test('warming snapshot and unsupported period are explicit',async()=>{const memory=new Map();const service=createMarketServices({store:{get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)}});assert.equal((await service.markets()).mode,'warming');const radar=await service.radar({period:'1h'});assert.equal(radar.events.length,0);assert.equal(radar.coverage.missingHistory,true);await assert.rejects(service.radar({period:'30d'}),/Supported periods/);});
test('cached period pagination computes transfer net flow without treating transfers as swaps',async()=>{
 const now=Date.now();const e=(id,from,to,raw,time)=>({id,type:'transfer',symbol:'IMD',token:IMD,amountRaw:String(raw),from,to,time,block:1});
 const snapshot={updatedAt:new Date(now).toISOString(),coverage:{missingHistory:true,fromTime:now/1000-100},events:[e('1',A,B,10n,now/1000-20),e('2',B,A,3n,now/1000-10),e('3',A,B,99n,now/1000-7200)],wallets:[{address:A}]};
 const index=createIndexer({store:{get:k=>k==='radar.snapshot'?snapshot:undefined,set(){}},io:{},now:()=>now});const value=await index.radar({period:'1h'});assert.equal(value.events.length,2);assert.equal(value.wallets[0].netFlow[0].amount,'-0.000000000000000007');assert.equal(value.coverage.periodComplete,false);await assert.rejects(index.radar({cursor:'-1'}),/Invalid bounded/);
});
test('RPC attempt quota includes retries and never requests a different provider implicitly',async()=>{
 let requests=0;const io=createRpc({url:'https://rpc.example',budget:2,fetchImpl:async url=>{assert.equal(url,'https://rpc.example');requests++;return new Response("unavailable",{status:503});}});
 await assert.rejects(io.rpc('eth_blockNumber'),/quota reached/);assert.equal(requests,2);assert.equal(io.used,2);
 await assert.rejects(io.rpc('eth_blockNumber'),/quota reached/);assert.equal(requests,2);
});
test('persistent overlap replay deduplicates logs and provider failure preserves checkpoint',async()=>{
 const fixedNow=Date.now(),memory=new Map();const store={get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
 const fixture={...transferLog(A,B,10n),blockNumber:'0x7cf',logIndex:'0x0',transactionHash:'0x'+'33'.repeat(32),removed:false};
 const block=n=>({hash:'0x'+BigInt(n).toString(16).padStart(64,'0'),timestamp:'0x'+Math.floor(fixedNow/1000-(2001-Number(n))*12).toString(16)});
 let fail=false;const io={rpc:async(method,args)=>{if(fail)throw Error('RPC unavailable');if(method==='eth_getCode')return '0x';if(method==='eth_getBlockByNumber')return block(BigInt(args[0]));if(method==='eth_getLogs'){const filter=args[0];return BigInt(filter.fromBlock)<=1999n&&BigInt(filter.toBlock)>=1999n?[fixture]:[];}throw Error(method);},read:async(token,abi,name,[wallet])=>token===IMD?(wallet===A?10n:wallet===B?20n:0n):0n};
 const index=createIndexer({store,io,now:()=>fixedNow});await index.refresh({pools:[],block:2000n,blockData:block(2000),usdPrices:{[IMD]:5}});assert.equal(store.get('radar.index').events.length,1);
 await index.refresh({pools:[],block:2001n,blockData:block(2001),usdPrices:{[IMD]:5}});assert.equal(store.get('radar.index').events.length,1);assert.equal(store.get('radar.index').lastBlock,2001);
 fail=true;await assert.rejects(index.refresh({pools:[],block:2002n,blockData:block(2002)}),/unavailable/);assert.equal(store.get('radar.index').lastBlock,2001);assert.equal((await index.radar()).wallets.length,3);
});
test('changed confirmed checkpoint discards all old rows and resets coverage within bounded budget',async()=>{
 const fixedNow=Date.now(),memory=new Map();const store={get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
 store.set('radar.index',{events:[{id:'orphan-old',type:'transfer',symbol:'IMD',token:IMD,amountRaw:'9',from:A,to:B,time:fixedNow/1000-5000,block:1500}],startBlock:1,lastBlock:2000,lastHash:'0x'+'aa'.repeat(32),blocks:{1:{time:fixedNow/1000-20000,hash:'0xold'}}});
 const ranges=[];const block=n=>({hash:'0x'+BigInt(n).toString(16).padStart(64,'0'),timestamp:'0x'+Math.floor(fixedNow/1000-(2010-Number(n))*12).toString(16)});
 const io={rpc:async(method,args)=>{if(method==='eth_getBlockByNumber')return block(BigInt(args[0]));if(method==='eth_getLogs'){ranges.push(args[0]);return [];}if(method==='eth_getCode')return '0x';throw Error(method);},read:async()=>0n};
 const index=createIndexer({store,io,now:()=>fixedNow});await index.refresh({pools:[],block:2010n,blockData:block(2010)});
 assert.deepEqual(store.get('radar.index').events,[]);assert.equal(store.get('radar.index').startBlock,211);assert.equal(store.get('radar.index').lastBlock,2010);assert.equal(ranges.length,4);assert.equal(BigInt(ranges[0].fromBlock),211n);assert.equal(store.get('radar.snapshot').coverage.fromBlock,211);assert.ok(store.get('radar.snapshot').coverage.notes.some(n=>n.includes('all retained rows were discarded')));
});
