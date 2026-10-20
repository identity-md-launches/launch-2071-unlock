// Production-export regression for the two chart/Labs retirement findings.
// RPC failure is injected. Recovery reads mainnet; no wallet is connected or signed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(import.meta.dirname, '../..');
const reproduce = process.argv.includes('--reproduce');
const out = path.join(root, 'artifacts/chart-revision');
await fs.mkdir(out, { recursive: true });
const phase = reproduce ? 'before' : 'after';
const report = { phase, browser: '', checkedAt: new Date().toISOString(), bundle: {}, viewports: [], pageErrors: [], missingAssets: [], labsRequests: [], passed: false };
const pool = '0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32';
const message = 'Mainnet history is unavailable. Retry chart or choose GeckoTerminal under Source.';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    assert(url.pathname.startsWith('/preview/'));
    let file = path.resolve(root, 'dist', decodeURIComponent(url.pathname.slice(9)) || 'index.html');
    assert(file.startsWith(path.join(root, 'dist') + path.sep));
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
let browser;
try {
  const assets = await fs.readdir(path.join(root, 'dist/assets'));
  const scripts = (await Promise.all(assets.filter(f => f.endsWith('.js')).map(f => fs.readFile(path.join(root, 'dist/assets', f), 'utf8')))).join('\n');
  report.bundle.labsPaymentRuntime = scripts.includes('ETH funding is allowed only for a fresh, verified Labs');
  assert.equal(report.bundle.labsPaymentRuntime, reproduce, 'Labs validator must reproduce before the fix and disappear afterwards');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  report.browser = browser.version();
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
    const failedHosts = new Set();
    // Fault only the selected chart. Other external reads are suppressed in these synthetic checks.
    await context.route('https://**', async route => {
      const host = new URL(route.request().url()).hostname;
      if (['ethereum-rpc.publicnode.com', 'eth.drpc.org'].includes(host)) failedHosts.add(host);
      await route.fulfill({ status: 503, body: 'injected provider failure', headers: { 'access-control-allow-origin': '*' } });
    });
    const page = await context.newPage();
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('response', r => { if (r.url().startsWith(base) && !r.ok()) report.missingAssets.push(r.url().slice(base.length)); });
    page.on('request', r => { if (/labs-config|\/labs\/|\/api\/(markets|radar|audit|profiles|orders)/i.test(r.url())) report.labsRequests.push(r.url()); });
    await page.goto(base);
    await page.getByLabel('Chart data source', { exact: true }).selectOption('rpc');
    const error = page.locator('.chart-provider-error');
    await error.waitFor({ timeout: 60000 });
    const text = await error.locator('p').innerText();
    if (reproduce) assert.match(text, /Request body:|Version: viem|Details:|HTTP request failed/);
    else {
      assert.equal(text, message);
      assert.doesNotMatch(text, /Request body:|Version:|viem|injected|eth_chainId|0x/);
      await page.getByRole('button', { name: 'Retry chart', exact: true }).focus();
      await page.keyboard.press('Enter');
      await error.waitFor({ timeout: 60000 });
      assert.equal(await error.locator('p').innerText(), message);
    }
    assert(failedHosts.has('ethereum-rpc.publicnode.com') && failedHosts.has('eth.drpc.org'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    assert.equal(await page.getByRole('link', { name: 'Labs', exact: true }).count(), 0);
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      const action = await page.getByRole('button', { name: 'Connect to trade', exact: true }).boundingBox();
      assert(action && action.y + action.height <= 844, 'Trade action is on the first mobile screen');
      await page.screenshot({ path: path.join(out, `${phase}-mobile.jpg`), type: 'jpeg', quality: 75 });
    }
    await page.locator('.official-chart').screenshot({ path: path.join(out, `${phase}-error-${width}.jpg`), type: 'jpeg', quality: 75 });
    report.viewports.push({ width, text, failedHosts: [...failedHosts], scrollWidth: width, synthetic: true });
    console.log(`${phase} ${width}px: error and layout verified`);
    await context.close();
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.missingAssets, []);
  assert.deepEqual(report.labsRequests, []);
  report.pool = pool;
  report.passed = true;
} catch (e) { report.error = e.stack; process.exitCode = 1; }
finally {
  await browser?.close();
  await new Promise(r => server.close(r));
  await fs.writeFile(path.join(out, `${phase}-results.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
