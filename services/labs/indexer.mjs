/** Bounded confirmed-block v4/transfer index. Persistent state is supplied by the service store. */
import { parseAbiItem, decodeEventLog } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { IMD, UNLK, POOL_MANAGER, ERC20, address, hex, quota, PUBLIC_RPC } from './markets.mjs';
const SWAP=parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const LIQUIDITY=parseAbiItem('event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)');
const TRANSFER=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
// Event selectors from canonical Uniswap v4-core IPoolManager / IERC20 event signatures.
import { keccak256,stringToHex } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
const TOPICS={swap:keccak256(stringToHex('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)')),liquidity:keccak256(stringToHex('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)')),transfer:keccak256(stringToHex('Transfer(address,address,uint256)'))};
const TREASURY='0xfe44fc8f6c32f681a0ce443902a0b08bb5b3c736';
const EXCLUDED=new Set(['0x000000000004444c5dc75cb358380d2e3de08a90','0x0000000000000000000000000000000000000000','0x66a9893cc07d91d95644aedd05d03f95e1dba8af','0x000000000022d473030f116ddee9f6b43ac78ba3','0x12c63b581d07093f6126bc02263c58f7eadaa96f','0xff03410d0fe5fa8f7f59f743de35e333d9857120']);
export const PERIODS={'1h':3600,'24h':86400,'7d':604800};
export function amountString(value,decimals=18) {
  const n=BigInt(value),negative=n<0n,absolute=negative?-n:n,denominator=10n**BigInt(decimals);
  const fractional=(absolute%denominator).toString().padStart(decimals,'0').replace(/0+$/,'');
  return `${negative?'-':''}${absolute/denominator}${fractional?'.'+fractional:''}`;
}
const keyOf=log=>`${log.transactionHash}:${Number(BigInt(log.logIndex))}`;
export const assetCoverageKey=(token,pool)=>`1:${token.toLowerCase()}:${pool.toLowerCase()}`;
const deploymentOf=p=>Number.isSafeInteger(p.deploymentBlock)&&p.deploymentBlock>0?p.deploymentBlock:null;
const matchesLog=(p,l)=>address(l.address)===p.address||(address(l.address)===POOL_MANAGER&&l.topics?.[1]?.toLowerCase()===p.poolId.toLowerCase());
const matchesEvent=(p,e)=>e.token===p.address&&(e.type==='transfer'||e.poolId?.toLowerCase()===p.poolId.toLowerCase());
export function classifyPoolLog(log,pool) {
  const event=decodeEventLog({abi:[SWAP,LIQUIDITY],data:log.data,topics:log.topics,strict:true});
  if(event.eventName==='ModifyLiquidity')return {type:'liquidity',amount:null,amountRaw:null,liquidityDelta:event.args.liquidityDelta.toString(),attribution:'Pool liquidity operation; sender is an executor, not an identified wallet'};
  const tokenIs0=pool.key.currency0.toLowerCase()===pool.address;const delta=tokenIs0?event.args.amount0:event.args.amount1;const quoteDelta=tokenIs0?event.args.amount1:event.args.amount0;
  return {type:delta>0n?'buy':'sell',amount:amountString(delta<0n?-delta:delta,pool.decimals),amountRaw:(delta<0n?-delta:delta).toString(),tokenDelta:delta.toString(),quoteAmount:amountString(quoteDelta<0n?-quoteDelta:quoteDelta),priceQuote:delta===0n?null:Math.abs(Number(amountString(quoteDelta))/Number(amountString(delta,pool.decimals))),quoteCurrency:tokenIs0?pool.key.currency1:pool.key.currency0,sqrtPriceX96:event.args.sqrtPriceX96.toString(),attribution:'Unattributed v4 executor; wallet requires token receipt reconciliation'};
}
function decodeTransfer(log) {const v=decodeEventLog({abi:[TRANSFER],data:log.data,topics:log.topics,strict:true}).args;return {from:address(v.from),to:address(v.to),raw:v.value};}
export function receiptNet(receipt,token,wallet) {
  let net=0n;for(const log of receipt.logs||[]) {
    if(address(log.address)!==token||log.topics?.[0]?.toLowerCase()!==TOPICS.transfer)continue;
    try {const t=decodeTransfer(log);if(t.to===wallet)net+=t.raw;if(t.from===wallet)net-=t.raw;}catch{/* unrecognized event is not attributed */}
  }return net;
}

export function createIndexer({store,io,now=()=>Date.now(),historyStartBlock=null}) {
  let active=null;
  async function refresh({pools,block,blockData,usdPrices={},quoteUsdAt=null}) {
    if(active)return active;
    active=(async()=>{
      const errors=[],notes=[];let state=structuredClone(store.get('radar.index')||{version:2,events:[],startBlock:null,lastBlock:null,lastHash:null,blocks:{}});
      if(state.version!==2)state.omitted=true;
      const safePools=pools.slice(0,quota.marketTokens);const poolById=new Map(safePools.map(p=>[p.poolId.toLowerCase(),p]));
      const requestedStart=state.lastBlock===null?(historyStartBlock===null?block-BigInt(quota.maxBlocksPerRefresh)+1n:BigInt(historyStartBlock)):BigInt(state.lastBlock)-11n;
      let from=requestedStart<0n?0n:requestedStart;
      if(state.lastBlock!==null&&state.lastHash) {
        const checkpoint=await io.rpc('eth_getBlockByNumber',[hex(state.lastBlock),false]);
        if(checkpoint?.hash!==state.lastHash){
          // The depth of a changed confirmed checkpoint is unknown. Keeping any older rows
          // could retain orphaned history, so restart within the same bounded scan budget.
          from=block-BigInt(quota.maxBlocksPerRefresh)+1n;if(from<0n)from=0n;
          state={version:2,events:[],startBlock:null,lastBlock:null,lastHash:null,blocks:{}};
          notes.push('Confirmed checkpoint changed; all retained rows were discarded and the latest bounded 1,800-block history was rebuilt. Earlier history is unavailable.');
        }
      }
      // Global Radar scans do not prove that a later-discovered token/PoolId was queried.
      // Rewind the bounded scan for the oldest asset backlog; overlap stays idempotent.
      const assetCoverage={};
      for(const p of safePools){
        const key=assetCoverageKey(p.address,p.poolId),deploymentBlock=deploymentOf(p),old=state.assetCoverage?.[key];
        const prior=old&&old.deploymentBlock===deploymentBlock?old:null;
        assetCoverage[key]=prior||{chainId:1,address:p.address,poolId:p.poolId,deploymentBlock,fromBlock:null,toBlock:null,hasOmissions:false};
        const needed=prior?.toBlock!=null?Math.max(prior.fromBlock,prior.toBlock-11):deploymentBlock;
        if(needed!==null&&BigInt(needed)<from)from=BigInt(needed);
      }
      const to=from+BigInt(quota.maxBlocksPerRefresh)-1n<block?from+BigInt(quota.maxBlocksPerRefresh)-1n:block;
      if(to<from)return store.get('radar.snapshot');
      const logs=[];
      const omittedAssets=new Set();
      const omitLog=log=>{for(const p of safePools)if(matchesLog(p,log))omittedAssets.add(assetCoverageKey(p.address,p.poolId));};
      const omitEvent=event=>{for(const p of safePools)if(matchesEvent(p,event))omittedAssets.add(assetCoverageKey(p.address,p.poolId));};
      // Pagination is block based, with fixed pool/token filters. No unbounded eth_getLogs request.
      for(let start=from;start<=to;start+=BigInt(quota.logPageBlocks)) {
        const end=start+BigInt(quota.logPageBlocks)-1n<to?start+BigInt(quota.logPageBlocks)-1n:to;
        if(safePools.length)logs.push(...await io.rpc('eth_getLogs',[{address:POOL_MANAGER,fromBlock:hex(start),toBlock:hex(end),topics:[[TOPICS.swap,TOPICS.liquidity],safePools.map(p=>p.poolId)]}]));
        logs.push(...await io.rpc('eth_getLogs',[{address:[...new Set([IMD,UNLK,...safePools.map(p=>p.address)])],fromBlock:hex(start),toBlock:hex(end),topics:[TOPICS.transfer]}]));
      }
      const unique=[...new Map(logs.filter(l=>!l.removed).map(l=>[keyOf(l),l])).values()].sort((a,b)=>Number(BigInt(b.blockNumber)-BigInt(a.blockNumber))||Number(BigInt(b.logIndex)-BigInt(a.logIndex)));
      let selected=unique.slice(0,1000);if(unique.length>selected.length){state.omitted=true;}if(unique.length>selected.length)notes.push(`Event page quota retained ${selected.length} of ${unique.length} logs in this scan; history is incomplete.`);
      unique.slice(selected.length).forEach(omitLog);
      // Each row uses its canonical block timestamp. Do not estimate timestamps from block height.
      const blockNumbers=[...new Set([Number(from),Number(to),...selected.map(l=>Number(BigInt(l.blockNumber)))])];
      const supported=new Set(blockNumbers.slice(0,100));
      if(blockNumbers.length>100){state.omitted=true;notes.push('Block timestamp request quota reached; older rows in this scan are omitted.');selected=selected.filter(l=>{const keep=supported.has(Number(BigInt(l.blockNumber)));if(!keep)omitLog(l);return keep;});}
      for(const n of supported){if(state.blocks[n]?.hash&&n<Number(from)-12)continue;const b=n===Number(block)?blockData:await io.rpc('eth_getBlockByNumber',[hex(n),false]);if(!b)throw Error('Canonical block unavailable');state.blocks[n]={time:Number(BigInt(b.timestamp)),hash:b.hash};}
      const swapHashes=new Set(selected.filter(l=>l.topics[0]===TOPICS.swap).map(l=>l.transactionHash));
      const liqHashes=new Set(selected.filter(l=>l.topics[0]===TOPICS.liquidity).map(l=>l.transactionHash));
      const transactionCache=new Map();const attributionHashes=[...swapHashes].slice(0,24);
      for(const hash of attributionHashes) {
        try{
          const tx=await io.rpc('eth_getTransactionByHash',[hash]);const sender=address(tx?.from);
          if(!sender||EXCLUDED.has(sender)){transactionCache.set(hash,{sender:null});continue;}
          const code=await io.rpc('eth_getCode',[sender,hex(to)]);
          if(code!=='0x'&&!code.startsWith('0xef0100')){transactionCache.set(hash,{sender:null});continue;}
          const receipt=await io.rpc('eth_getTransactionReceipt',[hash]);transactionCache.set(hash,{sender,receipt,to:address(tx.to)});
        }catch(e){errors.push(`Transaction attribution unavailable: ${e.message}`);break;}
      }
      const events=[],candidateVolumes=new Map();
      for(const log of selected) {
        const n=Number(BigInt(log.blockNumber)),timestamp=state.blocks[n]?.time;if(!timestamp)continue;
        const base={id:keyOf(log),hash:log.transactionHash,chainId:1,block:n,transactionIndex:Number(BigInt(log.transactionIndex||0)),logIndex:Number(BigInt(log.logIndex)),time:timestamp,transactionUrl:`https://etherscan.io/tx/${log.transactionHash}`,wallet:null,amountUsd:null};
        try {
          if(address(log.address)===POOL_MANAGER) {
            const pool=poolById.get(log.topics[1]?.toLowerCase());if(!pool)continue;const detail=classifyPoolLog(log,pool);
            const tx=transactionCache.get(log.transactionHash);let wallet=null;
            const routeSwaps=selected.filter(l=>l.transactionHash===log.transactionHash&&l.topics[0]===TOPICS.swap&&poolById.get(l.topics[1]?.toLowerCase())?.address===pool.address).length;
            const ambiguousRouting=routeSwaps!==1;
            if(detail.type!=='liquidity'&&tx?.sender&&tx.receipt&&!ambiguousRouting) {
              const net=receiptNet(tx.receipt,pool.address,tx.sender);
              if((detail.type==='buy'&&net>0n)||(detail.type==='sell'&&net<0n))wallet=tx.sender;
            }
            let priceUsd=null,amountUsd=null,costBasisUsd=null,costBasisSupported=false;
            if(detail.type!=='liquidity'&&quoteUsdAt){try{const refs=await quoteUsdAt(n,timestamp);const q=refs[detail.quoteCurrency.toLowerCase()];if(q>0&&detail.priceQuote>0){priceUsd=detail.priceQuote*q;amountUsd=Number(detail.quoteAmount)*q;
                if(wallet&&tx?.to==='0x66a9893cc07d91d95644aedd05d03f95e1dba8af'&&tx.receipt.logs.filter(l=>address(l.address)===POOL_MANAGER&&l.topics[0]===TOPICS.swap).length===1){const net=receiptNet(tx.receipt,detail.quoteCurrency.toLowerCase(),wallet);const tokenNet=receiptNet(tx.receipt,pool.address,wallet);if(tokenNet.toString()===detail.tokenDelta&&((detail.type==='buy'&&net<0n)||(detail.type==='sell'&&net>0n))){costBasisUsd=Math.abs(Number(amountString(net)))*q;costBasisSupported=true;}}}}catch{/* archive/valuation gaps remain unavailable */}}
            events.push({...base,...detail,decimals:pool.decimals,priceUsd,amountUsd,costBasisUsd,costBasisSupported,logIndex:Number(BigInt(log.logIndex)),ambiguousRouting,token:pool.address,symbol:pool.symbol,poolId:pool.poolId,wallet,from:null,to:null,attribution:wallet?'Transaction sender reconciled with token transfers; recipient identity is unknown':detail.attribution});
          } else {
            const transfer=decodeTransfer(log),token=address(log.address),symbol=token===IMD?'IMD':token===UNLK?'UNLK':safePools.find(p=>p.address===token)?.symbol||'Unknown';
            const relatedActivity=liqHashes.has(log.transactionHash)?'liquidity':swapHashes.has(log.transactionHash)?'swap':'transfer';
            const decimals=safePools.find(p=>p.address===token)?.decimals??18;
            events.push({...base,type:'transfer',relatedActivity:relatedActivity==='transfer'?null:relatedActivity,token,symbol,decimals,amount:amountString(transfer.raw,decimals),amountRaw:transfer.raw.toString(),from:transfer.from,to:transfer.to,poolId:null,attribution:relatedActivity==='transfer'?'ERC20 transfer; not classified as a trade':`Token settlement in a ${relatedActivity} transaction; not counted as an additional trade`});
            if(token===IMD)for(const wallet of [transfer.from,transfer.to])if(wallet&&!EXCLUDED.has(wallet))candidateVolumes.set(wallet,(candidateVolumes.get(wallet)||0n)+transfer.raw);
          }
        }catch(e){state.omitted=true;omitLog(log);errors.push(`Unrecognized log omitted at ${base.id}`);}
      }
      const cutoff=now()/1000-quota.retentionDays*86400;
      // Re-query overlap replaces rows in the range, providing deterministic retry/reorg handling.
      const retained=state.events.filter(e=>{if(e.time<cutoff){omitEvent(e);return false;}return e.block<Number(from)||e.block>Number(to)||!(e.type==='transfer'?[IMD,UNLK,...safePools.map(p=>p.address)].includes(e.token):safePools.some(p=>matchesEvent(p,e)));});
      if(retained.length+events.length>quota.maxEvents)state.omitted=true;
      const merged=[...new Map([...retained,...events.filter(e=>{if(e.time<cutoff){omitEvent(e);return false;}return true;})].map(e=>[e.id,e])).values()].sort((a,b)=>b.block-a.block||b.id.localeCompare(a.id));
      merged.slice(quota.maxEvents).forEach(omitEvent);const combined=merged.slice(0,quota.maxEvents);
      for(const p of safePools){
        const key=assetCoverageKey(p.address,p.poolId),c=assetCoverage[key];
        // A different asset's earlier backfill cannot invalidate already covered history.
        if(c.deploymentBlock===null||Number(to)>=c.deploymentBlock){
          if(c.fromBlock===null||Number(from)>c.toBlock+1||Number(to)<c.fromBlock-1){c.fromBlock=Number(from);c.toBlock=Number(to);}
          else{c.fromBlock=Math.min(c.fromBlock,Number(from));c.toBlock=Math.max(c.toBlock,Number(to));}
        }
        c.fromTime=state.blocks[c.fromBlock]?.time??c.fromTime??null;c.toTime=state.blocks[c.toBlock]?.time??c.toTime??null;
        c.hasOmissions ||= omittedAssets.has(key);c.completeHistory=c.deploymentBlock!==null&&c.fromBlock!==null&&c.fromBlock<=c.deploymentBlock&&c.toBlock===Number(block)&&!c.hasOmissions;
      }
      const priorWallets=(store.get('radar.snapshot')?.wallets||[]).map(w=>w.address);
      const candidates=[...new Set([TREASURY,...[...candidateVolumes].sort((a,b)=>a[1]>b[1]?-1:1).map(([w])=>w),...priorWallets])].slice(0,quota.candidateWallets);
      const wallets=[];
      for(const wallet of candidates) {
        try {
          const code=await io.rpc('eth_getCode',[wallet,hex(to)]);
          // A pool/router contract can appear in transfer logs. It is not an individual wallet.
          // EIP-7702 delegated EOAs remain eligible; contract custody is outside this watchlist.
          if(code!=='0x'&&!code.startsWith('0xef0100'))continue;
          const [imd,unlk]=await Promise.all([io.read(IMD,ERC20,'balanceOf',[wallet],hex(to)),io.read(UNLK,ERC20,'balanceOf',[wallet],hex(to))]);
          if(imd===0n&&unlk===0n&&wallet!==TREASURY)continue;
          wallets.push({address:wallet,label:wallet===TREASURY?'UNLOCK treasury / NFT inventory':null,holdings:[{address:IMD,symbol:'IMD',balance:amountString(imd),raw:imd.toString(),usd:usdPrices[IMD]===null||usdPrices[IMD]===undefined?null:Number(amountString(imd))*usdPrices[IMD]},{address:UNLK,symbol:'UNLK',balance:amountString(unlk),raw:unlk.toString(),usd:usdPrices[UNLK]===null||usdPrices[UNLK]===undefined?null:Number(amountString(unlk))*usdPrices[UNLK]}],holdingsBlock:Number(to),source:wallet===TREASURY?'Declared project treasury; no beneficiary authority is inferred':'Larger current IMD balance among bounded observed counterparties; not a global holder ranking'});
        }catch(e){errors.push(`Holdings unavailable for ${wallet}: ${e.message}`);}
      }
      const watchlist=wallets.sort((a,b)=>BigInt(a.holdings[0].raw)>BigInt(b.holdings[0].raw)?-1:1).slice(0,quota.watchWallets);
      const retainedBlocks=Object.fromEntries(Object.entries(state.blocks).filter(([,b])=>b.time>=cutoff));
      const startBlock=Math.max(Math.min(state.startBlock??Number(from),Number(from)),Math.min(...Object.keys(retainedBlocks).map(Number)));
      const lastBlock=Math.max(state.lastBlock??Number(to),Number(to)),lastHash=state.blocks[lastBlock]?.hash||state.lastHash;
      state={...state,assetCoverage,events:combined,startBlock,lastBlock,lastHash,blocks:retainedBlocks};store.set('radar.index',state);
      const snapshot={version:1,mode:'cached',chainId:1,updatedAt:new Date(now()).toISOString(),period:'24h',coverage:{fromBlock:state.startBlock,toBlock:state.lastBlock,headBlock:Number(block),fromTime:state.blocks[state.startBlock]?.time||null,toTime:state.blocks[state.lastBlock]?.time||null,missingHistory:true,hasOmissions:state.omitted===true,backlogBlocks:Number(block)-state.lastBlock,rpcSource:PUBLIC_RPC,notes:['Only configured Ethereum v4 PoolIds and their token transfers plus IMD/UNLK are indexed. Other pools/chains are outside coverage.','Startup begins with at most 1,800 confirmed blocks. Selectable periods are clipped to indexed history; absent rows are not proof of no activity.','Swaps, plain transfers and liquidity operations are separate. Router/PoolManager balances are never assigned to traders.','Wallet attribution requires a transaction sender and matching token transfer direction. Aggregators and unknown executors remain unattributed.','Watchlist: up to 10 larger IMD balances among at most 24 observed EOA counterparties, plus the declared treasury candidate; contract custody and global holder rankings are outside coverage.','No wallet identities or investment quality are inferred. Transaction routes with multiple token swaps remain unattributed; missing historical USD prices stay unavailable.',...notes]},assetCoverage:Object.values(assetCoverage),pools:safePools.map(p=>({chainId:1,poolId:p.poolId,address:p.address,symbol:p.symbol,decimals:p.decimals,key:p.key})),events:combined,wallets:watchlist,nextCursor:null,quotas:quota,errors:[...new Set(errors)].slice(0,6)};store.set('radar.snapshot',snapshot);return snapshot;
    })().finally(()=>{active=null;});return active;
  }
  async function radar({period='24h',cursor=null}={}) {
    if(!Object.hasOwn(PERIODS,period))throw Object.assign(Error('Supported periods: 1h, 24h, 7d'),{status:400});
    const offset=cursor===null?0:Number(cursor);if(!Number.isInteger(offset)||offset<0||offset>quota.maxEvents)throw Object.assign(Error('Invalid bounded page cursor'),{status:400});
    const snapshot=store.get('radar.snapshot');if(!snapshot)return {version:1,mode:'warming',period,updatedAt:null,coverage:{fromBlock:null,toBlock:null,fromTime:null,toTime:null,missingHistory:true,notes:['Indexer is warming. No trades or balances are fabricated.']},pools:[],events:[],wallets:[],nextCursor:null,quotas:quota,errors:[]};
    const cutoff=now()/1000-PERIODS[period],events=snapshot.events.filter(e=>e.time>=cutoff);
    const wallets=snapshot.wallets.map(wallet=>{
      const net=new Map();for(const e of events){
        if(e.type!=='transfer'||!address(e.token))continue;
        const delta=(e.to===wallet.address?BigInt(e.amountRaw):0n)-(e.from===wallet.address?BigInt(e.amountRaw):0n);if(delta===0n)continue;
        const chainId=e.chainId??snapshot.chainId??1,token=address(e.token),key=`${chainId}:${token}`;
        // Older snapshots may lack decimals. Only exact address metadata is a valid fallback.
        const decimals=e.decimals??snapshot.pools?.find(p=>address(p.address)===token)?.decimals??([IMD,UNLK].includes(token)?18:null);
        const validDecimals=Number.isInteger(decimals)&&decimals>=0&&decimals<=30?decimals:null;
        const prior=net.get(key);net.set(key,{chainId,address:token,symbol:e.symbol,decimals:prior&&prior.decimals!==validDecimals?null:validDecimals,raw:(prior?.raw||0n)+delta});
      }
      return {...wallet,netFlow:[...net.values()].map(({raw,...flow})=>({...flow,amountRaw:raw.toString(),amount:flow.decimals===null?null:amountString(raw,flow.decimals)})),netFlowBasis:'Net ERC20 transfers by chain/address within covered period, including swaps/liquidity; not profit. Missing decimals leave the formatted amount unavailable.'};
    });
    return {...snapshot,period,stale:now()-Date.parse(snapshot.updatedAt)>quota.indexRefreshSeconds*2000,coverage:{...snapshot.coverage,requestedFromTime:cutoff,periodComplete:!snapshot.coverage.missingHistory&&snapshot.coverage.fromTime<=cutoff},events:events.slice(offset,offset+quota.eventPageSize),wallets,nextCursor:offset+quota.eventPageSize<events.length?String(offset+quota.eventPageSize):null,totalEvents:events.length};
  }
  return {refresh,radar};
}
