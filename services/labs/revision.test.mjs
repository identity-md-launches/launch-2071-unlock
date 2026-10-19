/** Reviewer regressions. All chain records, logs and accounts below are isolated fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAbiItem,encodeEventTopics,encodeAbiParameters} from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import {createIdentityResolver} from './identities.mjs';
import {createIndexer,assetCoverageKey} from './indexer.mjs';
import {createTokenData} from './token-data.mjs';
import {IMD,POOL_MANAGER,poolId,quota,hex} from './markets.mjs';
import {createStore} from './store.mjs';
import {createProfiles} from './profiles.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const A='0x1111111111111111111111111111111111111111',B='0x2222222222222222222222222222222222222222';
const T='0x3333333333333333333333333333333333333333',U='0x4444444444444444444444444444444444444444';
const ROUTER='0x66a9893cc07d91d95644aedd05d03f95e1dba8af',LAUNCH='0528a007-5ec6-4acd-b9cc-b3ded6fe2929';
const HASH='0x'+'aa'.repeat(32),NOW=Date.parse('2026-10-19T10:00:00Z');
function memory(){const m=new Map();return {get:k=>m.has(k)?structuredClone(m.get(k)):undefined,set:(k,v)=>m.set(k,structuredClone(v))};}
function identityFixture(){
 const store=memory();let owner=B,error=null;
 const record={id:LAUNCH,chainId:1,status:'live',requester:A,artifacts:[{role:'token',address:T,txHash:HASH,blockNumber:100}]};
 const io={json:async()=>record,rpc:async m=>m==='eth_getCode'?'0x6000':{status:'0x1',blockNumber:hex(100)},read:async()=>{if(error)throw error;return owner;}};
 return {resolver:createIdentityResolver({store,io,now:()=>NOW,extraLaunchIds:[LAUNCH]}),setOwner:v=>owner=v,setError:e=>error=e};
}
test('former requester stays unauthorized when the current owner read fails or cannot decode',async()=>{
 const f=identityFixture();assert.equal((await f.resolver.rights(T,A)).authorized,false);assert.equal((await f.resolver.rights(T,B)).authorized,true);
 for(const error of [Error('RPC timeout'),Error('execution reverted'),Error('undecodable owner result')]){f.setError(error);await assert.rejects(f.resolver.rights(T,A));await assert.rejects(f.resolver.rights(T,B));}
 f.setError(null);for(const value of ['0x','invalid',null]){f.setOwner(value);await assert.rejects(f.resolver.rights(T,A));}
 f.setOwner('0x'+'0'.repeat(40));await assert.rejects(f.resolver.rights(T,A),/renounced|unresolved/);
 f.setOwner(B);assert.equal((await f.resolver.rights(T,A)).authorized,false);assert.equal((await f.resolver.rights(T,B)).authorized,true);
});

const TRANSFER=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
const SWAP=parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const key={currency0:T,currency1:IMD,fee:12500,tickSpacing:60,hooks:B},ID=poolId(key);
function historyFixture({head=310,deploymentBlock=120,store=memory(),crowded=false}={}){
 const ranges=[],attributionRequests=[];let fail=false,clock=NOW,attributionFailure=null;const logs=[],receipts=new Map(),senders=new Map();
 const block=n=>({number:hex(n),hash:'0x'+BigInt(n).toString(16).padStart(64,'0'),timestamp:hex(Math.floor(NOW/1000)-(head-Number(n))*12)});
 function trade(n,buy,amount,value,wallet=A,nonce=wallet===A?n:10000+n){
  const transactionHash='0x'+BigInt(nonce).toString(16).padStart(64,'0');senders.set(transactionHash,wallet);
  const common={blockNumber:hex(n),transactionHash,transactionIndex:'0x0',removed:false};
  const delta=BigInt(amount)*10n**18n*(buy?1n:-1n),quote=BigInt(value)*10n**18n*(buy?-1n:1n);
  const swap={...common,address:POOL_MANAGER,logIndex:'0x0',topics:encodeEventTopics({abi:[SWAP],eventName:'Swap',args:{id:ID,sender:ROUTER}}),data:encodeAbiParameters([{type:'int128'},{type:'int128'},{type:'uint160'},{type:'uint128'},{type:'int24'},{type:'uint24'}],[delta,quote,1n<<96n,100n,0,12500])};
  const transfer=(token,from,to,raw,index)=>({...common,address:token,logIndex:hex(index),topics:encodeEventTopics({abi:[TRANSFER],eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[raw])});
  const row=[swap,transfer(T,buy?POOL_MANAGER:wallet,buy?wallet:POOL_MANAGER,BigInt(amount)*10n**18n,1),transfer(IMD,buy?wallet:POOL_MANAGER,buy?POOL_MANAGER:wallet,BigInt(value)*10n**18n,2)];logs.push(...row);receipts.set(transactionHash,{logs:row});
 }
 for(const [n,buy,amount,value] of [[150,true,10,10],[160,false,10,20],[305,true,10,20],[309,false,4,12]])trade(n,buy,amount,value);
 if(crowded)for(let n=200;n<=221;n++)trade(n,n%2===0,1,1,B);
 const io={rpc:async(method,args)=>{
  if(fail)throw Error('RPC timeout');
  if(method==='eth_getBlockByNumber'){const b=block(BigInt(args[0]));assert.equal(Number(BigInt(b.number)),Number(BigInt(args[0])));return b;}
  if(method==='eth_getCode')return '0x';
  if(method==='eth_getTransactionByHash'){attributionRequests.push(args[0]);if(attributionFailure?.(method,args[0]))throw Error('Attribution RPC timeout');return {from:senders.get(args[0]),to:ROUTER};}
  if(method==='eth_getTransactionReceipt'){if(attributionFailure?.(method,args[0]))throw Error('Receipt RPC timeout');return receipts.get(args[0]);}
  if(method==='eth_getLogs'){const f=args[0];ranges.push(f);return logs.filter(l=>BigInt(l.blockNumber)>=BigInt(f.fromBlock)&&BigInt(l.blockNumber)<=BigInt(f.toBlock)&&(Array.isArray(f.address)?f.address.includes(l.address):f.address===l.address)&&f.topics.every((t,i)=>t==null||(Array.isArray(t)?t.includes(l.topics[i]):t===l.topics[i])));}
  throw Error(method);
 },read:async(token,abi,name,[wallet])=>name==='totalSupply'?100n*10n**18n:token===T&&wallet===A?6n*10n**18n:0n};
 const pool={poolId:ID,address:T,symbol:'FIXTURE',decimals:18,key,deploymentBlock};
 const at=new Date(NOW).toISOString(),market={...pool,chainId:1,priceUsd:4,identity:{verified:true,sourceUrl:'https://api.imd.fun/launches/'+LAUNCH},pool:{verified:true,dex:'uniswap',version:'v4',id:ID,quoteSymbol:'IMD'},liquidityCheck:{usd:25000,activeUsd:25000,verified:true,complete:true,method:'v4-position-inventory',checkedAt:at,block:head},sellCheck:{success:true,chainId:1,token:T,poolId:ID,account:A,amountRaw:'1000000000000000000',amountUsd:4,method:'router-eth_call',stateOverrides:false,callHash:HASH,checkedAt:at,block:head}};
 const index=createIndexer({store,io,now:()=>clock,historyStartBlock:100});
 const detail=createTokenData({store,io,now:()=>clock,markets:{markets:async()=>({markets:[market],block:head})}});
 const refresh=(pools,n=head)=>index.refresh({pools,block:BigInt(n),blockData:block(n),quoteUsdAt:async()=>({[IMD]:1})});
 return {store,io,index,detail,pool,market,ranges,logs,receipts,attributionRequests,trade,refresh,setFailure:v=>fail=v,setClock:v=>clock=v,setAttributionFailure:v=>attributionFailure=v};
}
test('attribution quota cannot certify an omitted round trip; old transactions retry outside the overlap',async()=>{
 const f=historyFixture({crowded:true});await f.refresh([],300);await f.refresh([f.pool]);
 let d=await f.detail.detail(T,new URLSearchParams('view=Traders')),a=d.traders.find(t=>t.address===A);
 assert.equal(f.store.get('radar.index').events.length,78);assert.equal(d.coverage.fromBlock,120);assert.equal(d.coverage.toBlock,310);assert.equal(d.coverage.hasOmissions,false);
 assert.equal(d.coverage.completeHistory,true,'raw log coverage is independent of wallet attribution');
 assert.equal(d.coverage.attribution.complete,false);assert.equal(d.coverage.attribution.pendingTransactions,2);
 assert.equal(f.store.get('radar.index').assetCoverage[assetCoverageKey(T,ID)].attribution.pendingTransactions,2);
 assert.equal(a.pnl.status,'partial');assert.equal(a.pnl.realized,null);assert.equal(a.pnl.unrealized,null);
 const candles=structuredClone(d.candles);assert(candles.length>0,'unattributed real swaps still form candles');
 await f.refresh([f.pool]);d=await f.detail.detail(T,new URLSearchParams('view=Traders'));a=d.traders.find(t=>t.address===A);
 assert.equal(a.buys,2);assert.equal(a.sells,2);assert.equal(a.pnl.status,'supported');assert.equal(a.pnl.realized,14);assert.equal(a.pnl.unrealized,12);assert.deepEqual(d.candles,candles);
 assert.equal(d.coverage.attribution.complete,true);assert.equal(f.attributionRequests.length,26,'canonical overlap must not consume the retry quota again');
});
test('fresh traffic cannot starve the persisted attribution backlog',async()=>{
 const f=historyFixture({crowded:true});await f.refresh([f.pool]);
 for(let i=0;i<24;i++)f.trade(310,i%2===0,1,1,B,20000+i);
 await f.refresh([f.pool]);
 const hashes=[150n,160n].map(n=>'0x'+n.toString(16).padStart(64,'0'));
 assert.deepEqual(new Set(f.attributionRequests.slice(24,26)),new Set(hashes));
 assert(f.store.get('radar.index').events.filter(e=>['buy','sell'].includes(e.type)&&hashes.includes(e.hash)).every(e=>e.wallet===A));
 const d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.attribution.pendingTransactions,2);assert.equal(d.traders.find(t=>t.address===A).pnl.realized,null);
});
for(const method of ['eth_getTransactionByHash','eth_getTransactionReceipt'])test(`${method} failure persists an attribution gap and retries the old transaction`,async()=>{
 const f=historyFixture(),hash='0x'+(150n).toString(16).padStart(64,'0');f.setAttributionFailure((m,h)=>m===method&&h===hash);
 await f.refresh([f.pool]);let d=await f.detail.detail(T,new URLSearchParams('view=Traders'));
 assert.equal(d.coverage.hasOmissions,false);assert.equal(d.coverage.completeHistory,true);assert.equal(d.coverage.attribution.pendingTransactions,1);
 assert.equal(d.traders.find(t=>t.address===A).pnl.status,'partial');assert.equal(d.traders.find(t=>t.address===A).pnl.realized,null);
 const candles=structuredClone(d.candles);await f.refresh([f.pool]);assert.equal(f.attributionRequests.filter(h=>h===hash).length,2,'an outage outside the overlap must retry');
 f.setAttributionFailure(null);await f.refresh([f.pool]);d=await f.detail.detail(T,new URLSearchParams('view=Traders'));
 assert.equal(d.coverage.attribution.complete,true);assert.equal(d.traders.find(t=>t.address===A).pnl.realized,14);assert.deepEqual(d.candles,candles);
});
test('unavailable receipts do not look like a completed unsupported attribution',async()=>{
 const f=historyFixture(),hash='0x'+(150n).toString(16).padStart(64,'0'),receipt=f.receipts.get(hash);f.receipts.delete(hash);
 await f.refresh([f.pool]);let d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.attribution.pendingTransactions,1);assert.equal(d.traders[0].pnl.realized,null);
 f.receipts.set(hash,receipt);await f.refresh([f.pool]);d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.traders[0].pnl.realized,14);
});
test('unresolved routing withholds P&L without discarding real candles',async()=>{
 const f=historyFixture(),first=f.logs.find(l=>l.address===POOL_MANAGER);f.logs.push({...first,logIndex:hex(3)});f.receipts.get(first.transactionHash).logs.push({...first,logIndex:hex(3)});
 await f.refresh([f.pool]);const d=await f.detail.detail(T,new URLSearchParams('view=Traders'));
 assert.equal(d.coverage.completeHistory,true);assert.equal(d.coverage.hasOmissions,false);assert.equal(d.coverage.attribution.unresolvedTransactions,1);assert.equal(d.coverage.attribution.complete,false);
 assert.equal(d.traders[0].pnl.status,'partial');assert.equal(d.traders[0].pnl.realized,null);assert(d.candles.length>0);
});
test('a swap label alone cannot discard unexplained wallet settlements from P&L',async()=>{
 const f=historyFixture();await f.refresh([f.pool]);const s=f.store.get('radar.index');
 const base={...s.events.find(e=>e.type==='transfer'&&e.token===T),hash:'0x'+'cc'.repeat(32),relatedActivity:'swap',time:NOW/1000-1800,block:160,amount:'10',amountRaw:(10n*10n**18n).toString()};
 s.events.push({...base,id:'unexplained-in',from:POOL_MANAGER,to:A},{...base,id:'unexplained-out',logIndex:2,from:A,to:POOL_MANAGER});f.store.set('radar.index',s);
 const d=await f.detail.detail(T,new URLSearchParams('view=Traders')),a=d.traders.find(t=>t.address===A);
 assert.equal(d.coverage.completeHistory,true);assert.equal(d.coverage.attribution.complete,true);assert.equal(a.pnl.status,'partial');assert.equal(a.pnl.realized,null);assert.equal(a.pnl.unrealized,null);
});
test('legacy rows cannot inherit supported P&L before attribution is reconciled again',async()=>{
 const f=historyFixture({crowded:true});await f.refresh([f.pool]);await f.refresh([f.pool]);const s=f.store.get('radar.index');
 delete s.assetCoverage[assetCoverageKey(T,ID)].attribution;for(const e of s.events)delete e.attributionState;f.store.set('radar.index',s);
 let d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.attribution.complete,false);assert.equal(d.traders.find(t=>t.address===A).pnl.realized,null);
 await f.refresh([f.pool]);d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.attribution.pendingTransactions,2);assert.equal(d.traders.find(t=>t.address===A).pnl.realized,null);
 await f.refresh([f.pool]);d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.attribution.complete,true);assert.equal(d.traders.find(t=>t.address===A).pnl.realized,14);
});
test('SQLite restart retains attribution backlog and reconciles it beyond the scan overlap',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'unlk-attribution-regression-')),file=join(dir,'history.sqlite');let store=createStore(file);
 try{
  let f=historyFixture({crowded:true,store});await f.refresh([],300);await f.refresh([f.pool]);assert.equal(store.get('radar.index').assetCoverage[assetCoverageKey(T,ID)].attribution.pendingTransactions,2);
  store.close();store=createStore(file);f=historyFixture({crowded:true,store});await f.refresh([f.pool]);
  assert.equal(Number(BigInt(f.ranges[0].fromBlock)),299,'recovery must attribute old events without rewinding raw coverage');
  const d=await f.detail.detail(T,new URLSearchParams('view=Traders')),a=d.traders.find(t=>t.address===A);
  assert.equal(d.coverage.attribution.complete,true);assert.equal(a.buys,2);assert.equal(a.sells,2);assert.equal(a.pnl.realized,14);assert.equal(a.pnl.unrealized,12);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('late discovery backfills its own PoolId from deployment instead of certifying global history',async()=>{
 const f=historyFixture();await f.refresh([],300);f.ranges.length=0;await f.refresh([f.pool]);
 assert(f.ranges.some(r=>r.address===POOL_MANAGER&&Number(BigInt(r.fromBlock))===120),'new pool must request its evidenced deployment block');
 const d=await f.detail.detail(T,new URLSearchParams('view=Traders'));
 assert.equal(d.coverage.address,T);assert.equal(d.coverage.poolId,ID);assert.equal(d.coverage.fromBlock,120);assert.equal(d.coverage.completeHistory,true);
 assert.equal(d.traders[0].pnl.status,'supported');assert.equal(d.traders[0].pnl.realized,14);assert.equal(d.traders[0].pnl.unrealized,12);
});
test('bounded token backfill stays partial with null totals until its contiguous history catches up',async()=>{
 const f=historyFixture({head:4000});await f.refresh([],300);await f.refresh([f.pool]);
 let d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.toBlock,120+quota.maxBlocksPerRefresh-1);assert.equal(d.coverage.completeHistory,false);assert.equal(d.traders[0].pnl.status,'partial');assert.equal(d.traders[0].pnl.realized,null);assert.equal(d.traders[0].pnl.unrealized,null);
 const saved=f.store.get('radar.index');f.setFailure(true);await assert.rejects(f.refresh([f.pool]),/timeout/);assert.deepEqual(f.store.get('radar.index'),saved);f.setFailure(false);
 for(let i=0;i<3;i++)await f.refresh([f.pool]);d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.completeHistory,true);assert.equal(d.traders[0].pnl.realized,14);
});
test('legacy global coverage alone never establishes a token history',async()=>{
 const f=historyFixture();await f.refresh([f.pool]);const s=f.store.get('radar.index');delete s.assetCoverage;f.store.set('radar.index',s);
 const d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.completeHistory,false);assert.equal(d.traders[0].pnl.status,'partial');assert.equal(d.traders[0].pnl.realized,null);
});
test('Radar keeps exact six-decimal flows and separates addresses sharing a symbol',async()=>{
 const store=memory(),time=NOW/1000-20;
 store.set('radar.snapshot',{chainId:1,updatedAt:new Date(NOW).toISOString(),coverage:{missingHistory:true,fromTime:time-1},events:[{id:'one',type:'transfer',token:T,symbol:'SAME',decimals:6,amountRaw:'1000000',from:A,to:B,time},{id:'two',type:'transfer',token:U,symbol:'SAME',decimals:18,amountRaw:'2000000000000000000',from:A,to:B,time}],wallets:[{address:A}]});
 const result=await createIndexer({store,io:{},now:()=>NOW}).radar({period:'1h'}),flows=result.wallets[0].netFlow;
 assert.equal(flows.length,2);assert.deepEqual(flows.map(f=>[f.chainId,f.address,f.decimals,f.amount]),[[1,T,6,'-1'],[1,U,18,'-2']]);
});

test('token omissions are tracked by address/PoolId without certifying the affected P&L',async()=>{
 const f=historyFixture(),otherKey={...key,currency0:U},other={...f.pool,address:U,key:otherKey,poolId:poolId(otherKey)};
 f.logs.push({...f.logs[0],transactionHash:'0x'+'bb'.repeat(32),blockNumber:hex(307),data:'0x00'});
 await f.refresh([f.pool,other]);
 const coverage=f.store.get('radar.index').assetCoverage;
 assert.equal(coverage[assetCoverageKey(T,ID)].hasOmissions,true);assert.equal(coverage[assetCoverageKey(U,other.poolId)].hasOmissions,false);
 assert.equal(coverage[assetCoverageKey(U,other.poolId)].completeHistory,true);
 const d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.completeHistory,false);assert.equal(d.traders[0].pnl.realized,null);assert.equal(d.candles.length,0);
});
for(const kind of ['event quota','timestamp quota','retention','storage quota'])test(`${kind} cannot leave a token's opening inventory certified`,async()=>{
 const f=historyFixture();
 if(kind==='event quota'||kind==='timestamp quota'){
  const count=kind==='event quota'?1001:110;
  for(let i=0;i<count;i++)f.logs.push({...f.logs.find(l=>l.address===T),transactionHash:'0x'+BigInt(100000+i).toString(16).padStart(64,'0'),blockNumber:hex(kind==='event quota'?308:121+i)});
 }else{
  await f.refresh([f.pool]);
  if(kind==='retention')f.setClock(NOW+(quota.retentionDays+1)*86400000);
  else{const s=f.store.get('radar.index');for(let i=0;i<quota.maxEvents;i++)s.events.push({id:'retained-'+i,token:T,type:'transfer',block:130,time:NOW/1000,from:A,to:B,amountRaw:'1',decimals:18});f.store.set('radar.index',s);}
 }
 await f.refresh([f.pool]);const c=f.store.get('radar.index').assetCoverage[assetCoverageKey(T,ID)];assert.equal(c.hasOmissions,true);assert.equal(c.completeHistory,false);
});
test('absent or conflicting flow decimals remain unavailable instead of assuming 18',async()=>{
 const store=memory(),time=NOW/1000-20;
 const row={type:'transfer',token:T,symbol:'SIX',amountRaw:'1000000',amount:'1',from:A,to:B,time};
 for(const events of [[row],[{...row,decimals:6},{...row,decimals:18}]]){
  store.set('radar.snapshot',{chainId:1,updatedAt:new Date(NOW).toISOString(),coverage:{missingHistory:true,fromTime:time-1},events,wallets:[{address:A}]});
  const result=await createIndexer({store,io:{},now:()=>NOW}).radar({period:'1h'});assert.equal(result.wallets[0].netFlow[0].amount,null);assert.equal(result.wallets[0].netFlow[0].address,T);
 }
});
test('SQLite restart resumes the token backfill and preserves its own coverage proof',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'unlk-history-regression-')),file=join(dir,'history.sqlite');let store=createStore(file);
 try{
  let f=historyFixture({head:4000,store});await f.refresh([],300);await f.refresh([f.pool]);assert.equal(store.get('radar.index').assetCoverage[assetCoverageKey(T,ID)].toBlock,1919);
  store.close();store=createStore(file);f=historyFixture({head:4000,store});await f.refresh([f.pool]);assert.equal(Number(BigInt(f.ranges[0].fromBlock)),1908);
  await f.refresh([f.pool]);const d=await f.detail.detail(T,new URLSearchParams('view=Traders'));assert.equal(d.coverage.completeHistory,true);assert.equal(d.traders[0].pnl.realized,14);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('owner outage blocks profile submission, moderation, quote and pre-payment recheck',async()=>{
 const store=createStore(':memory:'),identity=identityFixture(),f=historyFixture();identity.setOwner(A);
 const profiles=createProfiles({store,identities:identity.resolver,io:{rpc:async()=> '0x'},marketServices:{markets:async()=>({markets:[f.market],block:310})},owner:B,now:()=>NOW});
 const content={address:T,kind:'profile',description:'Isolated regression content, never published.',website:'https://example.org'};
 try{
  const submission=await profiles.submit(A,content);identity.setError(Error('RPC timeout'));
  await assert.rejects(profiles.submit(A,content),/owner could not be verified/);await assert.rejects(profiles.moderate(B,submission.id,'approved'),/owner could not be verified/);
  identity.setError(null);await profiles.moderate(B,submission.id,'approved');profiles.configure(B,{kind:'profile',amountRaw:'1',durationSeconds:3600,refundPolicy:'Isolated test-only refund policy.'});const q=await profiles.quote(A,submission.id);
  identity.setError(Error('RPC timeout'));await assert.rejects(profiles.quote(A,submission.id),/owner could not be verified/);await assert.rejects(profiles.recheck(q.id,A),/owner could not be verified/);assert.equal(profiles.order(q.id,A).status,'quoted');
 }finally{store.close();}
});
test('an earlier new-asset backfill preserves another pool range while recording retention omissions',async()=>{
 const f=historyFixture({head:4000}),otherKey={...key,currency0:U},other={...f.pool,address:U,key:otherKey,poolId:poolId(otherKey),deploymentBlock:3000};
 await f.refresh([],3100);const state=f.store.get('radar.index'),id=assetCoverageKey(U,other.poolId);
 state.assetCoverage={[id]:{chainId:1,address:U,poolId:other.poolId,deploymentBlock:3000,fromBlock:3000,toBlock:3100,completeHistory:true,hasOmissions:false}};
 state.events.push({id:'expired-other',token:U,type:'transfer',block:3000,time:NOW/1000-8*86400,from:A,to:B,amountRaw:'1',decimals:18});f.store.set('radar.index',state);
 await f.refresh([f.pool,other]);const c=f.store.get('radar.index').assetCoverage[id];assert.equal(c.fromBlock,3000);assert.equal(c.toBlock,3100);assert.equal(c.hasOmissions,true);assert.equal(c.completeHistory,false);
});

test('production export renders partial attribution and recovered P&L on mobile and desktop', {skip:!process.env.IMD_PLAYWRIGHT},async t=>{
 const {createServer}=await import('node:http'),fs=await import('node:fs/promises'),path=await import('node:path'),{fileURLToPath}=await import('node:url');
 const {chromium,webkit}=await import(process.env.IMD_PLAYWRIGHT),root=fileURLToPath(new URL('../../',import.meta.url)),out=await fs.mkdtemp(join(tmpdir(),'unlk-attribution-browser-'));
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local');if(!url.pathname.startsWith('/preview/'))throw Error('path');
  const rel=decodeURIComponent(url.pathname.slice(9))||'index.html',file=path.resolve(root,'dist',rel);
  if(!file.startsWith(path.join(root,'dist')+path.sep))throw Error('path');
  const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/preview/`;
 try{
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
   let browser;try{browser=await engine.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]});}catch(e){if(name==='chromium')throw e;t.diagnostic(`WebKit unavailable: ${e.message.slice(0,500)}`);continue;}
   try{
    for(const width of [390,1440]){
     const f=historyFixture({crowded:true}),errors=[],missing=[];f.market.name='TEST FIXTURE attribution';await f.refresh([],300);await f.refresh([f.pool]);
     const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
     page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)missing.push(r.url());});
     await page.addInitScript(({now})=>{Date.now=()=>now;},{now:NOW});
     await page.route(base+'labs-config.json',r=>r.fulfill({json:{apiBase:'https://attribution-fixture.invalid/api'}}));
     await page.route('https://attribution-fixture.invalid/api/**',async route=>{
      const url=new URL(route.request().url());let result={};
      if(url.pathname.endsWith('/health'))result={ok:true,chainId:1};
      else if(url.pathname.endsWith('/markets'))result={mode:'cached',chainId:1,block:310,markets:[f.market],coverage:{notes:['TEST FIXTURE ONLY']},errors:[]};
      else if(url.pathname.includes('/tokens/'))result=await f.detail.detail(T,url.searchParams);
      await route.fulfill({json:result});
     });
     // No external reads or signatures are needed to render this isolated fixture.
     await page.route('https://ethereum-rpc.publicnode.com/**',r=>r.abort());
     await page.goto(base+'#labs-token-'+T);await page.getByRole('button',{name:'Traders',exact:true}).click();
     const row=page.locator('.detail-table tbody tr').filter({has:page.locator(`a[href="https://etherscan.io/address/${A}"]`)});
     await row.getByText(/partial ·/).waitFor();assert.deepEqual(await row.locator('td').allTextContents(),['1 / 1','Unavailable','Unavailable','partial · Partial coverage or missing cost basis. P&L is unavailable without complete opening inventory; fees may be incomplete.']);
     await page.getByLabel('Timeframe',{exact:true}).selectOption('1m');await page.locator('.candlestick-chart').waitFor();
     const candles=await f.detail.detail(T,new URLSearchParams('timeframe=1m'));
     assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true);
     await row.scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${name}-partial-${width}.png`)});
     if(width===390){await row.locator('td').last().evaluate(e=>e.closest('.market-table-scroll').scrollLeft=e.offsetLeft-150);await page.screenshot({path:join(out,`${name}-partial-pnl-${width}.png`)});}
     await page.getByText('Coverage and excluded infrastructure',{exact:true}).click();await page.getByText(/Wallet attribution is incomplete: 2 pending/).waitFor();
     await f.refresh([f.pool]);await page.getByRole('button',{name:'Swaps',exact:true}).click();await page.getByRole('button',{name:'Traders',exact:true}).click();
     await row.getByText(/supported ·/).waitFor();assert.deepEqual(await row.locator('td').allTextContents(),['2 / 2','$14.00','$12.00','supported · FIFO evidenced swaps; network gas excluded.']);
     const recovered=await f.detail.detail(T,new URLSearchParams('timeframe=1m'));assert.deepEqual(recovered.candles,candles.candles);
     await row.scrollIntoViewIfNeeded();await page.screenshot({path:join(out,`${name}-recovered-${width}.png`)});
     assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);await page.close();t.diagnostic(`${name} ${width}: partial → supported $14/$12; candles unchanged; no page overflow or local-resource errors`);
    }
   }finally{await browser.close();}
  }
 }finally{await new Promise(r=>server.close(r));t.diagnostic(`Fixture screenshots: ${out}`);}
});
