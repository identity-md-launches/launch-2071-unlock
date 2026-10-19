/** UNLOCK LABS public market cache. No keys, custody or paid providers. */
import { encodeAbiParameters, decodeAbiParameters, keccak256, stringToHex, encodeFunctionData, decodeFunctionResult, parseAbi } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { createIndexer } from './indexer.mjs';
import { eligibility } from '../../web/src/labs/domain.mjs';
import { createLiquidityVerifier } from './liquidity.mjs';
import { simulateSell } from './simulation.mjs';
import { PINNED_PICKS } from './identities.mjs';
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
export const quota = Object.freeze({registryPages:3,registryPageSize:100,registryRefreshSeconds:3600,marketTokens:12,marketRefreshSeconds:300,indexRefreshSeconds:300,rpcRequestsPerRefresh:600,logPageBlocks:500,maxBlocksPerRefresh:1800,confirmations:12,watchWallets:10,candidateWallets:24,retentionDays:7,maxEvents:10000,eventPageSize:100,dexRequestsPerRefresh:1,retries:2});
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

export function createRpc({url=PUBLIC_RPC,fetchImpl=fetch,budget=quota.rpcRequestsPerRefresh}={}) {
  let used=0;
  async function json(url,options={},beforeAttempt) {
    let error;
    for(let attempt=0;attempt<=quota.retries;attempt++) {
      try {
        beforeAttempt?.();
        const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(12000)});
        if(!response.ok) {const e=new Error(`Provider returned HTTP ${response.status}`); e.retry=response.status===429||response.status>=500; throw e;}
        const body=await response.text(); if(body.length>3_000_000) throw Error('Provider response exceeds 3 MB'); return JSON.parse(body);
      } catch(e) {error=e;if(attempt===quota.retries||e.retry===false) break;await new Promise(r=>setTimeout(r,Math.min(1500,250*2**attempt)));}
    }
    throw Error(error?.message||'Provider unavailable');
  }
  async function rpc(method,params=[]) {
    const result=await json(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:used+1,method,params})},()=>{
      if(used>=budget){const e=Error('Bounded RPC request quota reached; next refresh resumes');e.retry=false;throw e;}used++;
    });
    if(result.error) throw Error(`RPC ${method}: ${text(result.error.message,160)}`);if(result.result===undefined) throw Error(`RPC ${method} returned no result`);return result.result;
  }
  async function read(contract,abi,fn,args=[],block='latest') {
    const data=await rpc('eth_call',[{to:contract,data:encodeFunctionData({abi,functionName:fn,args})},block]);
    return decodeFunctionResult({abi,functionName:fn,data});
  }
  return {rpc,read,json,get used(){return used;},reset(){used=0;}};
}

export function selectLaunches(rows,max=quota.marketTokens-1) {
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
  // DEX marketCap is deliberately omitted: circulating supply is not verified here.
  return {priceUsd:finite(pair?.priceUsd),priceChange24h:finite(pair?.priceChange?.h24),volume24h:finite(pair?.volume?.h24),liquidityUsd:finite(pair?.liquidity?.usd),fdv:finite(pair?.fdv),marketCap:null};
}

export function createMarketServices({store,rpcUrl=PUBLIC_RPC,fetchImpl=fetch,now=()=>Date.now(),simulationPlans={},extraLaunchIds=[],poolStartBlocks={},indexStartBlock=null}={}) {
  const memory=new Map();const cache=store||{get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
  const io=createRpc({url:rpcUrl,fetchImpl}); let inFlight=null,lastAttempt=0;
  const indexer=createIndexer({store:cache,io,now,historyStartBlock:indexStartBlock});
  const verifyLiquidity=createLiquidityVerifier({store:cache,io,now});
  const media=createMediaCache({store:cache,fetchImpl,now});
  const references=historicalReferences(io,cache);
  async function discover(errors) {
    const old=cache.get('markets.registry');if(old&&now()-old.readAt<quota.registryRefreshSeconds*1000)return old;
    const rows=[];let before=null,pages=0;
    for(let i=0;i<quota.registryPages;i++) {
      const data=await io.json(`${API}/launches?limit=${quota.registryPageSize}${before?`&before=${before}`:''}`);pages++;
      if(!Array.isArray(data.launches)) throw Error('IMD registry returned malformed launch list');rows.push(...data.launches);
      const oldest=data.launches.at(-1)?.launchNumber;if(data.launches.length<quota.registryPageSize||!oldest||oldest===before)break;before=oldest;
    }
    let tokens=selectLaunches(rows);
    if(!tokens.some(t=>t.address===UNLK)) {
      const d=await io.json(`${API}/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929`);
      const launch=d.launch||d;tokens=[...tokens.slice(0,quota.marketTokens-2),...selectLaunches([launch],1)];
    }
    for(const id of extraLaunchIds.slice(0,30)){if(!/^[a-f0-9-]{36}$/i.test(id))continue;try{const data=await io.json(`${API}/launches/${id}`);for(const t of selectLaunches([data.launch||data],1))if(!tokens.some(x=>x.address===t.address))tokens.push(t);}catch(e){errors.push(`Additional launch unavailable: ${id}`);}}
    // The accepted mainnet site pins this PoolKey. Keep official UNLK available during registry pagination gaps.
    if(!tokens.some(t=>t.address===UNLK)) {tokens.push({address:UNLK,name:'UNLOCK',launchNumber:2071,launchId:'0528a007-5ec6-4acd-b9cc-b3ded6fe2929',createdAt:null,sourceCommit:null,sourceUrl:`${API}/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929`,projectUrl:'https://explorer.imd.fun/launch/0528a007-5ec6-4acd-b9cc-b3ded6fe2929',deploymentBlock:26211921,key:UNLK_KEY,poolId:UNLK_POOL});errors.push('UNLK uses accepted deployment record while launch registry detail is unavailable.');}
    tokens=tokens.slice(0,quota.marketTokens-1);
    for(const token of tokens){try{let full=cache.get(`launchmeta:${token.launchId}`);if(!full){const data=await io.json(`${API}/launches/${token.launchId}`);full=data.launch||data;cache.set(`launchmeta:${token.launchId}`,full);}const a=full.artifacts?.find(a=>a.role==='token'&&address(a.address)===token.address);if(full.chainId!==1||full.status!=='live'||!a)throw Error('Metadata identity mismatch');token.logoSource=full.logo?.link||null;token.deploymentBlock=a.blockNumber;token.deploymentTx=a.txHash;}catch(e){errors.push(`Metadata unavailable for exact address ${token.address}`);}}
    const registry={tokens,pages,readAt:now(),before};cache.set('markets.registry',registry);return registry;
  }
  async function refresh() {
    if(inFlight)return inFlight;
    if(lastAttempt&&now()-lastAttempt<quota.marketRefreshSeconds*1000)return markets();
    lastAttempt=now();io.reset();references.reset();
    inFlight=(async()=>{
      const errors=[];
      try {
        if(BigInt(await io.rpc('eth_chainId'))!==1n)throw Error('RPC is not Ethereum mainnet');
        const head=BigInt(await io.rpc('eth_blockNumber'));const block=head-BigInt(quota.confirmations);const blockTag=hex(block);
        const blockData=await io.rpc('eth_getBlockByNumber',[blockTag,false]);const observedAt=new Date(Number(BigInt(blockData.timestamp))*1000).toISOString();if(now()-Date.parse(observedAt)>600000||Date.parse(observedAt)>now()+30000)throw Error('Confirmed market block is stale or from the future');
        let registry;try{registry=await discover(errors);}catch(e){registry=cache.get('markets.registry');if(!registry)throw e;errors.push(`Registry stale: ${e.message}`);}
        const featuredToken={address:IMD,symbol:'IMD',name:'Identity.md',launchId:null,launchNumber:null,createdAt:null,key:IMD_KEY,poolId:IMD_ETH_POOL,projectUrl:'https://imd.fun',sourceUrl:'https://imd.fun/docs/'};
        const tokens=[featuredToken,...registry.tokens];const tokenRows=[];
        let imdUsd=null,ethUsd=null;
        try {
          const [round,feedDecimals,word,activeReference]=await Promise.all([io.read(ETH_USD,FEED,'latestRoundData',[],blockTag),io.read(ETH_USD,FEED,'decimals',[],blockTag),io.read(POOL_MANAGER,MANAGER,'extsload',[poolSlot(IMD_ETH_POOL)],blockTag),io.read(STATE_VIEW,LIQUIDITY_ABI,'getLiquidity',[IMD_ETH_POOL],blockTag)]);
          const timestamp=BigInt(blockData.timestamp),state=decodeSlot(word);
          if(Number(feedDecimals)!==8||round[0]===0n||round[1]<=0n||round[4]<round[0]||round[3]>timestamp||timestamp-round[3]>5400n||state.sqrtPriceX96===0n||state.lpFee!==10000||activeReference<=0n)throw Error('IMD/ETH spot or Chainlink ETH/USD failed freshness/identity checks');
          ethUsd=Number(round[1])/1e8;imdUsd=ethUsd/(Number(state.sqrtPriceX96)/2**96)**2;
        }catch(e){errors.push(`USD fallback unavailable: ${e.message}`);}
        let dexPairs=[];try{dexPairs=await io.json(`https://api.dexscreener.com/tokens/v1/ethereum/${tokens.map(t=>t.address).join(',')}`);}catch(e){errors.push(`DEX Screener unavailable: ${e.message}`);}
        for(const token of tokens) {
          let record={...token,key:token.key,chainId:1,symbol:token.symbol||null,decimals:null,totalSupply:null,priceUsd:null,priceChange24h:null,volume24h:null,liquidityUsd:null,fdv:null,marketCap:null,chart:[],chartCurrency:'USD',observedAt,source:'Ethereum RPC',status:'unavailable',poolUrl:`https://app.uniswap.org/explore/pools/ethereum/${token.poolId}`,chartUrl:`https://dexscreener.com/ethereum/${token.poolId}`,verified:false,identity:{verified:false,sourceUrl:token.sourceUrl},pool:{id:token.poolId,dex:'uniswap',version:'v4',verified:false,quoteSymbol:token.address===IMD?'ETH':token.key.currency0.toLowerCase()===IMD||token.key.currency1.toLowerCase()===IMD?'IMD':'ETH'}};
          try {
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
            if(dex&&values.priceUsd!==null)record={...record,priceChange1h:finite(dex.priceChange?.h1),priceChange24h:values.priceChange24h,priceChange7d:null,volume24h:values.volume24h,liquidityUsd:null,source:'Ethereum v4 spot + Chainlink; DEX Screener changes/volume for exact PoolId',dexUpdatedAt:new Date(now()).toISOString()};
            record.identity={verified:true,sourceUrl:token.sourceUrl,launchId:token.launchId};record.pool={...record.pool,verified:true};
            record.pick=PINNED_PICKS[token.address]||null;
            try { if(poolStartBlocks[token.poolId])record.deploymentBlock=poolStartBlocks[token.poolId];const prices={ [NATIVE]:ethUsd,[IMD]:imdUsd,[token.address]:record.priceUsd };record.liquidityCheck=await verifyLiquidity(record,block,prices,blockData);record.liquidityUsd=record.liquidityCheck.usd; }catch(e){record.liquidityError=text(e.message,220);}
            try {record.sellCheck=await simulateSell(io,record,simulationPlans[token.address],block,blockData,now());}catch(e){record.simulationError=text(e.message,220);}
            record.listedAt=cache.get(`listed:${token.address}`)||null;
            if(eligibility(record,now(),Number(block)).eligible&&!record.listedAt){record.listedAt=new Date(now()).toISOString();cache.set(`listed:${token.address}`,record.listedAt);}
            if(record.liquidityCheck?.initializedBlock){const launchBlock=record.liquidityCheck.initializedBlock;let launchTime=cache.get(`launchTime:${token.address}`);if(!launchTime){const b=await io.rpc('eth_getBlockByNumber',[hex(launchBlock),false]);launchTime=new Date(Number(BigInt(b.timestamp))*1000).toISOString();cache.set(`launchTime:${token.address}`,launchTime);}record.launchedAt=launchTime;}
            if(token.logoSource){try{record.logo=await media.cacheLogo(record,token.logoSource);}catch{/* untrusted/unsupported image uses the local vector fallback */}}
            // Only observed points are plotted. No fabricated candles or carry-forward history.
            const old=cache.get('markets.snapshot');const previous=old?.featured?.address===token.address?old.featured:old?.markets?.find(t=>t.address===token.address);
            record.chart=(previous?.chart||[]).filter(p=>p.time>=now()/1000-7*86400).slice(-119);
            if(record.priceUsd!==null)record.chart.push({time:Number(BigInt(blockData.timestamp)),price:record.priceUsd});
            record.sparkline=record.chart.map(p=>p.price);
          }catch(e){record.unavailableReason=text(e.message,180);}
          tokenRows.push(record);
        }
        const snapshot={version:1,mode:'cached',chainId:1,updatedAt:new Date(now()).toISOString(),block:Number(block),blockTime:observedAt,featured:tokenRows.find(t=>t.address===IMD)||null,markets:tokenRows.filter(t=>t.address!==IMD),coverage:{registryPages:registry.pages,registryLimit:quota.registryPages*quota.registryPageSize,registryReadAt:new Date(registry.readAt).toISOString(),source:`${API}/launches`,rpcSource:PUBLIC_RPC,notes:['Ethereum only. Bounded recent launch registry; this is not a complete launch catalog.','All rows, editorial picks and placements pass the same current USD-liquidity and full-route sell gate. Unresolved identities remain unpublished.','Onchain fallback supplies spot/FDV only; unavailable DEX volume, change and USD liquidity remain unavailable.','FDV uses onchain total supply or provider FDV. Circulating supply is unverified; market cap is unavailable.','Sparklines contain observed USD points only. OHLCV uses indexed swaps and event-block USD references. Liquidity is per-position principal, active liquidity is reconciled to StateView; shared PoolManager balances and FDV are never liquidity.']},quotas:quota,errors};
        cache.set('markets.snapshot',snapshot);
        try{await indexer.refresh({pools:tokenRows.filter(t=>t.verified).map(t=>({poolId:t.poolId,key:t.key,address:t.address,symbol:t.symbol,decimals:t.decimals,deploymentBlock:t.deploymentBlock})),block,blockData,usdPrices:Object.fromEntries(tokenRows.map(t=>[t.address,t.priceUsd])),quoteUsdAt:references.at});}catch(e){
          const prior=cache.get('radar.snapshot')||{version:1,mode:'warming',chainId:1,updatedAt:null,coverage:{fromBlock:null,toBlock:null,fromTime:null,toTime:null,missingHistory:true,notes:['Indexer has not completed its first scan. Provider failure is shown below; no rows are fabricated.']},pools:[],events:[],wallets:[],nextCursor:null,quotas:quota};
          cache.set('radar.snapshot',{...prior,errors:[...(prior.errors||[]),`Refresh failed: ${text(e.message,180)}`].slice(-4)});
        }
        return snapshot;
      }catch(e){const old=cache.get('markets.snapshot');if(old){const stale={...old,eligibilityUnknown:true,errors:[...old.errors,`Refresh failed: ${text(e.message,180)}`].slice(-4)};cache.set('markets.snapshot',stale);return stale;}const failure={version:2,mode:'warming',chainId:1,eligibilityUnknown:true,updatedAt:null,featured:null,markets:[],coverage:{notes:['Data cache is warming. Provider data is unavailable until the first successful refresh.']},errors:[text(e.message,180)],quotas:quota};cache.set('markets.snapshot',failure);return failure;}
    })().finally(()=>{inFlight=null;});return inFlight;
  }
  async function markets() {
    const value=cache.get('markets.snapshot');
    if(!value)return {version:2,mode:'warming',chainId:1,updatedAt:null,featured:null,markets:[],excluded:[],coverage:{notes:['No current verified listings until indexing and sell simulations succeed.']},quotas:quota,errors:[]};
    const rows=[...(value.markets||[]),...(value.featured?[value.featured]:[])],admitted=value.eligibilityUnknown?[]:rows.filter(m=>eligibility(m,now(),value.block??null).eligible);
    return {...value,featured:null,markets:admitted,excluded:rows.filter(m=>value.eligibilityUnknown||!eligibility(m,now(),value.block??null).eligible).map(m=>({address:m.address,checkedAt:m.sellCheck?.checkedAt||m.liquidityCheck?.checkedAt||null,reasons:[...(value.eligibilityUnknown?['Latest refresh failed; current eligibility is unknown.']:[]),...eligibility(m,now(),value.block??null).reasons,...[m.liquidityError,m.simulationError].filter(Boolean)]})),stale:now()-Date.parse(value.updatedAt)>600000};
  }
  return {markets,radar:indexer.radar,refresh,quota,rawToken:address=>{const d=cache.get('markets.snapshot');return [d?.featured,...(d?.markets||[])].find(t=>t?.address===address)||null;},io,media};
}

export { ERC20 };
