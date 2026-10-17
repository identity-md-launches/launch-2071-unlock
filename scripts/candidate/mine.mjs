// Offline CREATE2 mining. All addresses are explicit new-launch inputs; no wallet or environment access.
import fs from "node:fs";
const lock = JSON.parse(fs.readFileSync(new URL("../../web/vendor/runtime/lock.json",import.meta.url),"utf8"));
const {encodeAbiParameters,keccak256,getCreate2Address,isAddress,toHex}=await import(new URL(`../../web/vendor/runtime/${lock.entries.viem}`,import.meta.url));
const args=process.argv.slice(2);
if(args.length!==4)throw new Error("Usage: node scripts/candidate/mine.mjs FACTORY POOL_MANAGER NEW_TOKEN SETUP_AUTHORITY");
const [factory,manager,token,owner]=args;
if(args.some(x=>!isAddress(x)||BigInt(x)===0n)||[factory,manager,token].some(x=>x.toLowerCase()===owner.toLowerCase()))throw new Error("Explicit, distinct, nonzero real launch inputs required");
const artifact=JSON.parse(fs.readFileSync(new URL("../../out/UnlkHookV2.sol/UnlkHookV2.json",import.meta.url),"utf8"));
const words=encodeAbiParameters([{type:"address"},{type:"address"},{type:"address"},{type:"address"}],[manager,token,factory,owner]);
const bytecode=artifact.bytecode.object+words.slice(2);
for(let i=0n;i<1000000n;i++){
  const salt=toHex(i,{size:32}); const address=getCreate2Address({from:factory,salt,bytecode});
  if((BigInt(address)&0x3fffn)!==0x3fc4n)continue;
  console.log(JSON.stringify({status:"prediction only; release blocked",factory,manager,token,owner,flags:16324,salt,predictedAddress:address,initCodeHash:keccak256(bytecode)},null,2));
  process.exit(0);
}
throw new Error("No salt found within bound; extend the search after review");
