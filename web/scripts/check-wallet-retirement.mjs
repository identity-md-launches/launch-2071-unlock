// Synthetic component regression: actual WalletProvider, mocked chain reads and reject-only wallet.
// This never forwards a signature or transaction to a real provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const { build } = await import(process.env.UNLK_ESBUILD_MODULE ? pathToFileURL(process.env.UNLK_ESBUILD_MODULE).href : 'esbuild');
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : 'playwright');
const root = path.resolve(import.meta.dirname, '../..');
const scratch = path.join(root, 'test/scratch/wallet-retirement');
await fs.mkdir(scratch, { recursive: true });
const account = '0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9';
const token = '0x99fa82b022be4575891a43b757bc770691e18fda';
const hook = '0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc';
const mockConfig = `
export const chain = {id:1}; export const RPC_URLS = []; export const explorer = () => '#';
export const client = {
  async simulateContract(request) { window.calls.simulations++; return {request}; },
  async estimateContractGas() { window.calls.estimates++; return 21000n; },
  async getGasPrice() { return 1n; }
};`;
await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {WalletProvider, ConnectButton, useWallet} from '@wallet';
    import {parseAbi} from 'viem';
    window.calls = {simulations:0, estimates:0, sends:0, validations:0};
    function Harness() {
      const wallet = useWallet();
      window.start = async scenario => {
        window.calls.simulations = 0; window.calls.estimates = 0; window.calls.validations = 0;
        const action = {title:'Guard regression', description:'Synthetic action, never sent.', address:'${token}',
          abi:parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
          functionName:'transfer', args:['${account}',1n],
          ...(scenario === 'omitted' ? {} : {value:scenario === 'negative' ? -1n : ['native','forged-metadata'].includes(scenario) ? 1n : 0n}),
          ...(scenario === 'forged-metadata' ? {labsFunding:{maximum:1n}} : {}),
          validate:async () => { window.calls.validations++; if ((scenario === 'second-check' && window.calls.validations === 2) || (scenario === 'last-check' && window.calls.validations === 3)) action.value=1n; }
        };
        await wallet.review(action);
      };
      return <><ConnectButton/><p id='connected'>{wallet.address || ''}</p></>;
    }
    createRoot(document.getElementById('root')).render(<WalletProvider><Harness/></WalletProvider>);
  `, resolveDir: path.join(root, 'web'), loader: 'tsx' },
  outfile: path.join(scratch, 'harness.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: process.env.UNLK_NODE_MODULES ? [process.env.UNLK_NODE_MODULES] : [],
  alias: { '@wallet': path.join(root, 'web/src/wallet.tsx') },
  plugins: [{ name: 'read-only-wallet-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/(config|mainnetReader|mainnet)$/ }, args => args.importer === path.join(root, 'web/src/wallet.tsx') ? { path: args.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === './config' ? mockConfig : args.path === './mainnetReader' ? 'export async function verifyMainnetBindings() {}' : `export const HOOK='${hook}';`, loader: 'js' }));
  } }],
});
const server = http.createServer(async (req, res) => {
  if (req.url === '/harness.js') { res.setHeader('content-type', 'text/javascript'); res.end(await fs.readFile(path.join(scratch, 'harness.js'))); }
  else res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const report = { kind: 'synthetic component regression; no real RPC or wallet', cases: [], errors: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.addInitScript(account => {
    window.ethereum = { on() {}, removeListener() {}, async request({ method }) {
      if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [account];
      if (method === 'eth_chainId') return '0x1';
      if (/send|sign/i.test(method)) window.calls.sends++;
      throw Error('Reject-only fixture; unsupported wallet method');
    } };
  }, account);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Browser wallet' }).click();
  await page.locator('#connected').filter({ hasText: account.slice(0, 8) }).waitFor();
  for (const scenario of ['native', 'negative', 'forged-metadata', 'second-check', 'last-check', 'zero', 'omitted']) {
    await page.evaluate(scenario => window.start(scenario), scenario);
    if (scenario === 'second-check' || scenario === 'last-check') {
      await page.getByRole('button', { name: 'Continue to wallet' }).click();
    }
    if (scenario === 'zero' || scenario === 'omitted') {
      await page.getByRole('dialog', { name: 'Guard regression' }).waitFor();
      assert.equal(await page.locator('.details').innerText().then(s => s.includes('0 ETH')), true);
      await page.getByRole('button', { name: 'Close dialog' }).last().click();
    } else {
      await page.getByText('Native ETH funding is disabled for UNLK / IMD trading.', { exact: true }).waitFor();
    }
    const calls = await page.evaluate(() => ({ ...window.calls }));
    assert.equal(calls.sends, 0);
    assert.equal(calls.simulations, scenario === 'last-check' ? 2 : ['second-check', 'zero', 'omitted'].includes(scenario) ? 1 : 0);
    assert.equal(calls.validations, scenario === 'last-check' ? 3 : scenario === 'second-check' ? 2 : 1);
    report.cases.push({ scenario, ...calls });
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) { report.error = e.stack; process.exitCode = 1; }
finally {
  await browser?.close();
  await new Promise(r => server.close(r));
  await fs.mkdir(path.join(root, 'artifacts/chart-revision'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts/chart-revision/wallet-guards.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
