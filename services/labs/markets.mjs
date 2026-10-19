/** UNLOCK LABS public market cache. No keys, custody or paid providers. */
import { encodeAbiParameters, keccak256, parseAbi } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { createIndexer } from './indexer.mjs';
import { deploymentStart } from './ownership.mjs';
import { createHistoryQueue } from './history-queue.mjs';
import { eligibility } from '../../web/src/labs/domain.mjs';
import { createLiquidityVerifier } from './liquidity.mjs';
import { automaticSell } from './simulation.mjs';
import { createRpc, resumableWork } from './rpc.mjs';
import { createCatalog, seedCatalog, SEEDS } from './catalog.mjs';
import { PINNED_PICKS, EDITORIAL_IDENTITIES } from './identities.mjs';
import { historicalReferences } from './references.mjs';
import { createMediaCache } from './media.mjs';

export const IMD = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';
export const UNLK = '0x99fa82b022be4575891a43b757bc770691e18fda';
export const POOL_MANAGER = '0x000000000004444c5dc75cb358380d2e3de08a90';
export const NATIVE = '0x0000000000000000000000000000000000000000';
export const PUBLIC_RPC = 'https://ethereum-rpc.publicnode.com';
export const IMD_ETH_POOL = '0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3';
export const UNLK_POOL = '0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32';
const ETH_USD = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
const API = 'https://api.imd.fun';
const ERC20 = parseAbi(['function symbol() view returns (string)','function name() view returns (string)','function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)']);
const STATE_VIEW='0x7ffe42c4a5deea5b0fec41c94c136cf115597227';
const LIQUIDITY_ABI=parseAbi(['function getLiquidity(bytes32) view returns (uint128)']);
const MANAGER = parseAbi(['function extsload(bytes32) view returns (bytes32)']);
const FEED = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)','function decimals() view returns (uint8)']);
export const quota = Object.freeze({registryPages:3,registryPageSize:100,registryRefreshSeconds:3600,marketTokens:12,marketRefreshSeconds:60,indexRefreshSeconds:300,rpcRequestsPerRefresh:600,logPageBlocks:500,maxBlocksPerRefresh:1800,confirmations:12,watchWallets:10,candidateWallets:24,retentionDays:7,maxEvents:10000,eventPageSize:100,dexRequestsPerRefresh:1,retries:2});
export const address = v => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
const finite = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const text = (v,max=80) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max) : '';
export const hex = v => `0x${BigInt(v).toString(16)}`;
export function poolId(key) {
  if (!key || !address(key.currency0) || !address(key.currency1) || !address(key.hooks) || !Number.isInteger(key.fee) || key.fee<0 || key.fee>0xffffff || !Number.isInteger(key.tickSpacing) || key.tickSpacing<=0 || key.tickSpacing>32767 || key.currency0.toLowerCase() >= key.currency1.toLowerCase()) throw new Error('Invalid registry PoolKey');
  return keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[key.currency0,key.currency1,key.fee,key.tickSpacing,key.hooks]));
}
export function poolSlot(id) { return keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[id,6n])); }
export function decodeSlot(word) {
  const w=BigInt(word); let tick=Number((w>>160n)&0xffffffn); if(tick>=0x800000) tick-=0x1000000;
  return {sqrtPriceX96:w&((1n<<160n)-1n),tick,lpFee:Number((w>>208n)&0xffffffn)};
}
export const IMD_KEY = {currency0:NATIVE,currency1:IMD,fee:10000,tickSpacing:200,hooks:NATIVE};
const UNLK_KEY = {currency0:UNLK,currency1:IMD,fee:12500,tickSpacing:60,hooks:'0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc'};

export { createRpc };

export function selectLaunches(rows,max=Infinity) {
  const found=new Map();
  for(const launch of rows) {
    if(launch.chainId!==1||launch.status!=='live') continue;
    const token=launch.artifacts?.find(a=>a.role==='token'&&address(a.address));if(!token)continue;
    const tokenAddress=address(token.address);
    // This supplied IMUSD identity is accepted only by exact Ethereum address.
    if(/\bimusd\b/i.test(token.name||'') && tokenAddress !== '0x61aaf8a992a3143e2b0c9cb0030b9fe702854a25') continue;
    const key=launch.seeded?.pools?.find(k=>(address(k.currency0)===tokenAddress||address(k.currency1)===tokenAddress)&&[IMD,NATIVE].includes(address(k.currency0)===tokenAddress?address(k.currency1):address(k.currency0)));
    if(!key)continue;
    try{found.set(tokenAddress,{address:tokenAddress,launchNumber:launch.launchNumber,launchId:launch.id,createdAt:launch.createdAt,sourceCommit:launch.sourceCommit,deploymentBlock:token.blockNumber,deploymentTx:token.txHash,logoSource:launch.logo?.link||null,name:text(token.name),projectUrl:`https://explorer.imd.fun/launch/${encodeURIComponent(launch.id)}`,sourceUrl:`${API}/launches/${encodeURIComponent(launch.id)}`,repoUrl:typeof launch.sourceRepoUrl==='string'&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(launch.sourceRepoUrl)?launch.sourceRepoUrl:null,key,poolId:poolId(key)});}catch{/* reject malformed registry pools */}
    if(found.size>=max && found.has(UNLK))break;
  }
  const newest=[...found.values()].sort((a,b)=>b.launchNumber-a.launchNumber).slice(0,max);
  const unlk=found.get(UNLK);if(unlk&&!newest.some(t=>t.address===UNLK)){newest.pop();newest.push(unlk);}
  return newest;
}

export function verifiedDexPair(pairs,token) {
  return (Array.isArray(pairs)?pairs:[]).filter(p=>p.chainId==='ethereum'&&p.dexId==='uniswap'&&p.pairAddress?.toLowerCase()===token.poolId.toLowerCase()&&address(p.baseToken?.address)===token.address&&address(p.quoteToken?.address)===(token.key.currency0.toLowerCase()===token.address?token.key.currency1.toLowerCase():token.key.currency0.toLowerCase())).sort((a,b)=>(finite(b.liquidity?.usd)||0)-(finite(a.liquidity?.usd)||0))[0]||null;
}

export function mapDex(pair) {
  // Provider-reported market cap is explicitly labeled; never substitute FDV or total supply.
  return {priceUsd:finite(pair?.priceUsd),priceChange24h:finite(pair?.priceChange?.h24),volume24h:finite(pair?.volume?.h24),liquidityUsd:finite(pair?.liquidity?.usd),fdv:finite(pair?.fdv),marketCap:finite(pair?.marketCap),marketCapEvidence:finite(pair?.marketCap)>0?'DEX Screener provider-reported market cap; circulating supply not independently verified':null};
}

export function createMarketServices({store,rpcUrl=PUBLIC_RPC,fetchImpl=fetch,now=()=>Date.now(),simulationPlans={},editorialSelections={},extraLaunchIds=[],poolStartBlocks=Object.fromEntries((SEEDS.poolEvidence||[]).filter(p=>p.block).map(p=>[p.poolId,p.block])),indexStartBlock=null}={}) {
  const memory=new Map();const cache=store||{get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
  seedCatalog(cache);
  const pickFor=token=>PINNED_PICKS[token]||Object.entries(editorialSelections).map(([symbol,selected])=>EDITORIAL_IDENTITIES.records.find(r=>r.chainId===1&&r.symbol===symbol&&r.address===selected&&r.address===token)).filter(Boolean).map(r=>({label:'UNLOCK Pick',sourceUrl:r.sourceUrl,basis:'Operator-selected exact identity; common listing gate still required'}))[0]||null;
  const io=createRpc({url:rpcUrl,fetchImpl,cooldownStore:cache}); let inFlight=null,lastAttempt=0;
  const historyIo=createRpc({url:rpcUrl,fetchImpl,budget:600,cooldownStore:cache});const historyReferences=historicalReferences(historyIo,cache);const history=createHistoryQueue({store:cache,io:historyIo,now,indexStartBlock});const indexer=createIndexer({store:cache,io:historyIo,now,historyStartBlock:indexStartBlock});
  const verifyLiquidity=createLiquidityVerifier({store:cache,io,now});
  const media=createMediaCache({store:cache,fetchImpl,now});
  const discover=createCatalog({store:cache,io,extraLaunchIds,now});
  async function refresh() {
    if(inFlight)return inFlight;
    if(lastAttempt&&now()-lastAttempt<quota.marketRefreshSeconds*1000)return markets();
    lastAttempt=now();io.reset();
    inFlight=(async()=>{
      const errors=[];
      try {
        if(BigInt(await io.rpc('eth_chainId'))!==1n)throw Error('RPC is not Ethereum mainnet');
        const head=BigInt(await io.rpc('eth_blockNumber'));const block=head-BigInt(quota.confirmations);const blockTag=hex(block);
        const blockData=await io.rpc('eth_getBlockByNumber',[blockTag,false]);const observedAt=new Date(Number(BigInt(blockData.timestamp))*1000).toISOString();if(now()-Date.parse(observedAt)>600000||Date.parse(observedAt)>now()+30000)throw Error('Confirmed market block is stale or from the future');
        try{await deploymentStart(io,cache,IMD,block);}catch(e){errors.push(`IMD deployment discovery: ${e.message}`);}
        let registry;try{registry=await discover(errors);}catch(e){registry=cache.get('markets.registry');if(!registry)throw e;errors.push(`Registry stale: ${e.message}`);}
        const featuredToken={address:IMD,symbol:'IMD',name:'Identity.md',logoSource:'https://imd.fun/icon.svg',launchId:null,launchNumber:null,createdAt:null,key:IMD_KEY,poolId:IMD_ETH_POOL,projectUrl:'https://imd.fun',sourceUrl:'https://imd.fun/docs/'};
        const catalog=[{...featuredToken,deploymentBlock:poolStartBlocks[IMD_ETH_POOL]||cache.get('deployment:'+IMD)?.block},...registry.tokens];const work=resumableWork(cache,'markets',catalog,quota.marketTokens),tokens=work.items;const previousSnapshot=cache.get('markets.snapshot'),previousRows=[previousSnapshot?.featured,...(previousSnapshot?.markets||[])].filter(Boolean);const tokenRows=previousRows.filter(t=>!tokens.some(n=>n.address===t.address));
        let imdUsd=null,ethUsd=null;
        try {
          const [round,feedDecimals,word,activeReference]=await Promise.all([io.read(ETH_USD,FEED,'latestRoundData',[],blockTag),io.read(ETH_USD,FEED,'decimals',[],blockTag),io.read(POOL_MANAGER,MANAGER,'extsload',[poolSlot(IMD_ETH_POOL)],blockTag),io.read(STATE_VIEW,LIQUIDITY_ABI,'getLiquidity',[IMD_ETH_POOL],blockTag)]);
          const timestamp=BigInt(blockData.timestamp),state=decodeSlot(word);
          if(Number(feedDecimals)!==8||round[0]===0n||round[1]<=0n||round[4]<round[0]||round[3]>timestamp||timestamp-round[3]>5400n||state.sqrtPriceX96===0n||state.lpFee!==10000||activeReference<=0n)throw Error('IMD/ETH spot or Chainlink ETH/USD failed freshness/identity checks');
          ethUsd=Number(round[1])/1e8;imdUsd=ethUsd/(Number(state.sqrtPriceX96)/2**96)**2;
        }catch(e){errors.push(`USD fallback unavailable: ${e.message}`);}
        let dexPairs=[];try{dexPairs=await io.json(`https://api.dexscreener.com/tokens/v1/ethereum/${tokens.map(t=>t.address).join(',')}`);}catch(e){errors.push(`DEX Screener unavailable: ${e.message}`);}
        for(const token of tokens) {
          // Budget exhausted: unstarted assets keep their prior row and the durable cursor stays on the first unfinished asset.
          if(io.exhausted){const prior=previousRows.find(t=>t.address===token.address);if(prior)tokenRows.push(prior);continue;}
          let record={...token,key:token.key,chainId:1,symbol:token.symbol||null,decimals:null,totalSupply:null,priceUsd:null,priceChange24h:null,volume24h:null,liquidityUsd:null,fdv:null,marketCap:null,chart:[],chartCurrency:'USD',observedAt,source:'Ethereum RPC',status:'unavailable',poolUrl:token.poolId?`https://app.uniswap.org/explore/pools/ethereum/${token.poolId}`:null,chartUrl:token.poolId?`https://dexscreener.com/ethereum/${token.poolId}`:null,verified:false,identity:{verified:false,sourceUrl:token.sourceUrl},pool:{id:token.poolId,dex:'uniswap',version:'v4',verified:false,quoteSymbol:token.address===IMD?'ETH':token.key?.currency0.toLowerCase()===IMD||token.key?.currency1.toLowerCase()===IMD?'IMD':'ETH'}};
          try {
            if(token.unsupportedPool||!token.key)throw Object.assign(Error('Unsupported or unverified registry pool; liquidity is unknown, not zero'),{category:'unsupported pool'});
            if(!record.deploymentBlock){const meta=cache.get(`launchmeta:${token.launchId}`);if(meta){const a=meta.artifacts?.find(a=>a.role==='token'&&address(a.address)===token.address);record.deploymentBlock=a?.blockNumber;record.logoSource=meta.logo?.link;}else if(token.launchId){try{const d=await io.json(`${API}/launches/${token.launchId}`),l=d.launch||d;cache.set(`launchmeta:${token.launchId}`,l);record.logoSource=l.logo?.link;}catch(e){errors.push(`Metadata ${token.address}: ${e.message}`);}}}
            const [code,decimals,symbol,chainName,supply,word]=await Promise.all([io.rpc('eth_getCode',[token.address,blockTag]),io.read(token.address,ERC20,'decimals',[],blockTag),io.read(token.address,ERC20,'symbol',[],blockTag),io.read(token.address,ERC20,'name',[],blockTag),io.read(token.address,ERC20,'totalSupply',[],blockTag),io.read(POOL_MANAGER,MANAGER,'extsload',[poolSlot(token.poolId)],blockTag)]);
            const state=decodeSlot(word);if(code==='0x'||Number(decimals)>30||state.sqrtPriceX96===0n||state.lpFee!==token.key.fee)throw Error('Token code or registry PoolKey state verification failed');
            const counterpart=token.key.currency0.toLowerCase()===token.address?token.key.currency1.toLowerCase():token.key.currency0.toLowerCase();
            const ratio=(Number(state.sqrtPriceX96)/2**96)**2;const tokenIs0=token.key.currency0.toLowerCase()===token.address;
            // All supported quote currencies (IMD/native ETH) have 18 decimals.
            const quotePerToken=tokenIs0?ratio*10**(Number(decimals)-18):(1/ratio)*10**(Number(decimals)-18);
            const quoteUsd=counterpart===IMD?imdUsd:counterpart===NATIVE?ethUsd:null;
            const onchainPrice=quoteUsd===null?null:quotePerToken*quoteUsd;
            const dex=verifiedDexPair(dexPairs,token);const values=mapDex(dex);
            record={...record,decimals:Number(decimals),symbol:text(symbol,24),name:text(chainName,80),totalSupply:supply.toString(),priceUsd:Number.isFinite(onchainPrice)&&onchainPrice>0?onchainPrice:null,fdv:onchainPrice===null?null:onchainPrice*Number(supply)/10**Number(decimals),status:'available',verified:true,activeLiquidity:null,source:'Ethereum v4 spot + Chainlink ETH/USD',sqrtPriceX96:state.sqrtPriceX96.toString(),poolTick:state.tick};
            if(dex&&values.priceUsd!==null)record={...record,marketCap:values.marketCap,marketCapEvidence:values.marketCapEvidence,marketCapSource:{url:`https://api.dexscreener.com/tokens/v1/ethereum/${token.address}`,poolId:token.poolId,reportedAt:new Date(now()).toISOString(),kind:'provider-reported'},priceChange1h:finite(dex.priceChange?.h1),priceChange24h:values.priceChange24h,priceChange7d:null,volume24h:values.volume24h,liquidityUsd:null,source:'Ethereum v4 spot + Chainlink; DEX Screener changes/volume for exact PoolId',dexUpdatedAt:new Date(now()).toISOString()};
            record.identity={verified:true,sourceUrl:token.sourceUrl,launchId:token.launchId};record.pool={...record.pool,verified:true};
            record.pick=pickFor(token.address);
            try { const prices={ [NATIVE]:ethUsd,[IMD]:imdUsd,[token.address]:record.priceUsd };record.liquidityCheck=await verifyLiquidity({...record,deploymentBlock:poolStartBlocks[token.poolId]??record.deploymentBlock},block,prices,blockData);record.liquidityUsd=record.liquidityCheck.usd; }catch(e){record.liquidityError=text(e.message,220);}
            try {record.sellCheck=await automaticSell({io,store:cache,token:record,plan:simulationPlans[token.address],block,blockData,now:now()});}catch(e){record.simulationError=text(e.message,220);}
            record.listedAt=cache.get(`listed:${token.address}`)||null;
            if(eligibility(record,now(),Number(block)).eligible&&!record.listedAt){record.listedAt=new Date(now()).toISOString();cache.set(`listed:${token.address}`,record.listedAt);}
            if(record.liquidityCheck?.initializedBlock){const launchBlock=record.liquidityCheck.initializedBlock;let launchTime=cache.get(`launchTime:${token.address}`);if(!launchTime){const b=await io.rpc('eth_getBlockByNumber',[hex(launchBlock),false]);launchTime=new Date(Number(BigInt(b.timestamp))*1000).toISOString();cache.set(`launchTime:${token.address}`,launchTime);}record.launchedAt=launchTime;}
            if(record.logoSource){try{record.logo=await media.cacheLogo(record,record.logoSource);}catch(e){record.logoError=e.message;}}
            // Only observed points are plotted. No fabricated candles or carry-forward history.
            const old=cache.get('markets.snapshot');const previous=old?.featured?.address===token.address?old.featured:old?.markets?.find(t=>t.address===token.address);
            record.chart=(previous?.chart||[]).filter(p=>p.time>=now()/1000-7*86400).slice(-119);
            if(record.priceUsd!==null)record.chart.push({time:Number(BigInt(blockData.timestamp)),price:record.priceUsd});
            record.sparkline=record.chart.map(p=>p.price);
          }catch(e){record.unavailableReason=text(e.message,180);record.failureCategory=e.category||(/quota|RPC|Provider|fetch|timeout/i.test(e.message)?'provider':'indexing');}
          tokenRows.push(record);if(!io.exhausted)work.done(token);
        }
        const snapshot={version:1,mode:'cached',chainId:1,updatedAt:new Date(now()).toISOString(),block:Number(block),blockTime:observedAt,featured:tokenRows.find(t=>t.address===IMD)||null,markets:tokenRows.filter(t=>t.address!==IMD),coverage:{registryPages:registry.pages,catalogSize:catalog.length,registryComplete:registry.complete,registryCursor:registry.before,cycle:cache.get('queue:markets'),registryReadAt:new Date(registry.readAt).toISOString(),source:`${API}/launches`,rpcSource:io.providers,provenance:io.provenance,notes:['Ethereum catalog walks registry pages with a persistent cursor. Catalog size is independent of per-cycle work. Unchecked or expired rows remain excluded.','All rows, editorial picks and placements pass the same current USD-liquidity and full-route sell gate. Unresolved identities remain unpublished.','Onchain fallback supplies spot/FDV only; unavailable DEX volume, change and USD liquidity remain unavailable.','FDV uses onchain total supply or provider FDV. Circulating supply is unverified. Available market cap is explicitly provider-reported, with exact pool and source provenance; it is never FDV.','Sparklines contain observed USD points only. OHLCV uses indexed swaps and event-block USD references. Liquidity is per-position principal, active liquidity is reconciled to StateView; shared PoolManager balances and FDV are never liquidity.']},quotas:quota,errors};
        cache.set('markets.snapshot',snapshot);
        return snapshot;
      }catch(e){const old=cache.get('markets.snapshot');if(old){const stale={...old,eligibilityUnknown:true,errors:[...old.errors,`Refresh failed: ${text(e.message,180)}`].slice(-4)};cache.set('markets.snapshot',stale);return stale;}const failure={version:2,mode:'warming',chainId:1,eligibilityUnknown:true,updatedAt:null,featured:null,markets:[],coverage:{notes:['Data cache is warming. Provider data is unavailable until the first successful refresh.']},errors:[text(e.message,180)],quotas:quota};cache.set('markets.snapshot',failure);return failure;}
    })().finally(()=>{inFlight=null;});return inFlight;
  }
  async function markets() {
    const value=cache.get('markets.snapshot');
    if(!value)return {version:2,mode:'warming',chainId:1,updatedAt:null,featured:null,markets:[],excluded:[],coverage:{notes:['No current verified listings until indexing and sell simulations succeed.']},quotas:quota,errors:[]};
    const observed=[...(value.markets||[]),...(value.featured?[value.featured]:[])];const catalog=cache.get('markets.registry')?.tokens||seedCatalog(cache);const rows=[...observed,...catalog.filter(t=>!observed.some(m=>m.address===t.address)).map(t=>({...t,chainId:1,failureCategory:t.unsupportedPool?'unsupported pool':'indexing',unavailableReason:'Queued for current identity, liquidity and seller checks'}))],admitted=value.eligibilityUnknown?[]:rows.filter(m=>eligibility(m,now(),value.block??null).eligible).map(m=>({...m,pick:pickFor(m.address)}));
    return {...value,featured:null,markets:admitted,excluded:rows.filter(m=>value.eligibilityUnknown||!eligibility(m,now(),value.block??null).eligible).map(m=>({address:m.address,name:m.name,symbol:m.symbol,categories:exclusionCategories(m),progress:{liquidity:cache.get(`liquidity:${m.poolId}`)?.lastBlock||null,head:value.block},checkedAt:m.sellCheck?.checkedAt||m.liquidityCheck?.checkedAt||null,reasons:[...(value.eligibilityUnknown?['Latest refresh failed; current eligibility is unknown.']:[]),...eligibility(m,now(),value.block??null).reasons,...[m.unavailableReason,m.liquidityError,m.simulationError].filter(Boolean)]})),stale:now()-Date.parse(value.updatedAt)>600000};
  }
  return {markets,radar:indexer.radar,refresh,refreshHistory:async()=>{historyIo.reset();historyReferences.reset();if(BigInt(await historyIo.rpc('eth_chainId'))!==1n)throw Error('History RPC is not Ethereum');const block=BigInt(await historyIo.rpc('eth_blockNumber'))-12n,blockData=await historyIo.rpc('eth_getBlockByNumber',[hex(block),false]);const s=cache.get('markets.snapshot');const known=[s?.featured,...(s?.markets||[])].filter(t=>t?.verified);const pools=[{address:IMD,symbol:'IMD',decimals:18,key:IMD_KEY,poolId:IMD_ETH_POOL,deploymentBlock:poolStartBlocks[IMD_ETH_POOL]||cache.get('deployment:'+IMD)?.block},...known.filter(t=>t.address!==IMD),...(cache.get('markets.registry')?.tokens||seedCatalog(cache)).filter(t=>t.key&&!known.some(k=>k.address===t.address))];return history.refresh({pools,block,blockData,quoteUsdAt:historyReferences.at});},quota,rawToken:address=>{const d=cache.get('markets.snapshot');return [d?.featured,...(d?.markets||[])].find(t=>t?.address===address)||null;},io,media};
}

export function exclusionCategories(m){const c=new Set();if(m.failureCategory)c.add(m.failureCategory);if(m.unsupportedPool)c.add('unsupported pool');if(m.priceUsd==null)c.add('pricing');if(m.liquidityError)c.add(/warming|history|start block/i.test(m.liquidityError)?'indexing':/RPC|quota|provider|timeout/i.test(m.liquidityError)?'provider':'liquidity');if(m.liquidityCheck?.usd<20000)c.add('liquidity');if(m.simulationError)c.add(/RPC|provider|quota reached|timeout/i.test(m.simulationError)?'provider':'seller');if(!m.verified)c.add('indexing');return [...c];}
export { ERC20 };
