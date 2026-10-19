/** Strict PNG cache: validates decompressed pixels, removes every ancillary chunk. */
import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { assert } from './security.mjs';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),8+data.length);return out;}
export function sanitizePng(input,{width=1200,height=400,maxBytes=300000}={}) {
 const b=Buffer.from(input);assert(b.length<=maxBytes&&b.subarray(0,8).equals(signature),422,'invalid_image','Use a PNG within the stated byte limit.');
 let at=8,header=null,ended=false;const payload=[];
 while(at+12<=b.length){const n=b.readUInt32BE(at),type=b.toString('ascii',at+4,at+8);assert(n<=maxBytes&&at+12+n<=b.length,422,'invalid_image','PNG chunk is invalid.');const data=b.subarray(at+8,at+8+n);assert(crc(b.subarray(at+4,at+8+n))===b.readUInt32BE(at+8+n),422,'invalid_image','PNG checksum is invalid.');
  if(!header)assert(type==='IHDR',422,'invalid_image','PNG header must be first.');
  if(type==='IHDR'){assert(!header&&n===13,422,'invalid_image','PNG header is invalid.');header=Buffer.from(data);const w=data.readUInt32BE(0),h=data.readUInt32BE(4);assert(w>0&&h>0&&w<=width&&h<=height&&data[8]===8&&[2,6].includes(data[9])&&data[10]===0&&data[11]===0&&data[12]===0,422,'image_dimensions',`Use an 8-bit RGB/RGBA, non-interlaced PNG up to ${width} × ${height}.`);}
  else if(type==='IDAT')payload.push(data);
  else if(type==='IEND'){assert(n===0,422,'invalid_image','PNG end is invalid.');ended=true;at+=12;break;}
  else assert(type[0]===type[0].toLowerCase(),422,'invalid_image','Unsupported critical PNG chunk.');
  at+=12+n;
 }
 assert(header&&ended&&at===b.length&&payload.length>0,422,'invalid_image','Incomplete PNG.');
 const row=header.readUInt32BE(0)*(header[9]===6?4:3)+1,expected=row*header.readUInt32BE(4);let pixels;
 try{pixels=inflateSync(Buffer.concat(payload),{maxOutputLength:expected});}catch{assert(false,422,'invalid_image','PNG compressed pixels are invalid.');}
 assert(pixels.length===expected,422,'invalid_image','PNG pixel length is invalid.');for(let n=0;n<pixels.length;n+=row)assert(pixels[n]<=4,422,'invalid_image','PNG filter is invalid.');
 return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export function imageData(value,kind='logo') {
 if(!value)return '';assert(typeof value==='string'&&value.startsWith('data:image/png;base64,')&&value.length<410000,422,'invalid_image','Submit a PNG image under 300 KB.');
 const b=sanitizePng(Buffer.from(value.slice(22),'base64'),kind==='logo'?{width:512,height:512}:{});return `data:image/png;base64,${b.toString('base64')}`;
}
export function createMediaCache({store,fetchImpl=fetch,now=()=>Date.now()}) {
 async function cacheLogo(token,sourceUrl) {
  if(!token.identity?.verified||!/^0x[\da-f]{40}$/i.test(token.address))return null;
  const key=`logo:${token.address.toLowerCase()}`,old=store.get(key);if(old&&now()-old.at<86400000)return `/media/1/${token.address.toLowerCase()}/logo.png`;
  const u=new URL(sourceUrl);assert(u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&['api.imd.fun','imd.fun','explorer.imd.fun'].includes(u.hostname),422,'unsafe_image_source','Only verified official IMD image sources are fetched.');
  const r=await fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(12000)});assert(r.ok,422,'image_unavailable','IMD logo is unavailable.');let bytes=0;const chunks=[];for await(const c of r.body){bytes+=c.length;assert(bytes<=300000,422,'image_too_large','Logo exceeds 300 KB.');chunks.push(c);}const png=sanitizePng(Buffer.concat(chunks),{width:512,height:512});store.set(key,{at:now(),png:png.toString('base64'),hash:createHash('sha256').update(png).digest('hex')});return `/media/1/${token.address.toLowerCase()}/logo.png`;
 }
 return {cacheLogo,get:token=>{const x=store.get(`logo:${token.toLowerCase()}`);return x?Buffer.from(x.png,'base64'):null;}};
}
