import {createIndexer} from './indexer.mjs';
import {parseAbi} from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import {takeWork} from './rpc.mjs';
/** Per-pool durable cursors prevent a slow/failed asset from blocking every history. */
export function createHistoryQueue({store,io,now=()=>Date.now(),indexStartBlock=null}){
 async function refresh({pools,block,blockData,quoteUsdAt}){
  const errors=[];
  for(const p of takeWork(store,'history',pools,1)){
   const scoped={get:k=>store.get(k.startsWith('radar.')?`history:${p.poolId}:${k}`:k),set:(k,v)=>store.set(k.startsWith('radar.')?`history:${p.poolId}:${k}`:k,v)};
   try{if(!Number.isInteger(p.decimals)){const abi=parseAbi(['function decimals() view returns(uint8)','function symbol() view returns(string)']);p.decimals=Number(await io.read(p.address,abi,'decimals',[],'0x'+block.toString(16)));p.symbol=await io.read(p.address,abi,'symbol',[],'0x'+block.toString(16));}await createIndexer({store:scoped,io,now,historyStartBlock:p.deploymentBlock||indexStartBlock}).refresh({pools:[p],block,blockData,quoteUsdAt});}
   catch(e){errors.push(`${p.address}: ${e.message}`);store.set(`history-error:${p.poolId}`,{error:e.message,provenance:io.provenance?.slice(-8),at:new Date(now()).toISOString()});}
   // A separate recent interval must never bridge an unindexed archive gap.
   const recentScope={get:k=>store.get(k.startsWith('radar.')?`recent-history:${p.poolId}:${k}`:k),set:(k,v)=>store.set(k.startsWith('radar.')?`recent-history:${p.poolId}:${k}`:k,v)};
   try{await createIndexer({store:recentScope,io,now,historyStartBlock:Math.max(p.deploymentBlock||0,Number(block)-99)}).refresh({pools:[{...p,deploymentBlock:Math.max(p.deploymentBlock||0,Number(block)-99)}],block,blockData,quoteUsdAt});}catch(e){errors.push(`Recent ${p.address}: ${e.message}`);}
  }
  const indices=pools.map(p=>store.get(`history:${p.poolId}:radar.index`)).filter(Boolean),snaps=pools.map(p=>store.get(`history:${p.poolId}:radar.snapshot`)).filter(Boolean);
  const recent=pools.map(p=>store.get(`recent-history:${p.poolId}:radar.index`)).filter(Boolean);
  const events=[...new Map([...indices,...recent].flatMap(s=>s.events).map(e=>[e.id,e])).values()].sort((a,b)=>b.block-a.block||b.logIndex-a.logIndex).slice(0,10000);
  const assetCoverage=Object.assign({},...indices.map(s=>s.assetCoverage));const coverage={fromBlock:snaps.length?Math.min(...snaps.map(s=>s.coverage.fromBlock)):null,toBlock:snaps.length?Math.max(...snaps.map(s=>s.coverage.toBlock)):null,fromTime:snaps.length?Math.min(...snaps.map(s=>s.coverage.fromTime)):null,toTime:snaps.length?Math.max(...snaps.map(s=>s.coverage.toTime)):null,missingHistory:true,headBlock:Number(block),recentIntervals:recent.flatMap(s=>Object.values(s.assetCoverage||{})),queue:store.get('queue:history'),notes:['Per-asset resumable history; each asset has independent coverage. Periods are clipped; no global completeness is inferred.','Candles use real swaps and event-block prices. Missing cost basis never becomes full profit.']};
  store.set('radar.index',{version:2,events,assetCoverage});store.set('radar.snapshot',{version:2,mode:'cached',chainId:1,period:'24h',updatedAt:new Date(now()).toISOString(),coverage,pools,events,wallets:[],errors,quotas:{eventPageSize:100}});
  return {coverage,errors};
 }
 return {refresh};
}
