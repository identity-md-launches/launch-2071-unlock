/** Temporary local integration preview. Serves the exact dist bytes under /preview/,
 * except labs-config.json points at the REAL local API. No mock API, paid job or writes. */
import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {createLabsServer} from '../../services/labs/server.mjs';
const previewPort=Number(process.argv[3]||4173),apiPort=Number(process.argv[4]||8787);if(![previewPort,apiPort].every(p=>Number.isInteger(p)&&p>0&&p<=65535))throw Error('Use valid loopback ports.');const root=path.resolve('dist'),origin=`http://127.0.0.1:${previewPort}`;const app=createLabsServer({filename:process.argv[2]||'/tmp/unlock-labs/doctor.sqlite',siteOrigin:origin});
await new Promise(r=>app.server.listen(apiPort,'127.0.0.1',r));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.pdf':'application/pdf'};
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,origin);
 if(u.pathname.startsWith('/api/')){const target=new URL(req.url,`http://127.0.0.1:${apiPort}`),chunks=[];for await(const c of req)chunks.push(c);const r=await fetch(target,{method:req.method,headers:{...(req.headers.origin?{origin:req.headers.origin}:{}),...(req.headers.authorization?{authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
 if(u.pathname==='/preview/labs-config.json'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({apiBase:origin+'/api',status:'Local operator integration preview; real read-only mainnet data, partial coverage.'}));return;}
 if(!u.pathname.startsWith('/preview/')){res.writeHead(404);res.end();return;}const file=path.resolve(root,decodeURIComponent(u.pathname.slice(9))||'index.html');if(!file.startsWith(root+path.sep))throw Error('path');const actual=(await fs.stat(file)).isDirectory()?path.join(file,'index.html'):file;const bytes=await fs.readFile(actual);res.writeHead(200,{'content-type':mime[path.extname(actual)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}});
await new Promise(r=>server.listen(previewPort,'127.0.0.1',r));console.log('Temporary REAL backend integration preview: '+origin+'/preview/#labs-markets; background jobs are off.');
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{server.close();app.close();});
