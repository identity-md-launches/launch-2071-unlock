import { parseAbi,parseAbiItem,decodeEventLog,keccak256,stringToHex } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { amountString } from './indexer.mjs';
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
export function createRadarExtensions({store,io,attributions=[],marketplaces=[],now=()=>Date.now()}) {
 let active=null;
 async function refresh() {
  if(active)return active;active=(async()=>{
   if(BigInt(await io.rpc('eth_chainId'))!==1n)throw Error('NFT/public wallet reads require Ethereum');const head=BigInt(await io.rpc('eth_blockNumber')),block=head-12n,tag='0x'+block.toString(16),b=await io.rpc('eth_getBlockByNumber',[tag,false]);
   let state=store.get('nft.index')||{lastBlock:null,lastHash:null,events:[],ids:[]};let from=state.lastBlock===null?Math.max(0,Number(block)-1799):Math.max(0,state.lastBlock-11);
   if(state.lastHash){const prior=await io.rpc('eth_getBlockByNumber',['0x'+BigInt(state.lastBlock).toString(16),false]);if(prior.hash!==state.lastHash){state={lastBlock:null,lastHash:null,events:[],ids:[]};from=Math.max(0,Number(block)-1799);}}
   const to=Math.min(Number(block),from+1799),logs=[];for(let n=from;n<=to;n+=500)logs.push(...await io.rpc('eth_getLogs',[{address:IDENTITY_NFT,fromBlock:'0x'+BigInt(n).toString(16),toBlock:'0x'+BigInt(Math.min(to,n+499)).toString(16),topics:[TOPIC]}]));
   assert(logs.length<10000,503,'nft_page_incomplete','NFT log page may be truncated. Retry with a smaller range.');
   const events=[],blocks=new Map(),receipts=new Map();for(const l of logs.filter(l=>!l.removed).slice(-100)){
    const n=Number(BigInt(l.blockNumber));if(!blocks.has(n)){if(blocks.size>=20)continue;blocks.set(n,await io.rpc('eth_getBlockByNumber',[l.blockNumber,false]));}
    const args=decodeEventLog({abi:[TRANSFER],topics:l.topics,data:l.data,strict:true}).args;const e={id:`${l.transactionHash}:${Number(BigInt(l.logIndex))}`,hash:l.transactionHash,block:n,time:Number(BigInt(blocks.get(n).timestamp)),token:IDENTITY_NFT,symbol:'identity.md NFT',tokenId:args.tokenId.toString(),type:'transfer',category:'nft',amount:'1',amountUsd:null,wallet:null,from:args.from.toLowerCase(),to:args.to.toLowerCase(),attribution:'ERC721 transfer; no purchase/sale is inferred',relatedActivity:'nft-transfer'};
    if(marketplaces.length&&receipts.size<10){if(!receipts.has(e.hash))receipts.set(e.hash,await io.rpc('eth_getTransactionReceipt',[e.hash]));try{const sale=await evidencedNftSale(receipts.get(e.hash),e,marketplaces,io,l.blockNumber);if(sale){e.sale= sale;e.attribution= sale.basis;}}catch{/* retain transfer classification */}}
    events.push(e);
   }
   const cutoff=now()/1000-604800,combined=[...new Map([...state.events.filter(e=>e.block<from&&e.time>=cutoff),...events].map(e=>[e.id,e])).values()].sort((a,b)=>b.time-a.time).slice(0,2000),ids=[...new Set([...events.map(e=>e.tokenId),...state.ids])].slice(0,32),owners=new Map();
   for(const id of ids){try{const owner=(await io.read(IDENTITY_NFT,ABI,'ownerOf',[BigInt(id)],tag)).toLowerCase();if(owner===ZERO)continue;const a=owners.get(owner)||[];a.push(id);owners.set(owner,a);}catch{/* burned/unreadable NFT omitted */}}
   const wallets=[];for(const [owner,owned] of [...owners].slice(0,12)){try{const balance=await io.read(IDENTITY_NFT,ABI,'balanceOf',[owner],tag);wallets.push({address:owner,category:'nft',label:null,holdings:[{address:IDENTITY_NFT,symbol:'identity.md NFTs',balance:balance.toString(),usd:null}],netFlow:[],nfts:owned.map(id=>({collection:IDENTITY_NFT,tokenId:id,name:`identity.md #${id}`,evidenceUrl:`https://etherscan.io/nft/${IDENTITY_NFT}/${id}`})),source:`Current balanceOf at block ${block}; verified ownerOf for sampled IDs. Observed NFT holders, not a global whale ranking.`});}catch{/* unavailable balances are omitted */}}
   for(const a of attributions.slice(0,10)){try{const wallet=a.address.toLowerCase(),[eth,imd,nfts]=await Promise.all([io.rpc('eth_getBalance',[wallet,tag]),io.read(IMD,ABI,'balanceOf',[wallet],tag),io.read(IDENTITY_NFT,ABI,'balanceOf',[wallet],tag)]);wallets.push({address:wallet,label:a.label,category:'public',attributionUrl:a.sourceUrl,holdings:[{address:ZERO,symbol:'ETH',balance:amountString(BigInt(eth)),usd:null},{address:IMD,symbol:'IMD',balance:amountString(imd),usd:null},{address:IDENTITY_NFT,symbol:'identity.md NFTs',balance:nfts.toString(),usd:null}],netFlow:[],source:`Public personal-wallet attribution: ${a.evidence}. This is not a complete portfolio.`});}catch{/* failed public balance read stays unpublished */}}
   const end=to===Number(block)?b:await io.rpc('eth_getBlockByNumber',['0x'+BigInt(to).toString(16),false]);store.set('nft.index',{lastBlock:to,lastHash:end.hash,events:combined,ids});const snapshot={updatedAt:new Date(now()).toISOString(),block:Number(block),events:combined,wallets:wallets.sort((a,b)=>Number(b.holdings[0].balance)-Number(a.holdings[0].balance)),notes:['NFT scan covers at most 1,800 confirmed blocks per refresh; 32 sampled token IDs and 12 holder wallets. Not a global ranking.','NFT purchases/sales require a configured runtime-pinned Seaport venue and matching fulfillment/transfer. Bids, bundles and unsupported venues stay transfers.','Vitalik, CZ and Asem remain unpublished until a reliable reviewed public personal-wallet attribution is configured. Exchange custody is not personal wealth.']};store.set('radar.extra',snapshot);return snapshot;
  })().finally(()=>{active=null;});return active;
 }
 function merge(base){const extra=store.get('radar.extra');return {...base,wallets:[...(base.wallets||[]).map(w=>({...w,category:'imd'})),...(extra?.wallets||[])],nftEvents:extra?.events||[],extraUpdatedAt:extra?.updatedAt||null,coverage:{...base.coverage,notes:[...base.coverage.notes,...(extra?.notes||['NFT and public wallet indexes are not connected; no identities or holdings are invented.'])]},publicIdentityStatus:attributions.map(a=>({label:a.label,sourceUrl:a.sourceUrl})),unresolvedPublicIdentities:['Vitalik','CZ','Asem'].filter(label=>!attributions.some(a=>a.label===label))};}
 return {refresh,merge};
}
