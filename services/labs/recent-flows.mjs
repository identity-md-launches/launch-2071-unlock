import {keccak256,stringToHex} from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
const TOPIC=keccak256(stringToHex('Transfer(address,address,uint256)')),tag=n=>'0x'+BigInt(n).toString(16),addr=t=>'0x'+t.slice(-40).toLowerCase();
/** Independent recent lane keeps current evidence moving while archives backfill.
 * This lane never certifies full ownership, history, cost basis or zero activity. */
export async function recentTransfers({io,store,contract,nft,block,blockData,maxLogs=500}){
 const key=`recent-transfers:${contract}`;let old=store.get(key),from=old?Math.max(old.fromBlock,old.toBlock-11):Math.max(0,Number(block)-499),to=Math.min(Number(block),from+499);
 if(old?.lastHash){const b=await io.rpc('eth_getBlockByNumber',[tag(old.toBlock),false]);if(b?.hash!==old.lastHash){old=null;from=Math.max(0,Number(block)-499);}to=Math.min(Number(block),from+499);}
 const logs=await io.rpc('eth_getLogs',[{address:contract,fromBlock:tag(from),toBlock:tag(to),topics:[TOPIC]}]);if(logs.length>=10000)throw Error('Recent transfer page may be truncated');
 const blocks=new Map(),events=[];const selected=logs.filter(l=>!l.removed).slice(-maxLogs);let omitted=selected.length<logs.length;
 for(const l of selected){const n=Number(BigInt(l.blockNumber));if(!blocks.has(n)){if(blocks.size>=60){omitted=true;continue;}blocks.set(n,n===Number(block)?blockData:await io.rpc('eth_getBlockByNumber',[l.blockNumber,false]));}
  if(nft&&l.topics.length!==4)continue;events.push({id:`${l.transactionHash}:${Number(BigInt(l.logIndex))}`,hash:l.transactionHash,block:n,blockHash:blocks.get(n).hash,logIndex:Number(BigInt(l.logIndex)),time:Number(BigInt(blocks.get(n).timestamp)),token:contract,symbol:nft?'identity.md NFT':'IMD',tokenId:nft?BigInt(l.topics[3]).toString():null,amount:nft?'1':decimal(l.data),amountRaw:nft?'1':BigInt(l.data).toString(),type:'transfer',category:nft?'nft':'imd',wallet:null,amountUsd:null,from:addr(l.topics[1]),to:addr(l.topics[2]),attribution:nft?'ERC721 transfer; no sale inferred':'Indexed IMD transfer; no trade, identity or profit inferred'});
 }
 const end=to===Number(block)?blockData:await io.rpc('eth_getBlockByNumber',[tag(to),false]),combined=[...new Map([...(old?.events||[]).filter(e=>e.block<from),...events].map(e=>[e.id,e])).values()].filter(e=>e.time>Date.now()/1000-604800).sort((a,b)=>b.block-a.block).slice(0,2000);
 const startBlock=old?.fromTime?null:await io.rpc('eth_getBlockByNumber',[tag(old?.fromBlock??from),false]);
 const result={fromTime:old?.fromTime||Number(BigInt(startBlock.timestamp)),toTime:Number(BigInt(end.timestamp)),fromBlock:old?Math.min(old.fromBlock,from):from,toBlock:to,lastHash:end.hash,events:combined,omitted:omitted||old?.omitted===true,complete:false,basis:'Recent lane only; archive and ownership completeness are independent'};store.set(key,result);return result;
}
function decimal(raw){const n=BigInt(raw);return `${n/10n**18n}.${(n%10n**18n).toString().padStart(18,'0')}`;}
