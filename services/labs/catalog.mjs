import {readFileSync} from 'node:fs';
import {takeWork} from './rpc.mjs';
import {selectLaunches,UNLK} from './markets.mjs';
export const SEEDS=JSON.parse(readFileSync(new URL('./production-seeds.json',import.meta.url),'utf8'));
const API='https://api.imd.fun';
export function seedCatalog(store){for(const r of SEEDS.chainEvidence||[])if(r.deployment)store.set(`deployment:${r.address}`,r.deployment);for(const l of SEEDS.records){store.set(`launchmeta:${l.id}`,l);store.set(`identity:${l.id}`,{at:Date.now(),data:l});}return [...selectLaunches(SEEDS.records),{address:'0x61aaf8a992a3143e2b0c9cb0030b9fe702854a25',name:'imdUSD',symbol:'imdUSD',chainId:1,unsupportedPool:true,key:null,poolId:null,deploymentBlock:26166419,sourceUrl:'https://etherscan.io/token/0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25',unavailableReason:'Supplied exact identity is verified onchain; no authoritative supported Uniswap PoolKey resolved.'}];}
export function createCatalog({store,io,extraLaunchIds=[],now=()=>Date.now(),pagesPerCycle=3}){
 return async function discover(errors=[]){
  const saved=store.get('markets.registry');const old={before:null,pages:0,complete:false,readAt:0,...saved,tokens:[...new Map([...seedCatalog(store),...(saved?.tokens||[])].map(t=>[t.address,t])).values()]};
  // Legacy caches discarded most entries before their cursor. Rewalk instead of
  // trusting that cursor as proof that the missing catalog was retained.
  if(saved?.version!==2){old.before=null;old.pages=0;old.complete=false;old.completedAt=null;}
  const byAddress=new Map(old.tokens.map(t=>[t.address,t]));let before=old.before,pages=old.pages,complete=old.complete;let completedAt=old.completedAt||null;if(complete&&completedAt&&now()-completedAt>3600000){complete=false;before=null;}
  // Incremental historical walk; once complete, poll page one for new launches.
  const polling=complete;const scan=polling?1:pagesPerCycle;if(polling)before=null;
  for(let p=0;p<scan;p++){
   try{const data=await io.json(`${API}/launches?limit=100${before?`&before=${before}`:''}`);if(!Array.isArray(data.launches))throw Error('Malformed registry page');
    for(const t of selectLaunches(data.launches))byAddress.set(t.address,{...byAddress.get(t.address),...t,unsupportedPool:false});
    for(const l of data.launches.filter(l=>l.chainId===1&&l.status==='live')){
     const a=l.artifacts?.find(a=>a.role==='token'&&/^0x[\da-f]{40}$/i.test(a.address||''));if(a&&!byAddress.has(a.address.toLowerCase()))byAddress.set(a.address.toLowerCase(),{address:a.address.toLowerCase(),name:a.name,launchId:l.id,launchNumber:l.launchNumber,deploymentBlock:a.blockNumber,sourceUrl:`${API}/launches/${l.id}`,unsupportedPool:true,key:null,poolId:null});
    }
    const next=data.launches.at(-1)?.launchNumber;pages++;
    if(polling){complete=true;before=null;}else{complete=data.launches.length<100;if(!complete&&(!next||next===before))throw Error('Registry cursor did not advance');before=complete?null:next;if(complete)completedAt=now();}
    store.set('markets.registry',{version:2,tokens:[...byAddress.values()],before,pages,complete,completedAt,readAt:now(),source:API});if(complete)break;
   }catch(e){errors.push(`Registry recovery: ${e.message}`);break;}
  }
  // Every explicit identity is retained; never slice the combined catalog back to a work budget.
  const pending=extraLaunchIds.filter(id=>!store.get(`catalog-extra:${id}`));
  for(const id of takeWork(store,'extraLaunches',pending,4)){try{const d=await io.json(`${API}/launches/${id}`),l=d.launch||d;store.set(`launchmeta:${id}`,l);for(const t of selectLaunches([l]))byAddress.set(t.address,t);store.set(`catalog-extra:${id}`,true);}catch(e){errors.push(`Launch ${id}: ${e.message}`);}}
  if(!byAddress.has(UNLK))for(const t of seedCatalog(store))byAddress.set(t.address,t);
  const result={version:2,tokens:[...byAddress.values()],before,pages,complete,completedAt,readAt:now(),pendingExtra:pending.length,source:API};store.set('markets.registry',result);return result;
 };
}
