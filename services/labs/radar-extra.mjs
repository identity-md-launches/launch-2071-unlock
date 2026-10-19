import { parseAbi,parseAbiItem,decodeEventLog,keccak256,stringToHex } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { amountString } from './indexer.mjs';
import { CUSTODY } from './custody.mjs';
import { createOwnershipIndex } from './ownership.mjs';
import { assert } from './security.mjs';
export const IDENTITY_NFT='0x0000ec93127baa929e58e97dd0095a2bfb38ec1d';
const IMD='0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7',ZERO='0x0000000000000000000000000000000000000000';
const ABI=parseAbi(['function balanceOf(address) view returns (uint256)','function ownerOf(uint256) view returns (address)']);
const TRANSFER=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)');
const TOPIC=keccak256(stringToHex('Transfer(address,address,uint256)'));
const FULFILLED=parseAbiItem('event OrderFulfilled(bytes32 orderHash,address indexed offerer,address indexed zone,address recipient,(uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer,(uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)');
/** Only a runtime-pinned Seaport listing fill with the matching NFT Transfer is a sale. */
export async function evidencedNftSale(receipt,nft,marketplaces,io,blockTag) {
 for(const log of receipt.logs||[]) {
  const venue=marketplaces.find(m=>m.address.toLowerCase()===log.address.toLowerCase());if(!venue)continue;
  const code=await io.rpc('eth_getCode',[venue.address,blockTag]);if(keccak256(code)!==venue.runtimeCodeHash)continue;
  try{const e=decodeEventLog({abi:[FULFILLED],data:log.data,topics:log.topics,strict:true}).args;
   if(e.offer.length!==1||e.offer[0].itemType!==2||e.offer[0].token.toLowerCase()!==IDENTITY_NFT||e.offer[0].identifier!==BigInt(nft.tokenId)||e.offer[0].amount!==1n||e.offerer.toLowerCase()!==nft.from||e.recipient.toLowerCase()!==nft.to||!e.consideration.length||e.consideration.some(c=>c.itemType!==0||c.token.toLowerCase()!==ZERO))continue;
   const total=e.consideration.reduce((s,c)=>s+c.amount,0n);if(total<=0n)continue;
   return {type:'nft-sale',seller:nft.from,buyer:nft.to,amountEth:amountString(total),venue:venue.address,sourceUrl:venue.sourceUrl,basis:'Verified Seaport OrderFulfilled listing + exact ERC721 Transfer; total native consideration includes fees'};
  }catch{/* unsupported/bid/bundle fills remain transfers */}
 }
 return null;
}
export function createRadarExtensions({store,io,whaleIo=io,attributions=[],marketplaces=[],now=()=>Date.now()}) {
 const nftIndex=createOwnershipIndex({store,io,contract:IDENTITY_NFT,nft:true,now});
 const whaleIndex=createOwnershipIndex({store,io:whaleIo,contract:IMD,nft:false,now});
 async function confirmed(client){client.reset?.();if(BigInt(await client.rpc('eth_chainId'))!==1n)throw Error('Radar requires Ethereum');const block=BigInt(await client.rpc('eth_blockNumber'))-12n,blockData=await client.rpc('eth_getBlockByNumber',['0x'+block.toString(16),false]);const age=now()-Number(BigInt(blockData.timestamp))*1000;if(age>600000||age< -30000)throw Error('Radar confirmed block is stale or from the future');return {block,blockData};}
 async function refresh(){
  try{const result=await nftIndex.refresh(await confirmed(io));
   for(const event of result.events.slice(0,10)){if(!marketplaces.length)break;try{const receipt=await io.rpc('eth_getTransactionReceipt',[event.hash]);const sale=await evidencedNftSale(receipt,event,marketplaces,io,'0x'+BigInt(event.block).toString(16));if(sale)event.sale=sale;}catch{/* a decoding failure never implies a sale */}}
   const publicWallets=[];for(const a of attributions){try{const tag='0x'+BigInt(result.block).toString(16),[eth,imd,nfts]=await Promise.all([io.rpc('eth_getBalance',[a.address,tag]),io.read(IMD,ABI,'balanceOf',[a.address],tag),io.read(IDENTITY_NFT,ABI,'balanceOf',[a.address],tag)]);publicWallets.push({address:a.address,label:a.label,category:'public',attributionUrl:a.sourceUrl,holdings:[{address:ZERO,symbol:'ETH',balance:amountString(BigInt(eth)),usd:null},{address:IMD,symbol:'IMD',balance:amountString(imd),usd:null},{address:IDENTITY_NFT,symbol:'identity.md NFTs',balance:nfts.toString(),usd:null}],netFlow:[],source:`${a.custody}: ${a.evidence}. Attribution is public evidence, not proof of sole control.`});}catch(e){result.coverage.errors.push(`Public balance: ${e.message}`);}}
   store.set('radar.extra',{...result,wallets:[...result.wallets,...publicWallets]});return result;
  }catch(e){store.set('queue-error:nft',{error:e.message,at:new Date(now()).toISOString()});throw e;}
 }
 async function refreshWhales(){try{const result=await whaleIndex.refresh(await confirmed(whaleIo));store.set('radar.whales',result);return result;}catch(e){store.set('queue-error:whales',{error:e.message,at:new Date(now()).toISOString()});throw e;}}
 function merge(base,{cursor=null}={}){
  const extra=store.get('radar.extra'),whales=store.get('radar.whales'),end=now()/1000,seconds={'1h':3600,'24h':86400,'7d':604800}[base.period]||86400;
  const whaleEvents=(whales?.events||[]).filter(e=>e.time>=end-seconds);
  const indexed=(store.get('radar.snapshot')?.events||base.events||[]).filter(e=>e.time>=end-seconds);const merged=[...new Map([...whaleEvents,...indexed].map(e=>[e.id,e])).values()].sort((a,b)=>b.time-a.time||(b.logIndex||0)-(a.logIndex||0)).slice(0,10000),offset=Number(cursor||0),pageSize=100;
  const wallets=[...(whales?.wallets||[]),...(extra?.wallets||[])].map(w=>({...w,netFlow:w.category==='imd'?[{address:IMD,chainId:1,symbol:'IMD',amount:amountString(whaleEvents.reduce((n,e)=>n+(e.to===w.address?BigInt(e.amountRaw):0n)-(e.from===w.address?BigInt(e.amountRaw):0n),0n))}]:[],netFlowBasis:'Indexed transfers in covered period; incomplete periods are not total flows'}));
  const latestEvidence=Math.max(Number(base.coverage?.toTime)||0,whales?.blockTime||0,extra?.blockTime||0,...(whales?.events||[]).map(e=>Number(e.time)||0));
  const pending=['nft','whales','history','markets'].map(k=>store.get(`queue-error:${k}`)).filter(Boolean);
  return {...base,wallets:wallets.filter(w=>!CUSTODY[w.address]),custodyWallets:wallets.filter(w=>CUSTODY[w.address]),events:merged.slice(offset,offset+pageSize),nextCursor:offset+pageSize<merged.length?String(offset+pageSize):null,totalEvents:merged.length,nftEvents:extra?.events||[],extraUpdatedAt:extra?.updatedAt||null,nftCoverage:extra?.coverage||null,whaleCoverage:whales?.coverage||null,errors:[...(base.errors||[]),...pending.map(e=>`${e.at}: ${e.error}`)],coverage:{...base.coverage,toTime:latestEvidence||null,toBlock:Math.max(base.coverage?.toBlock||0,whales?.coverage?.recent?.toBlock||0)||null,intervals:{history:base.coverage?.recentIntervals||[],imdRecent:whales?.coverage?.recent||null},notes:[...(base.coverage?.notes||[]),'NFT ownership and IMD whale transfer reconstruction use independent persistent queues and budgets. Rankings remain partial until full coverage and balance verification.','Transfers are not NFT sales. Only verified runtime-pinned Seaport native listing fills are decoded; other fills remain transfers.']},publicIdentityStatus:attributions.map(a=>({label:a.label,custody:a.custody,sourceUrl:a.sourceUrl})),unresolvedPublicIdentities:['Vitalik','CZ','Asem'].filter(label=>!attributions.some(a=>a.label===label&&a.custody==='personal'))};
 }
 return {refresh,refreshWhales,merge};
}
