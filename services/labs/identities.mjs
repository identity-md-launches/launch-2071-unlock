import { parseAbi, keccak256 } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
import { readFileSync } from 'node:fs';
import { SEEDS } from './catalog.mjs';
import { address, assert } from './security.mjs';
export const EDITORIAL_IDENTITIES=JSON.parse(readFileSync(new URL('./editorial-identities.json',import.meta.url),'utf8'));
export const PINNED_PICKS=Object.freeze({
 ...Object.fromEntries(EDITORIAL_IDENTITIES.records.filter(r=>['ZTO','FREE1376','EMBEO'].includes(r.symbol)).map(r=>[r.address.toLowerCase(),{label:'UNLOCK Pick',sourceUrl:r.sourceUrl}])),
 '0x99fa82b022be4575891a43b757bc770691e18fda':{label:'UNLOCK Pick',sourceUrl:'https://api.imd.fun/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929'},
 '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7':{label:'UNLOCK Pick',sourceUrl:'https://imd.fun/docs/#imd-token'},
 '0x61aaf8a992a3143e2b0c9cb0030b9fe702854a25':{label:'UNLOCK Pick',sourceUrl:'https://etherscan.io/token/0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25'}
});
export const UNRESOLVED_PICKS=Object.entries(EDITORIAL_IDENTITIES.decisions).filter(([k])=>['INFER','OG'].includes(k)).map(([symbol,reason])=>({symbol,reason,candidates:EDITORIAL_IDENTITIES.records.filter(r=>r.symbol===symbol)}));
const AUTHORITY_POLICY=JSON.parse(readFileSync(new URL('./authority-policy.json',import.meta.url),'utf8'));
const IMMUTABLE=parseAbi(['function initialRecipient() view returns(address)','function setupAuthority() view returns(address)']);
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
  const ids=[...(candidate?.launchId?[candidate.launchId]:[]),...SEEDS.records.filter(l=>l.artifacts?.some(a=>a.role==='token'&&a.address.toLowerCase()===token)).map(l=>l.id),...extraLaunchIds];
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
  const policy=AUTHORITY_POLICY.policies.find(p=>p.address===identity.address&&p.launchId===identity.launchId&&p.sourceCommit===record.sourceCommit);
  if(policy){
   assert(identity.requester===policy.requester&&keccak256(code)===policy.runtimeCodeHash,403,'authority_policy_mismatch','Reviewed immutable implementation or registry representative no longer matches. No owner fallback is permitted.');
   if(policy.kind==='unlk-initial-recipient'){const [initial,setup]=await Promise.all([io.read(identity.address,IMMUTABLE,'initialRecipient',[],tag),io.read('0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc',IMMUTABLE,'setupAuthority',[],tag)]);assert(address(initial)===policy.requester&&address(setup)===policy.requester,403,'authority_policy_mismatch','Immutable UNLK allocation/setup authority does not match the reviewed launch representative.');}
   return {authorized:address(representative)===policy.requester,address:identity.address,representative:address(representative),owner:policy.requester,sourceUrl:identity.sourceUrl,deploymentTransaction:identity.txHash,basis:`Reviewed immutable token policy v${AUTHORITY_POLICY.version}: pinned source/runtime, verified launch requester, deployment receipt and signed wallet session`,policySource:policy.sourceUrl,checkedAt:new Date(now()).toISOString()};
  }
  // A revert/empty response is not proof that an owner interface never existed.
  // There is no reviewed non-Ownable authority policy: requester evidence alone grants no rights.
  let owner;
  try{owner=address(await io.read(identity.address,OWNER,'owner',[],tag));}
  catch{assert(false,503,'owner_unavailable','Current project owner could not be verified. Retry when ownership reads are available; requester evidence alone cannot authorize edits.');}
  const basis='Current token owner() plus matching IMD deployment record';
  assert(owner&&BigInt(owner)!==0n,403,'owner_unresolved','Current edit authority is unresolved or ownership was renounced.');
  return {authorized:owner===address(representative),address:identity.address,representative:address(representative),owner,sourceUrl:identity.sourceUrl,deploymentTransaction:identity.txHash,basis,checkedAt:new Date(now()).toISOString()};
 }
 return {recordFor,rights};
}
