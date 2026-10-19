import { parseAbi } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { address, assert } from './security.mjs';
export const PINNED_PICKS=Object.freeze({
 '0x99fa82b022be4575891a43b757bc770691e18fda':{label:'UNLOCK Pick',sourceUrl:'https://api.imd.fun/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929'},
 '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7':{label:'UNLOCK Pick',sourceUrl:'https://imd.fun/docs/#imd-token'},
 '0x61aaf8a992a3143e2b0c9cb0030b9fe702854a25':{label:'UNLOCK Pick',sourceUrl:'https://etherscan.io/token/0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'}
});
export const UNRESOLVED_PICKS=['INFER','ZTO','free1376','OG','EMBEO'];
const OWNER=parseAbi(['function owner() view returns (address)']);
/** The candidate's identity comes from a chain/address artifact, never its symbol. */
export function deploymentIdentity(record,tokenAddress) {
 const token=address(tokenAddress),artifact=record?.artifacts?.find(a=>a.role==='token'&&a.address?.toLowerCase()===token);
 assert(record?.chainId===1&&record.status==='live'&&artifact&&/^0x[\da-f]{64}$/i.test(artifact.txHash||'')&&Number.isSafeInteger(artifact.blockNumber)&&artifact.blockNumber>0&&/^[\da-f-]{36}$/i.test(record.id||''),422,'identity_unresolved','No live authoritative IMD deployment record binds this chain and token address.');
 return {verified:true,chainId:1,address:token,sourceUrl:`https://api.imd.fun/launches/${record.id}`,launchId:record.id,txHash:artifact.txHash,block:artifact.blockNumber,requester:record.requester?address(record.requester):null};
}
export function createIdentityResolver({store,io,now=()=>Date.now(),extraLaunchIds=[]}) {
 async function recordFor(token) {
  token=address(token);const registry=store.get('markets.registry');const candidate=registry?.tokens?.find(t=>t.address===token);
  const ids=[...(candidate?.launchId?[candidate.launchId]:[]),...(token==='0x99fa82b022be4575891a43b757bc770691e18fda'?['0528a007-5ec6-4acd-b9cc-b3ded6fe2929']:[]),...extraLaunchIds];
  for(const id of [...new Set(ids)].slice(0,30)) {
   if(!/^[\da-f-]{36}$/i.test(id))continue;let record=store.get(`identity:${id}`);
   if(!record||now()-record.at>300000){const data=await io.json(`https://api.imd.fun/launches/${id}`);record={at:now(),data:data.launch||data};store.set(`identity:${id}`,record);}
   try {const identity=deploymentIdentity(record.data,token);return {record:record.data,identity};}catch{/* an unrelated record grants no rights */}
  }
  assert(false,422,'identity_unresolved','This address has no verified project record in the bounded registry. Configure its authoritative IMD launch ID; a symbol or connected wallet is insufficient.');
 }
 async function rights(token,representative) {
  const {record,identity}=await recordFor(token),tag='latest';
  const [receipt,code]=await Promise.all([io.rpc('eth_getTransactionReceipt',[identity.txHash]),io.rpc('eth_getCode',[identity.address,tag])]);
  assert(receipt?.status==='0x1'&&Number(BigInt(receipt.blockNumber))===identity.block&&code!=='0x',422,'deployment_unverified','Deployment receipt/code does not match the authoritative project record.');
  let owner=identity.requester,basis='Authoritative IMD project requester and successful deployment receipt';
  try{owner=address(await io.read(identity.address,OWNER,'owner',[],tag));basis='Current token owner() plus matching IMD deployment record';}catch{/* non-Ownable tokens use evidenced project requester, never transaction.from factory custody */}
  assert(owner&&BigInt(owner)!==0n,403,'owner_unresolved','Current edit authority is unresolved or ownership was renounced.');
  return {authorized:owner===address(representative),address:identity.address,representative:address(representative),owner,sourceUrl:identity.sourceUrl,deploymentTransaction:identity.txHash,basis,checkedAt:new Date(now()).toISOString()};
 }
 return {recordFor,rights};
}
