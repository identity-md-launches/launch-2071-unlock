import test from "node:test";
import assert from "node:assert/strict";
import { NEXT_THRESHOLDS, NEXT_RATES, fee75, buyPoolInput, sellGrossOutput, candidateQuota, CANDIDATE_DEPLOYMENT } from "../src/candidate";
import { publicHttps, safeSvg, decodeData, cursorParams, metadataImage, fetchBounded, MAX_METADATA } from "../src/nftSafety";
import { verifyInventoryPage, inventoryIsStale } from "../src/nftInventory";
import { NFT_COLLECTION, NFT_BENEFICIARY } from "../src/candidate";
import fs from "node:fs";
import { readCandidate } from "../src/candidateReader";
import { keccak256, type PublicClient } from "viem";
import type { CandidateDeployment } from "../src/candidate";
import { UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODEHASH, successorFee } from "../src/candidate";

test("successor fee: ETH in every standard mode, fee base is the executed pool ETH leg", () => {
  const a=successorFee("buyExactIn",10n**18n); assert.equal(a.poolLeg+a.fee,10n**18n); assert.ok(a.fee>=fee75(a.poolLeg)&&a.fee<=fee75(a.poolLeg)+1n);
  const b=successorFee("buyExactOut",10n**18n); assert.equal(b.fee,75n*10n**14n); assert.equal(b.trader,10n**18n+b.fee);
  const c=successorFee("sellExactIn",10n**18n); assert.equal(c.trader,10n**18n-c.fee);
  const d=successorFee("sellExactOut",10n**18n); assert.equal(d.poolLeg-d.fee,10n**18n); assert.ok(d.fee>=fee75(d.poolLeg)&&d.fee<=fee75(d.poolLeg)+1n);
  assert.throws(()=>successorFee("buyExactIn",-1n));
});

test("candidate stays undeployed and has all sixteen tiers, separate from the live rules", () => {
  assert.equal(CANDIDATE_DEPLOYMENT, null);
  assert.equal(NEXT_THRESHOLDS.length,16); assert.equal(NEXT_THRESHOLDS[15],50000000);
  assert.equal(NEXT_RATES[0],2000); assert.equal(NEXT_RATES[16],10000);
  for(let i=1;i<NEXT_RATES.length;i++) assert.equal(NEXT_RATES[i]-NEXT_RATES[i-1],500);
  assert.equal(candidateQuota(100n,0n,0n,9500n,false),0n);
  assert.equal(candidateQuota(100n,0n,0n,10000n,true),100n);
  assert.equal(candidateQuota(100n,101n,20n,2000n,false),0n);
});
test("fee-inclusive buy and net exact-output sell preserve wei rounding", () => {
  for(let i=0n;i<30000n;i++) {
    const base=buyPoolInput(i);assert.ok(base+fee75(base)<=i);assert.ok(base+1n+fee75(base+1n)>i);
    const gross=sellGrossOutput(i);assert.equal(gross-fee75(gross),i);
    if(gross)assert.ok(gross-1n-fee75(gross-1n)<i);
  }
  assert.throws(()=>fee75(-1n)); assert.throws(()=>candidateQuota(1n,1n,0n,10001n,false));
});
test("metadata URLs reject executable, private, credentialed and ambiguous schemes", () => {
  for(const uri of ["javascript:alert(1)","http://example.com/a","https://localhost/a","https://127.0.0.1/a","https://2130706433/a","https://[::1]/a","https://host.internal/a","https://a:b@example.com/a","https://example.com:8080/a","file:///x","data:text/html,x"])assert.throws(()=>publicHttps(uri),uri);
  assert.equal(publicHttps("https://example.com/nft.json"),"https://example.com/nft.json");
  assert.equal(publicHttps("ipfs://QmYwAPJzv5CZsnAzt8auVZRnYVmrZJkYX1h8FhE7QyQ5KF/a.json"),"https://ipfs.io/ipfs/QmYwAPJzv5CZsnAzt8auVZRnYVmrZJkYX1h8FhE7QyQ5KF/a.json");
});
test("SVG is inert image content and rejects active/external references", () => {
  assert.match(safeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),/^<svg/);
  for(const svg of ['<svg onload="x()"/>','<svg><script>x()</script></svg>','<svg><foreignObject/></svg>','<svg><image href="https://example.com/x"/></svg>','<svg><use href="#x"/></svg>','<svg><style>@import "x";</style></svg>','<!DOCTYPE svg><svg/>'])assert.throws(()=>safeSvg(svg));
  assert.deepEqual(JSON.parse(decodeData('data:application/json;base64,eyJpbWFnZSI6IngifQ==',"application/json",1024)),{image:"x"});
  assert.throws(()=>decodeData('data:text/html,x',"application/json",1024));
  assert.throws(()=>decodeData('data:application/json,'+"x".repeat(3000),"application/json",1024));
});
test("index cursors cannot redirect requests or inject objects", () => {
  assert.deepEqual(cursorParams({id:"1116",items_count:50}),{id:"1116",items_count:"50"});
  assert.equal(cursorParams(null),null);
  assert.throws(()=>cursorParams({next:{url:"https://evil.example"}}));
  assert.throws(()=>cursorParams({"../next":"bad"}));
});
test("metadata and resource failures are visible, never unsafe fallback content", async () => {
  await assert.rejects(metadataImage('data:application/json,%7B%7D',new AbortController().signal));
  await assert.rejects(metadataImage('data:application/json,%7B%22image%22:%22javascript:alert(1)%22%7D',new AbortController().signal));
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response("no",{status:503});
    await assert.rejects(fetchBounded("https://example.com/a",10,new AbortController().signal),/HTTP 503/);
    globalThis.fetch=async()=>new Response("x".repeat(100),{status:200});
    await assert.rejects(fetchBounded("https://example.com/a",10,new AbortController().signal),/too large/);
    globalThis.fetch=async()=>new Response('{"image":"data:image/svg+xml,%3Csvg%3E%3Cscript%3Ex()%3C/script%3E%3C/svg%3E"}');
    await assert.rejects(metadataImage("https://example.com/metadata",new AbortController().signal),/SVG/);
  } finally { globalThis.fetch=original; }
});

test("indexed inventory is paginated discovery; only current onchain owners appear", async () => {
  const page={items:[{id:"1116",token:{address_hash:NFT_COLLECTION}},{id:"1116",token:{address_hash:NFT_COLLECTION}},
    {id:"1181",token:{address_hash:NFT_COLLECTION}},{id:"44",token:{address_hash:"unrelated collection"}}]};
  let calls=0;
  const rows=await verifyInventoryPage(page,123n,async id=>id===1116n?NFT_BENEFICIARY:"new owner",async()=>{calls++;return "data:application/json,%7B%7D";},new AbortController().signal);
  assert.equal(rows.length,1);assert.equal(rows[0].id,"1116");assert.equal(calls,1);assert.equal(rows[0].block,123n);
  assert.equal(inventoryIsStale(rows,rows[0].readAt+60001),true);
  assert.equal(inventoryIsStale(rows,rows[0].readAt+60000),false);
  await assert.rejects(verifyInventoryPage(page,123n,async()=>{throw new Error("RPC unavailable");},async()=>"",new AbortController().signal),/RPC/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(verifyInventoryPage(page,123n,async()=>NFT_BENEFICIARY,async()=>"",abort.signal),/cancelled/);
  await assert.rejects(verifyInventoryPage({items:[{id:"-1",token:{address_hash:NFT_COLLECTION}}]},123n,async()=>NFT_BENEFICIARY,async()=>"",new AbortController().signal),/id/);
});

test("recorded authentic mainnet tokenURI images #1116 and #1181 render as inert blobs offline", async () => {
  const record=JSON.parse(fs.readFileSync("../docs/candidate/network/nft-ownership.json","utf8"));
  for(const holding of record.items) {
    assert.equal(holding.owner,NFT_BENEFICIARY);
    assert.ok(holding.tokenURI.startsWith("data:application/json;base64,"));
    const blob=await metadataImage(holding.tokenURI,new AbortController().signal);
    assert.equal(blob.type,"image/svg+xml");assert.ok(blob.size>100);
  }
});

test("future candidate reads refuse absent deployment, wrong chain and wrong code", async () => {
  await assert.rejects(readCandidate(null,{} as PublicClient),/not deployed/);
  const fixture: CandidateDeployment={chainId:11155111,token:"0x1111111111111111111111111111111111111111",hook:"0x2222222222222222222222222222222222222222",vault:"0x4444444444444444444444444444444444444444",runtimeHashes:{token:keccak256("0x6000"),hook:keccak256("0x6000"),vault:keccak256("0x6000")}};
  await assert.rejects(readCandidate(fixture,{getChainId:async()=>1} as unknown as PublicClient),/Sepolia/);
  await assert.rejects(readCandidate(fixture,{getChainId:async()=>11155111,getBlockNumber:async()=>123n,getBytecode:async()=>"0x"} as unknown as PublicClient),/hash mismatch/);
});

test("future reader separates donations, earned funds and unavailable oracle data", async () => {
  const fixture: CandidateDeployment={chainId:11155111,token:"0x1111111111111111111111111111111111111111",hook:"0x2222222222222222222222222222222222222222",vault:"0x4444444444444444444444444444444444444444",runtimeHashes:{token:keccak256("0x6000"),hook:keccak256("0x6000"),vault:keccak256("0x6000")}};
  const values: Record<string,unknown>={activated:true,token:fixture.token,UNIVERSAL_ROUTER,nftFeeVault:fixture.vault,
    oracle:fixture.hook,poolManager:"0x3333333333333333333333333333333333333333",FEE:12500,FLAGS:0x3fcc,p:2000,tier:0,fullyUnlocked:false,
    BENEFICIARY:NFT_BENEFICIARY,hook:fixture.hook,totalAccrued:100n,totalRedeemed:70n,totalWithdrawn:20n,
    claimable:50n,pendingClaims:30n,donations:10n,donationsWithdrawn:3n,balanceOf:80n,eligible:100n,sold:5n,remainingQuota:15n};
  const routerRuntime=("0x"+fs.readFileSync("../docs/candidate/network/router.runtime.hex","utf8").trim().replace(/^0x/,"")) as `0x${string}`;
  assert.equal(keccak256(routerRuntime),UNIVERSAL_ROUTER_CODEHASH);
  const client={getChainId:async()=>11155111,getBlockNumber:async()=>123n,
    getBytecode:async({address}:{address:string})=>address.toLowerCase()===UNIVERSAL_ROUTER?routerRuntime:"0x6000",
    readContract:async({functionName}:{functionName:string})=>{if(functionName==="fdvUsd")throw new Error("stale oracle");return values[functionName];}} as unknown as PublicClient;
  const snapshot=await readCandidate(fixture,client,NFT_BENEFICIARY);
  assert.equal(snapshot.fdv,null);assert.match(snapshot.oracleError??"",/unavailable/);
  assert.equal(snapshot.wallet?.sellable,15n);assert.equal(snapshot.vault.accrued,100n);
  assert.equal(snapshot.vault.donations,10n);assert.equal(snapshot.vault.claimable,50n);
  values.remainingQuota=16n;
  await assert.rejects(readCandidate(fixture,client,NFT_BENEFICIARY),/quota does not match/);
  values.remainingQuota=15n;
  values.claimable=51n;
  await assert.rejects(readCandidate(fixture,client),/inconsistent/);
});
