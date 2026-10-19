/** Persistent complete-catalog reconstruction, bounded work; no NFT ID sample. */
import {parseAbi,keccak256,stringToHex} from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import {CUSTODY} from './custody.mjs';
import {recentTransfers} from './recent-flows.mjs';
import {takeWork} from './rpc.mjs';
const ZERO='0x0000000000000000000000000000000000000000',TOPIC=keccak256(stringToHex('Transfer(address,address,uint256)'));
const ABI=parseAbi(['function ownerOf(uint256) view returns(address)','function balanceOf(address) view returns(uint256)','function totalSupply() view returns(uint256)']);
const tag=n=>'0x'+BigInt(n).toString(16),addr=t=>'0x'+t.slice(-40).toLowerCase();
export async function deploymentStart(io,store,contract,head){
 const cached=store.get(`deployment:${contract}`);if(cached)return cached;
 if(await io.rpc('eth_getCode',[contract,tag(head)])==='0x')throw Error('Contract absent at confirmed head');
 let lo=0,hi=Number(head);while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(await io.rpc('eth_getCode',[contract,tag(mid)])==='0x')lo=mid;else hi=mid;}
 const [before,code,b]=await Promise.all([io.rpc('eth_getCode',[contract,tag(hi-1)]),io.rpc('eth_getCode',[contract,tag(hi)]),io.rpc('eth_getBlockByNumber',[tag(hi),false])]);
 if(before!=='0x'||code==='0x'||!b?.hash)throw Error('Archive provider cannot prove deployment boundary');
 const evidence={block:hi,blockHash:b.hash,runtimeCodeHash:keccak256(code),basis:'Archive eth_getCode absent at block-1 and present at deployment block',provider:io.provenance?.slice(-3)};store.set(`deployment:${contract}`,evidence);return evidence;
}
export function replayTransfers(state,logs,nft){
 const next=structuredClone(state);
 for(const l of [...logs].filter(l=>!l.removed).sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex)-BigInt(b.logIndex)))){
  if(l.topics?.[0]!==TOPIC)continue;const from=addr(l.topics[1]),to=addr(l.topics[2]);
  if(nft){if(l.topics.length!==4)throw Error('Unexpected NFT Transfer encoding');const id=BigInt(l.topics[3]).toString(),prior=next.owners[id];if(from!==ZERO&&prior!==from)throw Error('NFT ownership replay does not match transfer sender; history incomplete');if(to===ZERO)delete next.owners[id];else next.owners[id]=to;}
  else{const amount=BigInt(l.data);for(const [wallet,delta] of [[from,-amount],[to,amount]]){if(wallet===ZERO)continue;const value=BigInt(next.balances[wallet]||0)+delta;if(value<0n)throw Error('ERC20 transfer replay has negative inventory; history incomplete');next.balances[wallet]=value.toString();}}
 }
 return next;
}
export function createOwnershipIndex({store,io,contract,nft=true,now=()=>Date.now(),pageBlocks=500,maxPages=4}){
 async function refresh({block,blockData}){
  const start=await deploymentStart(io,store,contract,block),key=`ownership:${contract}`;
  const fresh=()=>({version:1,startBlock:start.block,lastBlock:start.block-1,lastHash:null,owners:{},balances:{},events:[],verifiedOwners:{},verifiedBalances:{}});
  let state=store.get(key)||fresh();store.set(key,state);const errors=[];
  if(state.lastHash){const checkpoint=await io.rpc('eth_getBlockByNumber',[tag(state.lastBlock),false]);if(checkpoint?.hash!==state.lastHash){state=fresh();store.set(key,state);}}
  for(let page=0;page<maxPages&&state.lastBlock<Number(block);page++){
   try{const from=state.lastBlock+1,to=Math.min(Number(block),from+pageBlocks-1),logs=await io.rpc('eth_getLogs',[{address:contract,fromBlock:tag(from),toBlock:tag(to),topics:[TOPIC]}]);
   if(!Array.isArray(logs)||logs.length>=10000)throw Error('Ownership page may be truncated. Reduce pageBlocks; cursor retained.');
   const next=replayTransfers(state,logs,nft),end=to===Number(block)?blockData:await io.rpc('eth_getBlockByNumber',[tag(to),false]);
   const times=new Map();const events=[];
   for(const l of logs.filter(l=>!l.removed).slice(-100)){
    if(!times.has(l.blockNumber)){if(times.size>=20)continue;times.set(l.blockNumber,await io.rpc('eth_getBlockByNumber',[l.blockNumber,false]));}
    events.push({id:`${l.transactionHash}:${Number(BigInt(l.logIndex))}`,hash:l.transactionHash,block:Number(BigInt(l.blockNumber)),time:Number(BigInt(times.get(l.blockNumber).timestamp)),token:contract,symbol:nft?'identity.md NFT':'IMD',tokenId:nft?BigInt(l.topics[3]).toString():null,amount:nft?'1':(Number(BigInt(l.data))/1e18).toString(),amountRaw:nft?'1':BigInt(l.data).toString(),type:'transfer',category:nft?'nft':'imd',wallet:null,amountUsd:null,from:addr(l.topics[1]),to:addr(l.topics[2]),attribution:nft?'ERC721 transfer; no sale inferred':'ERC20 transfer; no trade or profit inferred'});
   }
   next.events=[...new Map([...state.events,...events].map(e=>[e.id,e])).values()].sort((a,b)=>b.block-a.block).slice(0,2000);next.lastBlock=to;next.lastHash=end.hash;state=next;store.set(key,state);
   }catch(e){errors.push(`Transfer indexing: ${e.message}`);break;}
  }
  let recent=null;try{recent=await recentTransfers({io,store,contract,nft,block,blockData});}catch(e){errors.push(`Recent flow indexing: ${e.message}`);}
  state.observedIds=[...new Set([...(state.observedIds||[]),...(nft?(recent?.events||[]).map(e=>e.tokenId):[])])];
  let total=null;try{total=(await io.read(contract,ABI,'totalSupply',[],tag(block))).toString();}catch{/* ERC721Enumerable is optional; total remains unknown. */}
  if(nft)for(const id of takeWork(store,`ownerOf:${contract}`,[...new Set([...Object.keys(state.owners),...state.observedIds])],16)){
   try{const owner=(await io.read(contract,ABI,'ownerOf',[BigInt(id)],tag(block))).toLowerCase();state.verifiedOwners[id]={owner,block:Number(block)};}catch(e){delete state.verifiedOwners[id];errors.push(`ownerOf(${id}): ${e.message}`);}
  }
  const candidates=nft?[...new Set([...Object.values(state.owners),...Object.values(state.verifiedOwners).map(v=>v.owner)])]:[...new Set([...Object.keys(state.balances).filter(w=>BigInt(state.balances[w])>0n),...(recent?.events||[]).flatMap(e=>[e.from,e.to]).filter(w=>w!=='0x0000000000000000000000000000000000000000')])];
  for(const wallet of takeWork(store,`balances:${contract}`,candidates,12)){
   try{const balance=await io.read(contract,ABI,'balanceOf',[wallet],tag(block)),code=await io.rpc('eth_getCode',[wallet,tag(block)]);state.verifiedBalances[wallet]={balance:balance.toString(),block:Number(block),custody:CUSTODY[wallet]||(code==='0x'||code.startsWith('0xef0100')?'unattributed account':'contract custody; identity unknown')};}catch(e){delete state.verifiedBalances[wallet];errors.push(`balanceOf(${wallet}): ${e.message}`);}
  }
  store.set(key,state);
  let complete=state.lastBlock===Number(block)&&state.verificationMismatch!==true&&total!==null;const inventory=nft?Object.fromEntries([...new Set(Object.values(state.owners))].map(w=>[w,String(Object.values(state.owners).filter(o=>o===w).length)])):state.balances;
  if(complete&&total!==null){const sum=Object.values(inventory).reduce((n,v)=>n+BigInt(v),0n);if(sum!==BigInt(total)){complete=false;state.verificationMismatch=true;errors.push('Reconstructed inventory does not reconcile to onchain totalSupply; coverage remains partial.');}}
  if(complete&&nft){for(const [id,proof] of Object.entries(state.verifiedOwners)){if(proof.block===Number(block)&&state.owners[id]!==proof.owner){complete=false;state.verificationMismatch=true;errors.push(`Replayed owner disagrees with current ownerOf(${id}); reindex/review is required.`);break;}}}
  if(complete){for(const [wallet,balance] of Object.entries(inventory)){const prior=state.verifiedBalances[wallet];if(prior?.block===Number(block)&&prior.balance!==balance){complete=false;state.verificationMismatch=true;errors.push(`Replayed balance disagrees with current balanceOf for ${wallet}`);break;}}}
  store.set(key,state);
  const displayBalances=complete?Object.fromEntries(Object.entries(inventory).map(([wallet,balance])=>[wallet,{balance,block:Number(block),custody:state.verifiedBalances[wallet]?.custody||'custody unclassified',basis:'Complete Transfer replay reconciled to totalSupply; rotating read verification',readBlock:state.verifiedBalances[wallet]?.block||null}])):state.verifiedBalances;
  const wallets=Object.entries(displayBalances).filter(([,v])=>v.block===Number(block)&&BigInt(v.balance)>0n).sort((a,b)=>BigInt(a[1].balance)>BigInt(b[1].balance)?-1:BigInt(a[1].balance)<BigInt(b[1].balance)?1:a[0].localeCompare(b[0])).map(([wallet,v])=>({address:wallet,category:nft?'nft':'imd',label:CUSTODY[wallet]|| (wallet==='0xfe44fc8f6c32f681a0ce443902a0b08bb5b3c736'?'Declared UNLOCK treasury / NFT inventory':v.custody.startsWith('contract')?v.custody:null),holdings:[{address:contract,symbol:nft?'identity.md NFTs':'IMD',balance:nft?v.balance:decimal(v.balance),usd:null}],netFlow:[],holdingsBlock:v.block,nfts:nft?Object.entries(state.verifiedOwners).filter(([,o])=>o.owner===wallet&&o.block===Number(block)).map(([id])=>({collection:contract,tokenId:id,name:`identity.md #${id}`,evidenceUrl:`https://etherscan.io/nft/${contract}/${id}`})):undefined,source:`Current balanceOf at block ${block}; ${v.custody}. ${v.basis||'balanceOf read'}. ${complete?'Transfer replay reaches checked head.':'Partial ownership discovery; not a global ranking.'}`}));
  const coverage={recent:recent?{fromBlock:recent.fromBlock,toBlock:recent.toBlock,fromTime:recent.fromTime,toTime:recent.toTime,eventCount:recent.events.length,hasOmissions:recent.omitted}:null,contract,startBlock:start.block,toBlock:state.lastBlock,headBlock:Number(block),backlogBlocks:Number(block)-state.lastBlock,complete,indexedIds:nft?new Set([...Object.keys(state.owners),...Object.keys(state.verifiedOwners)]).size:null,replayedIds:nft?Object.keys(state.owners).length:null,totalSupply:total,verifiedIds:nft?Object.values(state.verifiedOwners).filter(v=>v.block===Number(block)).length:null,indexedHolders:candidates.length,verifiedHolders:Object.values(state.verifiedBalances).filter(v=>v.block===Number(block)&&BigInt(v.balance)>0n).length,totalHolders:complete?(nft?new Set(Object.values(state.owners)).size:Object.values(state.balances).filter(v=>BigInt(v)>0n).length):null,ranking:complete?'Complete transfer reconstruction; rotating ownerOf/balanceOf verification':'Partial verified candidates; not a global ranking',deployment:start,errors,provenance:io.provenance?.slice(-8)};
  const result={updatedAt:new Date(now()).toISOString(),block:Number(block),blockTime:Number(BigInt(blockData.timestamp)),coverage,wallets,events:[...new Map([...state.events,...(recent?.events||[])].map(e=>[e.id,e])).values()].sort((a,b)=>b.block-a.block).slice(0,2000)};store.set(`ownership-snapshot:${contract}`,result);return result;
 }
 return {refresh};
}
function decimal(raw){const n=BigInt(raw);return `${n/10n**18n}.${(n%10n**18n).toString().padStart(18,'0')}`;}
