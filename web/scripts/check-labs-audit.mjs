/** Production-export interaction test. Every wallet/RPC/payment provider is an isolated fixture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createLabsServer } from '../../services/labs/server.mjs';
import { canonical, hash, IMD, UNLK } from '../../services/labs/security.mjs';
import { recoverTypedDataAddress } from '../vendor/runtime/c5e656ecf7fbe34e412c.mjs';

const { chromium } = await import(process.env.IMD_PLAYWRIGHT || 'playwright');
const { privateKeyToAccount } = await import(process.env.LABS_TEST_ACCOUNTS_MODULE || new URL('../node_modules/viem/_esm/accounts/index.js', import.meta.url).href);
const root = resolve(new URL('../../', import.meta.url).pathname);
const dist = resolve(process.env.LABS_TEST_DIST || join(root, 'dist'));
const evidence = join(root, 'test/scratch/labs-audit-browser');
mkdirSync(evidence, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'unlock-labs-browser-'));
const first = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
const second = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
let activeAccount = first; let activeChain = 1; let holderBalance = 1n; let clock = Date.now();
const repoUrl = 'https://github.com/identity-md-launches/launch-2071-unlock.git';
const commit = 'c69ef33c084c608dea1a84b6ed050b43cd073336';
const payTo = '0x4e0fa57bde726079356537e2f34d671e9f41adbc';
const permit2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const exactProxy = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001';
const orders = new Map(); const keys = new Map(); const jobs = new Map();
const walletCalls = { login: 0, typed: [], broadcasts: 0 };
let settlements = 0; let quotes = 0; let rejectCheck = false; let currentId;
const summary = { date: new Date().toISOString(), export: 'dist/ served under /preview/', mode: 'Simulated upstream/RPC/payment; actual production UI, Node API, SQLite and signatures', passed: false, checks: [], pageErrors: [], resourceFailures: [], limitations: [] };
const reply = (data, status = 200, type = 'application/json') => new Response(type === 'application/json' ? JSON.stringify(data) : data, { status, headers: { 'content-type': type } });
const permitTypes = {
  PermitWitnessTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'Witness' }],
  TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], Witness: [{ name: 'to', type: 'address' }, { name: 'validAfter', type: 'uint256' }],
};
const fakeTree = ['src', 'src/UnlkToken.sol', 'src/UnlkImdHook.sol', 'test', 'docs'].map(path => ({ path, type: path.includes('.sol') ? 'blob' : 'tree' }));
async function upstreamFetch(url, options = {}) {
  url = String(url); const path = new URL(url).pathname;
  if (url.startsWith('https://api.github.com/')) return reply({ tree: fakeTree });
  assert.equal(new URL(url).origin, 'https://api.imd.fun', 'Mock must never reach an external origin');
  if (path === '/requests/capabilities') return reply({ actions: [{ action: 'job.open', payment: { network: 'eip155:1', asset: IMD, amount: '500000000000000000', payTo, decimals: 18 }, quoteTtlSeconds: 600 }], payment: { x402Version: 2, assetTransferMethod: 'permit2' } });
  if (path === '/requests/import') return reply({ ok: true, source: { kind: 'code', repoUrl, baseCommit: commit, owner: 'identity-md-launches', repo: 'launch-2071-unlock', ref: 'main', sizeKb: 9662 } });
  if (path === '/requests/check') return reply({ action: 'job.open', blockers: rejectCheck ? [{ code: 'fixture_refusal', message: 'Fixture input judge refused the requested review.' }] : [], suggestions: [], plan: [{ skill: 'audit-specialist' }, { skill: 'audit-judge' }], judged: false });
  if (path === '/requests/quote') {
    const body = JSON.parse(options.body); const authorization = options.headers.authorization;
    if (keys.has(body.requestKey)) return reply({ created: false, order: orders.get(keys.get(body.requestKey)).order });
    const id = randomUUID(); currentId = id; quotes++;
    const q = { v: 1, id, action: 'job.open', policyVersion: 'job-1', inputHash: hash(canonical(body.input)), issuedAt: Math.floor(clock / 1000), expiresAt: Math.floor(clock / 1000) + 600,
      payment: { network: 'eip155:1', asset: IMD, amount: '500000000000000000', payTo, decimals: 18, scheme: 'exact' }, terms: { purchase: 'action-admission', resultGuaranteed: false }, quoteHash: hash(canonical(body.input)) };
    const order = { id, requestKey: body.requestKey, quote: q, status: 'quoted', inputJson: canonical(body.input), createdAt: new Date(clock).toISOString(), paidAt: null };
    orders.set(id, { order, status: 'quoted', payment: null, admission: null, authorization }); keys.set(body.requestKey, id); return reply({ created: true, order }, 201);
  }
  const orderPath = /^\/requests\/([^/]+)(\/submit)?$/.exec(path);
  if (orderPath) {
    const saved = orders.get(orderPath[1]); assert.ok(saved); assert.equal(options.headers.authorization, saved.authorization);
    const { authorization, ...state } = saved;
    if (!orderPath[2]) return reply(state);
    if (!options.headers['PAYMENT-SIGNATURE']) {
      const q = saved.order.quote; const resourceUrl = `https://api.imd.fun/requests/${q.id}/submit`;
      return reply({ x402Version: 2, resource: { url: resourceUrl, description: 'Audit admission', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: q.payment.network, asset: IMD, amount: q.payment.amount, payTo, maxTimeoutSeconds: 300, extra: { assetTransferMethod: 'permit2' } }], quote: q, requesterScopeHash: hash(saved.authorization), resourceUrl, input: JSON.parse(saved.order.inputJson) }, 402);
    }
    const payment = JSON.parse(Buffer.from(options.headers['PAYMENT-SIGNATURE'], 'base64').toString()); const a = payment.payload.permit2Authorization;
    assert.equal(a.spender, exactProxy); assert.equal(a.from.toLowerCase(), first.address.toLowerCase());
    const recovered = await recoverTypedDataAddress({ domain: { name: 'Permit2', chainId: 1, verifyingContract: permit2 }, types: permitTypes, primaryType: 'PermitWitnessTransferFrom', message: { permitted: a.permitted, spender: a.spender, nonce: a.nonce, deadline: a.deadline, witness: a.witness }, signature: payment.payload.signature });
    assert.equal(recovered.toLowerCase(), first.address.toLowerCase());
    settlements++; saved.status = 'payment_pending'; saved.payment = { status: 'pending', paid: false };
    return reply({ ...state, status: saved.status, payment: saved.payment }, 202);
  }
  const jobPath = /^\/jobs\/([^/]+)(?:\/(submissions|report\.md))?$/.exec(path);
  if (jobPath) {
    const job = jobs.get(jobPath[1]); assert.ok(job, 'Unknown fixture job');
    if (!jobPath[2]) return reply(job.public);
    if (jobPath[2] === 'submissions') return reply({ jobId: job.public.id, repoUrl, baseCommit: commit, submissions: job.judge ? [job.judge] : [] });
    if (!job.judge) return reply({ error: 'report_not_ready', message: 'The audit is incomplete; no accepted judge report is available.' }, 409);
    return reply(job.markdown, 200, 'text/markdown');
  }
  throw Error(`Unexpected fixture request: ${url}`);
}
let app;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const staticServer = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) { app.server.emit('request', req, res); return; }
  const url = new URL(req.url || '/', 'http://local');
  if (url.pathname === '/preview/labs-config.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ apiBase: `${site}/api` })); return; }
  try {
    assert.ok(url.pathname.startsWith('/preview/')); const path = resolve(dist, decodeURIComponent(url.pathname.slice('/preview/'.length) || 'index.html'));
    assert.ok(path.startsWith(`${dist}/`)); res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(readFileSync(path));
  } catch { res.writeHead(404); res.end('Missing production export asset'); }
});
await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${staticServer.address().port}`;
app = createLabsServer({ filename: join(temporary, 'labs.sqlite'), siteOrigin: site, fetchImpl: upstreamFetch, now: () => clock,
  authRpc: async method => method === 'eth_chainId' ? '0x1' : `0x${holderBalance.toString(16).padStart(64, '0')}`,
  marketServices: { markets: async () => ({ markets: [], featured: null }), radar: async () => ({ events: [] }), refresh: async () => {} },
});
let browser; let page;
function advance(ms) { clock += ms; }
function admit({ complete = true, blocked = false, refused = false } = {}) {
  const state = orders.get(currentId); state.status = 'admitted'; state.payment = { status: 'confirmed', paid: true };
  if (refused) { state.admission = { action: 'job.open', result: { kind: 'refused', problems: [{ message: 'Fixture admission refusal; no refund promised.' }] } }; return null; }
  const id = randomUUID(); state.admission = { action: 'job.open', result: { kind: 'job', jobId: id } };
  const description = 'An unchecked boundary permits an invalid transition. <script>window.__unsafeReportExecuted=true</script> This remains plain text.';
  const markdown = `# Audit report\n\nRepository: ${repoUrl}\nCommit: ${commit}\nJob: ${id}\nDate: ${new Date(clock).toISOString()}\n\n## Scope\nsrc/\n\n### Medium: Fixture boundary finding\n\nsrc/UnlkToken.sol:12\n\n${description}\n\nReproduction: assert the invalid transition reverts.\nRecommendation: validate the boundary before committing state.\n\n## Limitations\nThis simulated AI review is not a security guarantee.\n`;
  jobs.set(id, { public: { id, template: 'audit', state: blocked ? 'blocked' : complete ? 'completed' : 'running', blockedReason: blocked ? 'Fixture reviewer could not finish the requested scope.' : null, updatedAt: new Date(clock).toISOString() }, markdown,
    judge: complete && !blocked ? { nodeKey: 'audit_judge', accepted: true, outcome: 'completed', hash: hash(markdown), createdAt: new Date(clock).toISOString(), findings: [{ severity: 'medium', title: 'Fixture boundary finding', path: 'src/UnlkToken.sol', line: 12, description, reproduction: 'assert the invalid transition reverts.', proof: 'assertEq(state, expected);', snippet: 'function boundary() external {}', recommendation: 'Validate the boundary before committing state.' }] } : null });
  return id;
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => summary.pageErrors.push(error.message));
  page.on('requestfailed', request => { if (request.url().startsWith(site) && !request.failure()?.errorText.includes('ABORTED')) summary.resourceFailures.push(request.url()); });
  await page.exposeFunction('__labsWalletRequest', async ({ method, params = [] }) => {
    if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [activeAccount.address];
    if (method === 'eth_chainId') return `0x${activeChain.toString(16)}`;
    if (method === 'personal_sign') { walletCalls.login++; return activeAccount.signMessage({ message: { raw: params[0] } }); }
    if (method === 'eth_signTypedData_v4') { const data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1]; walletCalls.typed.push(data.primaryType); return activeAccount.signTypedData(data); }
    if (method === 'wallet_switchEthereumChain') { activeChain = Number(params[0].chainId); return null; }
    if (/sendTransaction|sendRawTransaction|sendCalls/.test(method)) { walletCalls.broadcasts++; throw Error('Transaction broadcasting is forbidden in this test.'); }
    throw Error(`Unsupported fixture wallet call: ${method}`);
  });
  await page.addInitScript(() => {
    const handlers = new Map();
    const provider = { request: input => window.__labsWalletRequest(input), on(name, fn) { const set = handlers.get(name) || new Set(); set.add(fn); handlers.set(name, set); }, removeListener(name, fn) { handlers.get(name)?.delete(fn); } };
    window.__labsWalletEmit = (name, value) => { for (const fn of handlers.get(name) || []) fn(value); };
    const announce = () => dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: '7a695096-f6d4-4ea2-9678-ce83b5cd61e0', name: 'Labs fixture wallet', rdns: 'test.unlock.labs', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }, provider } }));
    addEventListener('eip6963:requestProvider', announce); announce();
  });
  await context.route(/^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org)/, async route => {
    const one = request => {
      let result = `0x${'0'.repeat(64)}`;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getCode') result = request.params[0].toLowerCase() === exactProxy.toLowerCase() ? '0x60016000' : '0x';
      else if (request.method === 'eth_blockNumber') result = '0x1900000';
      else if (request.method === 'eth_call' && request.params[0].to?.toLowerCase() === IMD) result = `0x${(100n * 10n ** 18n).toString(16).padStart(64, '0')}`;
      return { jsonrpc: '2.0', id: request.id, result };
    };
    const input = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(Array.isArray(input) ? input.map(one) : one(input)) });
  });
  await page.goto(`${site}/preview/#labs-audit`);
  await page.getByRole('heading', { name: 'Audit public code', exact: true }).waitFor();
  await page.getByRole('button', { name: /Connect wallet/ }).click();
  await page.getByRole('button', { name: 'Labs fixture wallet', exact: true }).click();
  await page.getByRole('button', { name: /Disconnect/ }).waitFor();
  await page.getByLabel('Public GitHub repository', { exact: true }).fill(repoUrl);
  await page.getByRole('button', { name: 'Import repository', exact: true }).click();
  await page.getByLabel('Files or directories to review').fill('missing.sol');
  await page.getByRole('button', { name: 'Validate scope', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Some selected paths do not exist' }).waitFor();
  assert.equal(quotes, 0); assert.equal(settlements, 0);
  await page.getByLabel('Files or directories to review').fill('src/');
  await page.getByRole('button', { name: 'Validate scope', exact: true }).click();
  await page.getByText('Scope passed the IMD check', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign in to Labs', exact: true }).click();
  await page.getByText('UNLK holder', { exact: true }).waitFor();
  const quoteButton = page.getByRole('button', { name: 'Get current audit quote', exact: true });
  assert.equal(await quoteButton.isEnabled(), false, 'Public disclosure gates quoting');
  await page.locator('.labs-checkbox input').check(); await quoteButton.click();
  const pay = page.getByRole('button', { name: 'Sign & pay 0.5 IMD', exact: true });
  await pay.waitFor(); await assert.doesNotReject(() => pay.waitFor({ state: 'visible' }));
  assert.equal(await pay.isEnabled(), true, 'Actual mocked RPC balances/allowance enable signing');
  assert.equal(quotes, 1); assert.equal(settlements, 0); assert.equal(walletCalls.login, 1); assert.equal(walletCalls.typed.length, 0);
  summary.checks.push('390px production audit form: safe import, pinned commit, missing scope rejection, verified scope, signed domain login and mandatory disclosure before quoting.');
  await pay.click();
  await page.getByRole('status').filter({ hasText: 'Payment submitted.' }).waitFor();
  assert.equal(settlements, 1); assert.deepEqual(walletCalls.typed, ['PermitWitnessTransferFrom', 'QuoteApproval']);
  await page.getByRole('button', { name: 'Retry saved submission', exact: true }).click();
  assert.equal(settlements, 1); assert.equal(walletCalls.typed.length, 2);
  summary.checks.push('Actual EIP-712 Permit2 and quote signatures verified by the mocked upstream; retry reads existing pending settlement with no new signature/payment.');
  await page.reload();
  const recovery = page.locator('.audit-orders button').filter({ hasText: 'payment_pending' }); await recovery.waitFor(); await recovery.click();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).waitFor();
  assert.equal(settlements, 1); assert.equal(quotes, 1); assert.equal(walletCalls.typed.length, 2);
  // The relay can still say quoted after the local service has durably saved
  // signatures. The UI must offer recovery, never a second signing action.
  const pendingRemote = orders.get(currentId);
  pendingRemote.status = 'quoted'; pendingRemote.payment = null; advance(16000);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByText('submission_saved', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Sign & pay/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Retry saved submission', exact: true }).count(), 1);
  assert.equal(settlements, 1); assert.equal(walletCalls.typed.length, 2);
  pendingRemote.status = 'payment_pending'; pendingRemote.payment = { status: 'pending', paid: false }; advance(16000);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  summary.checks.push('Reload restores wallet session and durable owned order mapping; a saved signature with upstream status still quoted offers recovery without another signing action, quote or payment.');
  const jobId = admit(); advance(16000);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByRole('button', { name: 'Load accepted report', exact: true }).click();
  await page.getByRole('heading', { name: 'Completed review', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Fixture boundary finding', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__unsafeReportExecuted), undefined);
  assert.match(await page.locator('.audit-report').innerText(), new RegExp(commit));
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download matching PDF', exact: true }).click();
  const file = await download; const pdfPath = join(evidence, 'matching-report.pdf'); await file.saveAs(pdfPath);
  const pdf = readFileSync(pdfPath); assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.7');
  const streams = [...pdf.toString('latin1').matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match => inflateSync(Buffer.from(match[1], 'latin1')));
  assert.ok(streams.some(stream => stream.equals(Buffer.from(jobs.get(jobId).markdown))));
  await page.screenshot({ path: join(evidence, 'audit-completed-mobile.png'), fullPage: true });
  summary.checks.push('Admitted job retrieves only accepted judge findings, sanitizes report content as text, displays matching immutable metadata, and downloads a PDF with the exact accepted Markdown attached.');
  activeChain = 8453; await page.evaluate(() => window.__labsWalletEmit('chainChanged', '0x2105'));
  await page.getByRole('button', { name: 'Switch to Ethereum', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Sign & pay/ }).count(), 0);
  activeChain = 1; activeAccount = second;
  await page.evaluate(address => { window.__labsWalletEmit('chainChanged', '0x1'); window.__labsWalletEmit('accountsChanged', [address]); }, second.address);
  await page.getByRole('button', { name: 'Sign in to Labs', exact: true }).waitFor();
  assert.equal(await page.locator('.audit-orders button').count(), 0);
  holderBalance = 0n; await page.getByRole('button', { name: 'Sign in to Labs', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'No positive UNLK balance' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).count(), 1);
  app.store.db.prepare('UPDATE sessions SET expires=?').run(clock - 1);
  await page.reload(); await page.getByRole('button', { name: 'Sign in to Labs', exact: true }).waitFor();
  assert.equal(await page.getByText('UNLK holder', { exact: true }).count(), 0);
  summary.checks.push('Network/account changes clear payable order state; a newly signed zero-UNLK wallet remains able to access audit ordering; an expired persisted session is rejected on reload.');

  // Additional terminal outcomes are read-only fixture transitions, with no second settlement.
  activeAccount = first; holderBalance = 1n;
  await page.evaluate(address => window.__labsWalletEmit('accountsChanged', [address]), first.address);
  await page.getByRole('button', { name: 'Sign in to Labs', exact: true }).click();
  await page.getByText('UNLK holder', { exact: true }).waitFor();
  async function makeQuote(scope) {
    await page.getByLabel('Public GitHub repository', { exact: true }).fill(repoUrl);
    await page.getByRole('button', { name: 'Import repository', exact: true }).click();
    await page.getByLabel('Files or directories to review').fill(scope);
    await page.getByRole('button', { name: 'Validate scope', exact: true }).click();
    await page.getByText('Scope passed the IMD check', { exact: true }).waitFor();
    await page.locator('.labs-checkbox input').check();
    await page.getByRole('button', { name: 'Get current audit quote', exact: true }).click();
    await page.getByRole('button', { name: 'Sign & pay 0.5 IMD', exact: true }).waitFor();
  }
  await makeQuote('test/'); admit({ complete: false, blocked: true }); advance(16000);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByText(/Job: blocked/).waitFor();
  await page.getByRole('button', { name: 'Load accepted report', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'The audit is incomplete' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Completed review', exact: true }).count(), 0);
  await makeQuote('src/UnlkImdHook.sol'); admit({ refused: true }); advance(16000);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByText('Admission refused', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Sign & pay/ }).count(), 0);
  await makeQuote('docs/'); const expiredId = currentId; orders.get(expiredId).status = 'expired'; advance(601000);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByText(/The quote expired. Revalidate/).waitFor();
  assert.equal(await page.getByRole('button', { name: /Sign & pay/ }).count(), 0);
  rejectCheck = true;
  await page.getByLabel('Files or directories to review').fill('src/UnlkToken.sol');
  await page.getByRole('button', { name: 'Validate scope', exact: true }).click();
  await page.getByText('Validation blockers', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Get current audit quote', exact: true }).count(), 0);
  summary.checks.push('Blocked job stays incomplete, admission refusal exposes limitations, expired quote cannot be signed, and input-check blockers hide quote controls. These are isolated fixture states with no additional payment.');
  assert.equal(settlements, 1); assert.equal(walletCalls.broadcasts, 0); assert.equal(walletCalls.typed.length, 2);
  assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.resourceFailures, []);
  summary.walletCalls = { login: walletCalls.login, typed: walletCalls.typed, broadcasts: walletCalls.broadcasts };
  summary.mockSettlements = settlements; summary.mockQuotes = quotes;
  summary.limitations = ['No mainnet transactions, token approvals, conversion executions, live paid audits or public backend hosting were tested.', 'ETH/USDC conversion routes and real wallet extension UI are outside this fixture test.', 'PDF attachment/source fidelity was checked programmatically; printed page appearance was not visually inspected.'];
  summary.passed = true;
} catch (error) {
  summary.error = error.stack; process.exitCode = 1;
  if (page) {
    writeFileSync(join(evidence, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Unavailable'));
    await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  }
} finally {
  if (browser) await browser.close();
  app.close(); await new Promise(resolve => staticServer.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  mkdirSync(join(root, 'web/evidence'), { recursive: true });
  writeFileSync(join(root, 'web/evidence/labs-audit-browser.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
