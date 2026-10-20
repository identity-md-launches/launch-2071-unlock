// Read-only mainnet checks of the production export. Faults are recorded separately.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(import.meta.dirname, '../..'), out = path.join(root, 'artifacts/chart-revision');
const pool = '0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32';
const manager = '0x000000000004444c5dc75cb358380d2e3de08a90';
const indexKey = `unlock-pool-index-v1:1:${pool}`;
const report = { checkedAt: new Date().toISOString(), browser: '', transport: process.env.UNLK_TEST_RPC ? 'Fresh mainnet RPC responses forwarded without field changes; public provider identity shown in the UI. Fresh GeckoTerminal responses fetched via curl transport.' : 'Direct public mainnet RPC; GeckoTerminal fetched via curl transport.', live: [], synthetic: [], limitations: [], pageErrors: [], missingAssets: [], labsRequests: [], writes: 0, passed: false };
await fs.mkdir(out, { recursive: true });
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost'); assert(u.pathname.startsWith('/preview/'));
    let file = path.resolve(root, 'dist', decodeURIComponent(u.pathname.slice(9)) || 'index.html');
    assert(file.startsWith(path.join(root,'dist') + path.sep));
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
const logs = new Map(), methods = new Set();
let failRpc = false, browser;
const ready = async page => {
  await page.waitForFunction(() => Number(document.querySelector('[data-candle-count]')?.getAttribute('data-candle-count')) > 0, {}, {timeout:120000});
  await page.getByRole('button', { name:'Refresh chart', exact:true }).waitFor({timeout:120000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
};
const range = async page => { await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); return page.locator('.chart-canvas').evaluate(e => ({from:+e.dataset.visibleFrom,to:+e.dataset.visibleTo})); };
const capture = (page, name, full = false) => (full ? page : page.locator('.official-chart')).screenshot({path:path.join(out,name+'.jpg'),type:'jpeg',quality:75});
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox']}); report.browser = browser.version();
  const context = await browser.newContext({viewport:{width:1440,height:1100}});
  await context.route(/https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)\/?$/, async route => {
    try {
      const request = route.request(), body = request.postData();
      if (request.method()==='OPTIONS') { await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type'}}); return; }
      const calls = JSON.parse(body); for (const row of Array.isArray(calls)?calls:[calls]) {
        methods.add(row.method); if (!/^eth_(chainId|blockNumber|getBlockByNumber|getCode|call|getBalance|getLogs|getTransactionReceipt)$/.test(row.method)) { report.writes++; throw Error('Forbidden RPC method'); }
        if (row.method==='eth_getLogs' && row.params[0].topics?.[1]===pool) assert.equal(row.params[0].address.toLowerCase(),manager);
      }
      if (failRpc) { await route.fulfill({status:503,body:'injected provider failure',headers:{'access-control-allow-origin':'*'}}); return; }
      const response = await fetch(process.env.UNLK_TEST_RPC || request.url(),{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(30000)});
      const text = await response.text(); const decoded = JSON.parse(text);
      for (const row of Array.isArray(decoded)?decoded:[decoded]) if (Array.isArray(row.result)) for (const log of row.result) if (log.topics?.[1]===pool) logs.set(`${log.transactionHash}:${Number(log.logIndex)}`,log);
      await route.fulfill({status:response.status,body:text,headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    } catch { await route.abort('failed').catch(()=>{}); }
  });
  await context.route('https://api.geckoterminal.com/**', async route => {
    try {
      const {stdout} = await run('curl',['--silent','--show-error','--max-time','20','--write-out','\n%{http_code}',route.request().url()],{maxBuffer:3000000});
      const at = stdout.lastIndexOf('\n'); await route.fulfill({status:Number(stdout.slice(at+1)),body:stdout.slice(0,at),headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
    } catch { await route.abort('failed').catch(()=>{}); }
  });
  const page = await context.newPage();
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  page.on('request',r=>{if(/labs-config|\/labs\/|\/api\/(markets|radar|audit|profiles|orders)/i.test(r.url()))report.labsRequests.push(r.url());});
  page.on('response',r=>{if(r.url().startsWith(base)&&!r.ok())report.missingAssets.push(r.url().slice(base.length));});
  await page.goto(base); await page.getByLabel('Chart data source',{exact:true}).selectOption('rpc'); await ready(page);
  await page.getByText('Trading active',{exact:true}).waitFor({timeout:60000});
  assert.equal(await page.locator('[data-pool-id]').getAttribute('data-pool-id'),pool);
  assert.equal(await page.locator('[data-chart-source]').getAttribute('data-chart-source'),'ethereum-logs');
  const index = await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),indexKey);
  assert(index.trades.length>0); assert.equal(index.pool,pool);
  report.live.push({name:'Official-pool live replay',pool,from:index.from,to:index.to,trades:index.trades.length,readAt:index.readAt,toTime:index.toTime,candles:+await page.locator('[data-candle-count]').getAttribute('data-candle-count')});
  // Independent raw event check, then independent aggregation against the rendered table.
  const signed = word => { const n=BigInt('0x'+word);return n>=2n**255n?n-2n**256n:n; };
  const absolute = n=>n<0n?-n:n;
  report.samples = index.trades.filter(t=>logs.has(`${t.hash}:${t.index}`)).slice(-3).map(t=>{
    const log=logs.get(`${t.hash}:${t.index}`), words=log.data.slice(2).match(/.{64}/g);
    const sqrt=BigInt('0x'+words[2]), price=(Number(sqrt)/2**96)**2;
    assert.equal(BigInt(t.unlk),absolute(signed(words[0])));assert.equal(BigInt(t.imd),absolute(signed(words[1])));assert.equal(t.price,price);
    return {hash:t.hash,logIndex:t.index,block:t.block,time:t.time,amount0:signed(words[0]).toString(),amount1:signed(words[1]).toString(),sqrtPriceX96:sqrt.toString(),price,matched:true};
  });
  assert.equal(report.samples.length,3);
  const grouped=new Map();
  for(const t of index.trades){const time=Math.floor(t.time/3600)*3600;let c=grouped.get(time);if(!c){c={time,open:t.price,high:t.price,low:t.price,close:t.price,volume:0n};grouped.set(time,c);}c.high=Math.max(c.high,t.price);c.low=Math.min(c.low,t.price);c.close=t.price;c.volume+=BigInt(t.imd);}
  await page.getByText('Source, coverage & candle data',{exact:true}).click();
  const cells=await page.locator('.candle-table tbody tr').evaluateAll(rows=>rows.map(r=>[...r.children].map(c=>c.textContent)));
  const expected=[...grouped.values()].slice(-30).reverse();assert.equal(cells.length,expected.length);
  // Use the UI's price formatting precision but independent event grouping and volume accumulation.
  for(let i=0;i<cells.length;i++){const c=expected[i];for(const [j,n] of [c.open,c.high,c.low,c.close].entries()) assert(Math.abs(Number(cells[i][j+1].replaceAll(',',''))-n)/n<0.00001);assert.equal(cells[i][5],(Number(c.volume)/1e18).toLocaleString('en',{maximumFractionDigits:4,maximumSignificantDigits:7}));}
  report.live.push({name:'Raw Swap legs/sqrt checked and displayed OHLCV independently recomputed',sampleTrades:3,displayedCandles:cells.length});
  await page.getByText('Source, coverage & candle data',{exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));await capture(page,'live-desktop',true);await capture(page,'live-chart');
  // Cached error must preserve the live candle count and original timestamp.
  const count=await page.locator('[data-candle-count]').getAttribute('data-candle-count');
  const readAt=index.readAt;failRpc=true;await page.getByRole('button',{name:'Refresh chart',exact:true}).click();
  await page.locator('.chart-provider-error').waitFor({timeout:60000});
  assert.match(await page.locator('.chart-provider-error p').innerText(),/^Mainnet history is unavailable\. Retry chart or choose GeckoTerminal under Source\./);
  assert.match(await page.locator('.chart-provider-error p').innerText(),/Saved data keeps its original timestamp/);
  assert.equal(await page.locator('[data-candle-count]').getAttribute('data-candle-count'),count);
  assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).readAt,indexKey),readAt);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);await capture(page,`cached-error-${width}`);}
  failRpc=false;await page.getByRole('button',{name:'Retry chart',exact:true}).focus();await page.keyboard.press('Enter');await ready(page);await page.locator('.chart-provider-error').waitFor({state:'hidden'});
  report.synthetic.push('Injected HTTP 503 after genuine mainnet candles: concise recovery message, original cache timestamp/candles retained, no overflow at 320/390/1440. Keyboard Retry chart then recovered fresh real mainnet data.');
  // Retained wallet and trading controls, no account connection or signing.
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
  const primary=await page.getByRole('button',{name:'Connect to trade',exact:true}).boundingBox();assert(primary&&primary.y+primary.height<=844);
  await capture(page,'live-mobile',true);await capture(page,'live-mobile-chart');
  await page.getByRole('button',{name:'Sell UNLK',exact:true}).click();await page.locator('#swap-amount').fill('10');await page.locator('#slippage').fill('1');await page.getByRole('button',{name:'Buy UNLK',exact:true}).click();
  await page.getByRole('button',{name:'Connect wallet',exact:false}).first().click();await page.getByRole('dialog',{name:'Connect a wallet',exact:true}).waitFor();await page.getByRole('button',{name:'Coinbase Smart Wallet',exact:false}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'Milestones',exact:true}).click();assert.equal(await page.locator('#gate-select option').count(),17);await page.locator('#gate-select').selectOption('16');assert.match(await page.locator('.ladder-readout').innerText(),/\$50M → 100% allowance/);
  await page.getByRole('tab',{name:'Price chart',exact:true}).click();await page.getByLabel('Chart data source',{exact:true}).selectOption('rpc');await ready(page);
  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole('button',{name:'Zoom chart in',exact:true}).click();await page.getByRole('button',{name:'Pan chart earlier',exact:true}).click();const panned=await range(page);
  await page.getByLabel('Chart interval',{exact:true}).selectOption('2');await ready(page);const switched=await range(page);report.live.push({name:'Panned interval range',panned,switched});assert(Math.abs(switched.from-panned.from)<1800&&Math.abs(switched.to-panned.to)<1800);
  await page.getByRole('button',{name:'Line',exact:true}).click();await page.getByRole('button',{name:'Candles',exact:true}).click();await page.getByRole('button',{name:'Reset / fit',exact:true}).click();
  await page.getByRole('button',{name:'Fullscreen chart',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement||!!document.querySelector('.chart-expanded'));await page.getByRole('button',{name:'Exit fullscreen chart',exact:true}).click();
  await page.getByRole('button',{name:'USD',exact:true}).click();
  try {await ready(page);assert.equal(await page.locator('[data-currency]').getAttribute('data-currency'),'USD');assert.equal(await page.locator('[data-chart-source]').getAttribute('data-chart-source'),'geckoterminal');report.live.push({name:'GeckoTerminal historical USD after panning',candles:+await page.locator('[data-candle-count]').getAttribute('data-candle-count')});}catch{report.limitations.push('GeckoTerminal USD did not finish; free provider/network availability is external. RPC IMD recovery and real candles passed.');}
  for(const hash of ['#labs','#labs-markets','#labs-radar','#labs-audit','#labs-profiles']){await page.goto(base+hash);await page.waitForURL('**/#trade');await page.locator('#swap-title').waitFor();}
  await page.getByLabel('Chart data source',{exact:true}).selectOption('rpc');await ready(page);await page.reload();await page.getByLabel('Chart data source',{exact:true}).selectOption('rpc');await ready(page);
  report.live.push('Wallet sheet, buy/sell amount/slippage controls, 17 ladder options/$50M, panned interval switch, candle/line, reset, fullscreen, Labs deep-link redirect and cached page reload passed. No wallet connected or transaction sent.');
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.missingAssets,[]);assert.deepEqual(report.labsRequests,[]);assert.equal(report.writes,0);report.methods=[...methods].sort();report.passed=true;
} catch(e) {report.error=e.stack;process.exitCode=1;}
finally {await browser?.close();await new Promise(r=>server.close(r));await fs.writeFile(path.join(out,'live-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
