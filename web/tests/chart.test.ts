import test from "node:test";
import assert from "node:assert/strict";
import { CACHE_KEY, INTERVALS, POOL_URL, cachedHistory, candleURL, parseCandles, readChartPage, verifyPool, type ChartHistory } from "../src/chart/data";
import { readIndexedHistory } from "../src/chart/indexer";
import { DEPLOYMENT_BLOCK } from "../src/config";
import { IMD, POOL_ID, POOL_MANAGER, TOKEN } from "../src/mainnet";
import type { PublicClient } from "viem";
const metadata = { data: { id: `eth_${POOL_ID}`, attributes: { address: POOL_ID }, relationships: { base_token: { data: { id: `eth_${TOKEN}` } }, quote_token: { data: { id: `eth_${IMD}` } }, dex: { data: { id: "uniswap-v4-ethereum" } } } } };
const response = (rows: number[][]) => ({ meta: { base: { address: TOKEN }, quote: { address: IMD, symbol: "VIBE" } }, data: { attributes: { ohlcv_list: rows } } });
const row = (time: number, price=2) => [time,price,price+1,price-1,price,3];
const storage = new Map<string,string>();
Object.defineProperty(globalThis,"localStorage",{ configurable:true,value:{ getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v) } });
test("exact pool and address identities, not symbols, gate historical data",()=>{
  verifyPool(metadata);
  const wrong: any=structuredClone(metadata);wrong.data.attributes.address=POOL_MANAGER;
  assert.throws(()=>verifyPool(wrong),/identity mismatch/);
  const wrongToken=structuredClone(metadata);wrongToken.data.relationships.quote_token.data.id=`eth_${TOKEN}`;
  assert.throws(()=>verifyPool(wrongToken),/identity mismatch/);
  assert.equal(parseCandles(response([row(300)]),300).length,1);
  assert.throws(()=>parseCandles({...response([]),meta:{base:{address:IMD},quote:{address:TOKEN}}},300),/identity mismatch/);
});
test("all requested intervals use exact-pool historical unit queries without current-rate conversion",()=>{
  assert.deepEqual(INTERVALS.map(i=>i.seconds),[60,300,900,3600,14400,86400]);
  for(const i of INTERVALS)for(const unit of ["IMD","USD"] as const){const url=new URL(candleURL(i,unit,299));assert(url.pathname.includes(POOL_ID));assert.equal(url.searchParams.get("token"),"base");assert.equal(url.searchParams.get("currency"),unit==="USD"?"usd":"token");assert.equal(url.searchParams.get("include_empty_intervals"),"false");assert.equal(url.searchParams.get("before_timestamp"),"299");}
});
test("candles sort, deduplicate, preserve genuine gaps and reject invalid OHLC/volume",()=>{
  assert.deepEqual(parseCandles(response([row(900),row(300),row(300),[600,2,2,2,2,0]]),300).map(c=>c.time),[300,900]);
  for(const r of [[300,2,1,1,2,3],[300,2,3,2.5,2,3],[301,2,3,1,2,3],[300,2,3,1,2,-1],[300,NaN,3,1,2,1]])assert.throws(()=>parseCandles(response([r]),300),/Invalid/);
});
test("refresh reconciles overlap; cache survives reload; pagination honors cursor; empty response stays empty",async()=>{
  const oldFetch=globalThis.fetch;const signal=new AbortController().signal;let page=response([row(300),row(600)]);const urls:string[]=[];
  globalThis.fetch=async(input)=>{urls.push(String(input));return new Response(JSON.stringify(String(input)===POOL_URL?metadata:page),{status:200});};
  try{
    storage.clear();const first=await readChartPage(INTERVALS[1],"IMD",signal,null);assert.equal(cachedHistory(300,"IMD")?.candles.length,2);
    page=response([row(600,5),row(900,6)]);const next=await readChartPage(INTERVALS[1],"IMD",signal,first);assert.deepEqual(next.candles.map(c=>c.close),[2,5,6]);
    page=response([row(300)]);const older=await readChartPage(INTERVALS[1],"IMD",signal,{...next,candles:next.candles.slice(1)},true);assert.equal(new URL(urls.at(-1)!).searchParams.get("before_timestamp"),"599");assert.equal(older.candles.length,3);
    page=response([row(900)]);await assert.rejects(readChartPage(INTERVALS[1],"IMD",signal,next,true),/cursor/);
    page=response([]);assert.equal((await readChartPage(INTERVALS[1],"IMD",signal,next)).candles.length,0);
    storage.set(CACHE_KEY,JSON.stringify([{...first,pool:POOL_MANAGER}]));assert.equal(cachedHistory(300,"IMD"),null);
  } finally {globalThis.fetch=oldFetch;}
});
test("provider failure/cancellation cannot replace verified candles with an empty success",async()=>{
  const oldFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response("limited",{status:429,headers:{"retry-after":"60"}});
    await assert.rejects(readChartPage(INTERVALS[1],"USD",new AbortController().signal,null),/rate limit/);
    const aborted=new AbortController();aborted.abort();globalThis.fetch=async()=>{throw Error("aborted")};
    await assert.rejects(readChartPage(INTERVALS[1],"IMD",aborted.signal,null));
  } finally {globalThis.fetch=oldFetch;}
});
const hash=`0x${"a".repeat(64)}` as const;
function fixture(){
 const head={number:DEPLOYMENT_BLOCK+5000n,timestamp:BigInt(Math.floor(Date.now()/1000)),hash};const calls:any[]=[];let fail=false;
 const reader={getChainId:async()=>1,readContract:async()=>18,getBlock:async(a:any={})=>({...head,number:a.blockNumber??head.number,timestamp:head.timestamp-(head.number-(a.blockNumber??head.number))*12n}),getLogs:async(a:any)=>{calls.push(a);if(fail&&calls.length===2)throw Error("provider unavailable");const b=a.toBlock;return [{removed:false,blockNumber:b,blockHash:hash,transactionHash:hash,logIndex:Number(b),args:{id:POOL_ID,amount0:10n**18n,amount1:-(2n*10n**18n),sqrtPriceX96:2n**96n}}]}};
 return{head,calls,reader,client:reader as unknown as PublicClient,setFail:(b:boolean)=>{fail=b}};
}
test("bounded RPC replay uses only exact-pool logs, actual timestamps, signed volumes and extended intervals",async()=>{
 const f=fixture();const pages:ChartHistory[]=[];const data=await readIndexedHistory(14400,new AbortController().signal,p=>pages.push(p),f.client);
 assert.equal(pages.length,3);assert.equal(data.blockCoverage?.from,DEPLOYMENT_BLOCK.toString());assert.equal(data.blockCoverage?.to,f.head.number.toString());assert.equal(data.olderAvailable,false);assert.equal(data.source,"rpc");assert.equal(data.currency,"IMD");assert.equal(data.candles.reduce((n,c)=>n+c.volume,0),6);
 for(const c of f.calls){assert.equal(c.address,POOL_MANAGER);assert.equal(c.args.id,POOL_ID);assert(c.toBlock-c.fromBlock<2000n)}
 assert(data.candles.every(c=>c.open===1&&c.close===1));
});
test("RPC page failure preserves a resumable checkpoint and incrementally reconciles recent logs",async()=>{
 const f=fixture();f.setFail(true);const pages:ChartHistory[]=[];
 await assert.rejects(readIndexedHistory(300,new AbortController().signal,p=>pages.push(p),f.client),/provider unavailable/);
 assert.equal(pages.length,1);const checkpoint=pages[0].blockCoverage!;f.setFail(false);const start=f.calls.length;
 const data=await readIndexedHistory(300,new AbortController().signal,()=>{},f.client);
 assert.equal(f.calls[start].fromBlock,BigInt(checkpoint.to)-11n);assert.equal(data.blockCoverage?.from,DEPLOYMENT_BLOCK.toString());assert.equal(data.olderAvailable,false);
 f.reader.getChainId=async()=>10;await assert.rejects(readIndexedHistory(300,new AbortController().signal,()=>{},f.client),/mainnet/);
});
