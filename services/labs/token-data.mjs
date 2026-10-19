import { parseAbi } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { amountString } from './indexer.mjs';
import { eligibility, traderPnl } from '../../web/src/labs/domain.mjs';
import { address, assert } from './security.mjs';
const ERC20=parseAbi(['function balanceOf(address) view returns (uint256)','function totalSupply() view returns (uint256)']);
export const INFRASTRUCTURE=Object.freeze({
 '0x0000000000000000000000000000000000000000':'burn / mint origin',
 '0x000000000000000000000000000000000000dead':'burn',
 '0x000000000004444c5dc75cb358380d2e3de08a90':'Uniswap v4 PoolManager',
 '0x66a9893cc07d91d95644aedd05d03f95e1dba8af':'Uniswap Universal Router',
 '0x000000000022d473030f116ddee9f6b43ac78ba3':'Permit2',
 '0x12c63b581d07093f6126bc02263c58f7eadaa96f':'IMD launch factory'
});
export function aggregateCandles(events,timeframe='1h') {
 const seconds={'1m':60,'5m':300,'1h':3600,'1d':86400}[timeframe];assert(seconds,422,'invalid_timeframe','Use 1m, 5m, 1h or 1d.');
 const buckets=new Map();
 for(const e of [...events].filter(e=>['buy','sell'].includes(e.type)).sort((a,b)=>a.time-b.time||a.block-b.block||Number(a.logIndex??0)-Number(b.logIndex??0))) {
  const time=Math.floor(e.time/seconds)*seconds;const c=buckets.get(time)||{time,usd:null,quote:null};
  for(const [field,price,volume] of [['usd',e.priceUsd,e.amountUsd],['quote',e.priceQuote,Number(e.quoteAmount)]]) {
   // Quote-only events must not create a partial USD candle that hides missing prices.
   c[`${field}Missing`] ||= !(typeof price==='number'&&Number.isFinite(price)&&price>0&&volume!=null&&Number.isFinite(volume)&&volume>=0);
   if(c[`${field}Missing`]){c[field]=null;continue;}
   const p=c[field];c[field]=p?{open:p.open,high:Math.max(p.high,price),low:Math.min(p.low,price),close:price,volume:p.volume+volume}:{open:price,high:price,low:price,close:price,volume};
  }
  buckets.set(time,c);
 }
 return [...buckets.values()].sort((a,b)=>a.time-b.time).slice(-1000);
}
export function createTokenData({store,markets,io,now=()=>Date.now()}) {
 async function detail(token,search=new URLSearchParams()) {
  token=address(token);const all=await markets.markets(),market=(all.markets||[]).find(m=>m.address===token),raw=markets.rawToken?.(token);const gate=eligibility(market,now(),all.block??null),coverage=store.get('radar.snapshot')?.coverage||{notes:['No indexed history.'],fromBlock:null,toBlock:null};
  if(!gate.eligible)return {market:null,reasons:all.excluded?.find(m=>m.address===token)?.reasons||gate.reasons,pools:[],candles:[],events:[],holders:[],traders:[],nextCursor:null,coverage};
  const interval=search.get('timeframe')||'1h',pool=search.get('pool')||market.poolId;assert(pool===market.poolId,422,'pool_unverified','Select a verified pool from this token’s pool list.');
  const offset=Number(search.get('cursor')||0);assert(Number.isInteger(offset)&&offset>=0&&offset<=10000,422,'invalid_cursor','Use a cursor returned by this token response.');
  const view=search.get('view')||'Swaps';assert(['Swaps','Transfers','Liquidity','Holders','Traders'].includes(view),422,'invalid_view','Choose swaps, transfers, liquidity, holders or traders.');
  const indexed=store.get('radar.index')?.events||[];const allEvents=indexed.filter(e=>e.token===token&&(e.type==='transfer'||e.poolId===pool));
  let holders=[];const cacheKey=`holders:${token}`;let old=store.get(cacheKey);
  if(!old||now()-old.at>60000||old.block!==coverage.toBlock){
   const candidates=[...new Set(allEvents.flatMap(e=>[e.wallet,e.from,e.to]).filter(Boolean))].slice(0,24),tag='0x'+BigInt(coverage.toBlock||all.block).toString(16);const values=[];let supply=null;
   try{supply=await io.read(token,ERC20,'totalSupply',[],tag);}catch{/* share unavailable */}
   for(const wallet of candidates){try{const [rawBalance,code]=await Promise.all([io.read(token,ERC20,'balanceOf',[wallet],tag),io.rpc('eth_getCode',[wallet,tag])]);if(rawBalance===0n)continue;const classification=INFRASTRUCTURE[wallet]||(code==='0x'||code.startsWith('0xef0100')?'ordinary':'contract; identity unclassified');values.push({address:wallet,balance:amountString(rawBalance,market.decimals),balanceRaw:rawBalance.toString(),share:supply&&supply>0n?Number(rawBalance*100000000n/supply)/1000000:null,classification});}catch{/* failed balances are omitted, not treated as zero */}}
   old={at:now(),block:coverage.toBlock,values};store.set(cacheKey,old);
  }
  holders=old.values.sort((a,b)=>Number(BigInt(b.balanceRaw)-BigInt(a.balanceRaw)));
  const actors=[...new Set(allEvents.filter(e=>['buy','sell'].includes(e.type)&&e.wallet&&!e.ambiguousRouting).map(e=>e.wallet))].slice(0,50);
  const traders=actors.map(wallet=>{const events=allEvents.filter(e=>e.wallet===wallet||(e.type==='transfer'&&!e.relatedActivity&&(e.from===wallet||e.to===wallet))).map(e=>({...e,direction:e.to===wallet?'in':'out'}));const balance=holders.find(h=>h.address===wallet)?.balance;return {address:wallet,buys:events.filter(e=>e.type==='buy').length,sells:events.filter(e=>e.type==='sell').length,pnl:traderPnl(events,balance===undefined?null:Number(balance),market.priceUsd,coverage.hasOmissions===false&&Number.isSafeInteger(market.deploymentBlock)&&coverage.fromBlock<=market.deploymentBlock&&coverage.toBlock>=all.block)};});
  const selected=allEvents.filter(e=>view==='Transfers'?e.type==='transfer'&&e.relatedActivity!=='swap'&&e.relatedActivity!=='liquidity':view==='Liquidity'?e.type==='liquidity':['buy','sell'].includes(e.type));
  const total=view==='Holders'?holders.filter(h=>h.classification==='ordinary').length:view==='Traders'?traders.length:selected.length;
  const ordinary=holders.filter(h=>h.classification==='ordinary'),other=holders.filter(h=>h.classification!=='ordinary');
  return {market,pools:[{id:pool,label:`Uniswap v4 · ${market.symbol}/${market.pool.quoteSymbol}`}],candles:coverage.hasOmissions===true?[]:aggregateCandles(allEvents.filter(e=>e.poolId===pool),interval).map(c=>({...c,complete:c.time>=(coverage.fromTime||0)})),events:selected.slice(offset,offset+50),holders:[...ordinary.slice(offset,offset+50),...other],traders:traders.slice(offset,offset+50),nextCursor:offset+50<total?String(offset+50):null,coverage:{...coverage,updatedAt:new Date(old.at).toISOString(),notes:[...coverage.notes,'Holder balances cover up to 24 observed addresses, not a complete holder list. Unclassified contracts and infrastructure are shown separately.','Only explicit indexed swaps form candles. USD values require a valid historical USD reference at the event block. Empty intervals remain gaps. Known log omissions withhold candles; a clipped first interval is excluded, and the current interval ends at the stated confirmed block.','P&L is FIFO over observed lots; transfers, missing earlier history or unmatched balances leave partial or unavailable cost basis. Only single-pool direct router trades with both token and quote wallet flows reconciled support cost basis; other routes remain unknown. Network gas excluded.']}};
 }
 return {detail};
}
