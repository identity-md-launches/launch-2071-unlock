import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createLabsServer } from './server.mjs';
import { createAuth, createRpc, canonical, hash, safeGithub, scopePaths, quoteApproval, IMD, UNLK } from './security.mjs';
import { createStore, CACHE_POLICIES } from './store.mjs';
import { normalizeReport } from './audits.mjs';
import { createReportPdf } from './pdf.mjs';

const accountsModule = process.env.LABS_TEST_ACCOUNTS_MODULE || new URL('../../web/node_modules/viem/_esm/accounts/index.js', import.meta.url).href;
const { privateKeyToAccount } = await import(accountsModule);
const account = () => privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
const repoUrl = 'https://github.com/identity-md-launches/launch-2071-unlock.git';
const commit = 'c69ef33c084c608dea1a84b6ed050b43cd073336';
const siteOrigin = 'https://unlock-labs.example';

function fixture() {
  const wallet = account(); let clock = Date.now(); let unlk = 1n; let writes = 0; let quotedCount = 0; let loseResponse = false; let loseQuote = false;
  const directory = mkdtempSync(join(tmpdir(), 'unlock-labs-tests-')); const filename = join(directory, 'labs.sqlite');
  let quoteId = randomUUID(); const jobId = randomUUID(); let remote;
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const rpc = async method => method === 'eth_chainId' ? '0x1' : `0x${unlk.toString(16).padStart(64, '0')}`;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).startsWith('https://api.github.com/')) return reply({ tree: [{ path: 'src', type: 'tree' }, { path: 'src/UnlkToken.sol', type: 'blob' }] });
    const path = new URL(url).pathname;
    if (path === '/requests/import') return reply({ ok: true, source: { kind: 'code', repoUrl, baseCommit: commit, owner: 'identity-md-launches', repo: 'launch-2071-unlock', ref: 'main' } });
    if (path === '/requests/check') return reply({ action: 'job.open', blockers: [], suggestions: [], plan: [{ skill: 'audit-specialist' }, { skill: 'audit-judge' }], judged: false });
    if (path === '/requests/quote') {
      const body = JSON.parse(options.body); const input = body.input;
      if (remote?.order.requestKey === body.requestKey) return reply({ created: false, order: remote.order });
      if (remote) quoteId = randomUUID(); quotedCount++;
      const quote = { v: 1, id: quoteId, action: 'job.open', policyVersion: 'job-1', inputHash: hash(canonical(input)), issuedAt: Math.floor(clock / 1000), expiresAt: Math.floor(clock / 1000) + 600,
        payment: { network: 'eip155:1', asset: IMD, amount: '500000000000000000', payTo: '0x4e0fa57bde726079356537e2f34d671e9f41adbc', decimals: 18, scheme: 'exact' }, terms: { purchase: 'action-admission', resultGuaranteed: false }, quoteHash: hash(canonical(input)) };
      remote = { status: 'quoted', order: { id: quoteId, requestKey: body.requestKey, quote, inputJson: canonical(input), status: 'quoted', createdAt: new Date(clock).toISOString() }, payment: null, admission: null };
      if (loseQuote) { loseQuote = false; throw Error('Simulated lost quote response'); }
      return reply({ created: true, order: remote.order }, 201);
    }
    if (path === `/requests/${quoteId}`) return reply(remote);
    if (path === `/requests/${quoteId}/submit`) {
      if (!options.headers?.['PAYMENT-SIGNATURE']) return reply({ x402Version: 2, resource: { url, description: 'Audit admission', mimeType: 'application/json' }, accepts: [{ ...remote.order.quote.payment, maxTimeoutSeconds: 300, extra: { assetTransferMethod: 'permit2' } }], quote: remote.order.quote,
        requesterScopeHash: hash('isolated mock scope'), resourceUrl: url, input: JSON.parse(remote.order.inputJson) }, 402);
      writes++;
      remote = { ...remote, status: 'payment_pending', payment: { status: 'pending', paid: false } };
      if (loseResponse) { loseResponse = false; throw Error('Simulated lost response after settlement acceptance'); }
      return reply(remote, 202);
    }
    if (path === `/jobs/${jobId}`) return reply({ id: jobId, state: 'running', template: 'audit' });
    throw Error(`Unexpected mock provider path: ${url}`);
  };
  const markets = { markets: async () => ({ updatedAt: new Date(clock).toISOString(), featured: { address: IMD, symbol: 'IMD' }, markets: [{ address: UNLK, symbol: 'UNLK', liquidityUsd: null, volume24h: 4 }] }),
    radar: async () => ({ events: [], coverage: { missingHistory: true } }), refresh: async () => {} };
  let app = createLabsServer({ filename, siteOrigin, fetchImpl, now: () => clock, authRpc: rpc, marketServices: markets });
  return { wallet, filename, directory, get app() { return app; }, get writes() { return writes; }, get quotedCount() { return quotedCount; }, setBalance(value) { unlk = value; }, advance(ms) { clock += ms; }, loseNextResponse() { loseResponse = true; }, loseNextQuote() { loseQuote = true; },
    setStatus(status, payment = null) { remote = { ...remote, status, payment }; },
    restart() { app.close(); app = createLabsServer({ filename, siteOrigin, fetchImpl, now: () => clock, authRpc: rpc, marketServices: markets }); },
    finish() { app.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}
async function login(f, wallet = f.wallet) {
  const nonce = f.app.auth.nonce(wallet.address);
  const signature = await wallet.signMessage({ message: nonce.message });
  return f.app.auth.verify({ address: wallet.address, nonce: nonce.nonce, signature });
}
const req = token => ({ headers: { authorization: `Bearer ${token}` } });
function orderBody() { return { source: { repoUrl, baseCommit: commit }, scope: ['src/'], objective: 'Review quota accounting.', requestKey: randomUUID() }; }
async function signedPayment(f, order) {
  const challenge = await f.app.audits.challenge(order.id, f.wallet.address.toLowerCase());
  const payment = { x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], payload: { signature: `0x${randomBytes(65).toString('hex')}`,
    permit2Authorization: { from: f.wallet.address, permitted: { token: IMD, amount: challenge.quote.payment.amount }, spender: '0x4020858e48f9281ee7a39a333ea1e3c5e665bfa3', nonce: '7', deadline: String(challenge.quote.expiresAt - 10), witness: { to: challenge.quote.payment.payTo, validAfter: String(challenge.quote.issuedAt) } } } };
  const quoteSignature = await f.wallet.signTypedData(quoteApproval(challenge, payment));
  return { payment, quoteSignature };
}

test('domain-bound expiring login, one-use nonce, zero balance, logout and live server-side balance recheck', async () => {
  const f = fixture();
  try {
    const nonce = f.app.auth.nonce(f.wallet.address); const signature = await f.wallet.signMessage({ message: nonce.message });
    const session = await f.app.auth.verify({ address: f.wallet.address, nonce: nonce.nonce, signature });
    assert.equal(session.eligible, true);
    await assert.rejects(f.app.auth.verify({ address: f.wallet.address, nonce: nonce.nonce, signature }), error => error.code === 'login_expired');
    f.setBalance(0n); assert.equal((await f.app.auth.requireSession(req(session.token))).eligible, false);
    await assert.rejects(f.app.auth.requireSession(req(session.token), { holder: true }), error => error.code === 'unlk_required');
    f.setBalance(1n); assert.equal((await f.app.auth.requireSession(req(session.token), { holder: true })).eligible, true);
    const otherDomain = createAuth({ store: f.app.store, siteOrigin: 'https://another.example', rpc: async () => '0x1' });
    await assert.rejects(otherDomain.requireSession(req(session.token)), error => error.code === 'session_expired');
    const cross = f.app.auth.nonce(f.wallet.address); const crossSig = await f.wallet.signMessage({ message: cross.message });
    await assert.rejects(otherDomain.verify({ address: f.wallet.address, nonce: cross.nonce, signature: crossSig }), error => error.code === 'login_expired');
    f.advance(3600001); await assert.rejects(f.app.auth.requireSession(req(session.token)), error => error.code === 'session_expired');
    const next = await login(f); f.app.auth.logout(req(next.token)); await assert.rejects(f.app.auth.requireSession(req(next.token)), error => error.code === 'session_expired');
  } finally { f.finish(); }
});

test('pinned scope rejects unsafe URLs, traversal, nonexistent paths before quotes; request keys cannot change input', async () => {
  const f = fixture();
  try {
    assert.throws(() => safeGithub('https://github.com@evil.example/a/b'));
    assert.throws(() => safeGithub('http://127.0.0.1/private'));
    assert.throws(() => safeGithub('https://github.com/a/b?target=secret'));
    assert.throws(() => scopePaths(['../.env']));
    assert.throws(() => scopePaths(['/absolute']));
    const input = orderBody(); const owner = f.wallet.address.toLowerCase();
    await assert.rejects(f.app.audits.check({ ...input, scope: ['missing.sol'] }), error => error.code === 'scope_not_found');
    const q = await f.app.audits.quote(owner, input);
    assert.equal(q.order.input.baseCommit, commit); assert.equal(q.order.input.template, 'audit');
    assert.equal((await f.app.audits.quote(owner, input)).order.id, q.order.id);
    assert.equal((await f.app.audits.quote(owner, { ...input, requestKey: randomUUID() })).order.id, q.order.id);
    await assert.rejects(f.app.audits.quote(owner, { ...input, objective: 'A different scope' }), error => error.code === 'request_key_conflict');
    await assert.rejects(f.app.audits.status(q.order.id, account().address.toLowerCase()), error => error.code === 'order_not_found');
    assert.equal(f.writes, 0);
  } finally { f.finish(); }
});

test('deployed ERC-1271 login accepts bounded variable signatures; counterfactual wallets receive a precise refusal', async () => {
  const store = createStore(':memory:'); const wallet = account().address; let deployed = true;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getCode') return deployed ? '0x60016000' : '0x';
    if (method === 'eth_call' && params[0].to === UNLK) return `0x${'1'.padStart(64, '0')}`;
    if (method === 'eth_call') return `0x1626ba7e${'0'.repeat(56)}`;
    throw Error('Unexpected mock RPC');
  };
  const auth = createAuth({ store, siteOrigin, rpc });
  try {
    const nonce = auth.nonce(wallet); const signature = `0x${randomBytes(160).toString('hex')}`;
    assert.equal((await auth.verify({ nonce: nonce.nonce, address: wallet, signature })).eligible, true);
    deployed = false; const next = auth.nonce(wallet);
    await assert.rejects(auth.verify({ nonce: next.nonce, address: wallet, signature }), error => error.code === 'counterfactual_wallet_unsupported');
  } finally { store.close(); }
});

test('payment retries and concurrent submissions reuse exact stored bytes across database restart', async () => {
  const f = fixture();
  try {
    const owner = f.wallet.address.toLowerCase(); const order = (await f.app.audits.quote(owner, orderBody())).order;
    const signed = await signedPayment(f, order);
    const results = await Promise.all([f.app.audits.submit(order.id, owner, signed), f.app.audits.submit(order.id, owner, signed)]);
    assert.ok(results.every(result => result.status === 'payment_pending')); assert.equal(f.writes, 1);
    f.restart(); const retry = await f.app.audits.submit(order.id, owner, { retry: true });
    assert.equal(retry.status, 'payment_pending'); assert.equal(f.writes, 1); assert.equal(f.app.audits.list(owner).orders.length, 1);
    const changed = structuredClone(signed); changed.payment.payload.permit2Authorization.nonce = '8';
    await assert.rejects(f.app.audits.submit(order.id, owner, changed), error => error.code === 'payment_already_saved');
    assert.equal(f.writes, 1);
  } finally { f.finish(); }
});

test('lost payment response recovers status without another settlement; wrong payer and expired quote cannot submit', async () => {
  const f = fixture();
  try {
    const owner = f.wallet.address.toLowerCase(); const order = (await f.app.audits.quote(owner, orderBody())).order;
    const signed = await signedPayment(f, order); const wrong = structuredClone(signed);
    wrong.payment.payload.permit2Authorization.from = account().address;
    await assert.rejects(f.app.audits.submit(order.id, owner, wrong), error => error.code === 'payer_mismatch'); assert.equal(f.writes, 0);
    f.loseNextResponse(); await assert.rejects(f.app.audits.submit(order.id, owner, signed), error => error.code === 'provider_unavailable');
    assert.equal(f.writes, 1); assert.equal((await f.app.audits.submit(order.id, owner, { retry: true })).status, 'payment_pending'); assert.equal(f.writes, 1);
    const expired = fixture();
    try { const o = (await expired.app.audits.quote(expired.wallet.address.toLowerCase(), orderBody())).order; expired.advance(601000); await assert.rejects(expired.app.audits.challenge(o.id, expired.wallet.address.toLowerCase()), error => error.code === 'quote_expired'); }
    finally { expired.finish(); }
  } finally { f.finish(); }
});

test('lost quote retains its original request key; only authoritative expired/unpaid orders allow an explicit new quote', async () => {
  const f = fixture();
  try {
    const owner = f.wallet.address.toLowerCase(); const input = orderBody();
    f.loseNextQuote(); await assert.rejects(f.app.audits.quote(owner, input), error => error.code === 'provider_unavailable');
    const recovered = await f.app.audits.quote(owner, { ...input, requestKey: randomUUID() });
    assert.equal(recovered.order.requestKey, input.requestKey); assert.equal(f.quotedCount, 1);
    const signed = await signedPayment(f, recovered.order); await f.app.audits.submit(recovered.order.id, owner, signed);
    f.advance(601000);
    assert.equal((await f.app.audits.quote(owner, { ...input, requestKey: randomUUID() })).order.id, recovered.order.id); // Pending is uncertain, including past expiry.
    f.setStatus('expired', { paid: false, status: 'expired' });
    const renewed = await f.app.audits.quote(owner, { ...input, requestKey: randomUUID() });
    assert.notEqual(renewed.order.id, recovered.order.id); assert.equal(f.quotedCount, 2); assert.equal(f.writes, 1);
  } finally { f.finish(); }
});

test('payment failure is terminal without promising refunds or sending another payment', async () => {
  const f = fixture();
  try {
    const owner = f.wallet.address.toLowerCase(); const order = (await f.app.audits.quote(owner, orderBody())).order;
    const signed = await signedPayment(f, order); await f.app.audits.submit(order.id, owner, signed);
    f.setStatus('payment_failed', { paid: false, status: 'failed', failure: 'Mock settlement refusal' });
    const result = await f.app.audits.submit(order.id, owner, { retry: true });
    assert.equal(result.status, 'payment_failed'); assert.equal(f.writes, 1);
    await assert.rejects(f.app.audits.report(order.id, owner), error => error.code === 'job_not_admitted');
  } finally { f.finish(); }
});

test('accepted judge only, safe source links, full multipage PDF and exact UTF-8 report attachment', () => {
  const id = randomUUID(); const markdown = `# Audit report\n\nCommit ${commit}\nJob ${id}\n\n### Medium: A \"quoted\" finding — Unicode λ\n\n${'Evidence, tests and recommendations.\n'.repeat(180)}`;
  const job = { id, template: 'audit', state: 'completed', updatedAt: new Date().toISOString() };
  const submissions = { jobId: id, repoUrl, baseCommit: commit, submissions: [{ nodeKey: 'audit_math', accepted: true, outcome: 'completed', findings: [{ title: 'Unjudged finding' }] }] };
  assert.throws(() => normalizeReport({ job, submissions, markdown }), error => error.code === 'report_not_ready');
  submissions.submissions.push({ nodeKey: 'audit_judge', accepted: true, outcome: 'completed', hash: hash(markdown), createdAt: job.updatedAt,
    findings: [{ severity: 'medium', title: 'A "quoted" finding — Unicode λ', path: 'src/UnlkToken.sol', line: 12, description: '<script>must remain plain text</script>', reproduction: 'Run the accepted proof.', proof: 'assert(x);' }, { severity: 'low', path: '../unsafe', title: 'Path rejected' }] });
  const report = normalizeReport({ job, submissions, markdown, scope: ['src/'] });
  assert.equal(report.complete, true); assert.equal(report.findings.length, 2); assert.match(report.findings[0].sourceUrl, /\/blob\/c69/); assert.equal(report.findings[1].sourceUrl, null);
  const pdf = createReportPdf(report); assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.7'); assert.ok(pdf.includes(Buffer.from('/EmbeddedFile')));
  const source = pdf.toString('latin1'); const streams = [...source.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match => inflateSync(Buffer.from(match[1], 'latin1')));
  assert.ok(streams.some(stream => stream.equals(Buffer.from(report.markdown, 'utf8'))));
  const rendered = streams.map(stream => stream.toString('latin1')).join('\n'); assert.ok(rendered.includes('Evidence, tests and recommendations.')); assert.ok(rendered.includes(commit)); assert.ok(rendered.includes(id)); assert.ok(rendered.includes('\\\\u03bb'));
  assert.ok((source.match(/\/Type \/Page\b/g) || []).length >= 4);
});

test('HTTP public browsing, holder protection, logout, watchlists and CSV use authenticated live checks', async () => {
  const f = fixture();
  try {
    await new Promise(resolve => f.app.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${f.app.server.address().port}`;
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin: siteOrigin, ...options.headers } });
    assert.equal((await call('/api/markets')).status, 200);
    assert.equal((await call('/api/holder/markets')).status, 401);
    assert.equal((await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } })).status, 403);
    const session = await login(f); const headers = { authorization: `Bearer ${session.token}` };
    assert.equal((await call('/api/holder/markets', { headers })).status, 200);
    assert.equal((await call('/api/holder/watchlist', { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ addresses: [UNLK] }) })).status, 200);
    assert.deepEqual((await (await call('/api/holder/watchlist', { headers })).json()).addresses, [UNLK]);
    const exported = await call('/api/holder/export?kind=markets', { headers }); assert.match(exported.headers.get('content-type'), /text\/csv/); assert.match(await exported.text(), /Unavailable; blank cells are not zero/);
    f.setBalance(0n); assert.equal((await call('/api/holder/markets', { headers })).status, 403);
    assert.equal((await call('/api/audits/orders', { headers })).status, 200);
    assert.equal((await call('/api/radar?period=1y')).status, 400);
  } finally { f.finish(); }
});

test('ephemeral cache bounds hold on every write, expire without reads, and migrate on restart while preserving paid credentials and index state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'unlock-cache-bounds-')); const filename = join(directory, 'labs.sqlite');
  let clock = Date.now(); let store = createStore(filename, { now: () => clock });
  try {
    store.set('markets.snapshot', { observed: 'fixed market snapshot' });
    store.set('radar.index', { lastBlock: 26211921, events: [{ id: 'persisted-index-event' }] });
    const owner = account().address.toLowerCase(); const id = randomUUID(); const token = randomBytes(32).toString('hex');
    store.db.prepare('INSERT INTO audit_orders(id,owner,request_key,token,input_hash,input_json,scope_json,payment_json,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, owner, randomUUID(), token, hash('retained order'), '{}', '["src/"]', JSON.stringify({ signature: randomBytes(65).toString('hex') }), clock, clock);
    const paidBefore = store.db.prepare('SELECT * FROM audit_orders WHERE id=?').get(id);
    for (const policy of CACHE_POLICIES) {
      for (let n = 0; n < policy.maxEntries + 10; n++) {
        clock++; store.set(`${policy.prefix}${n}`, { item: n });
        const count = store.db.prepare('SELECT count(*) AS n FROM cache WHERE key LIKE ?').get(`${policy.prefix}%`).n;
        assert.ok(count <= policy.maxEntries, `Write exceeded hard cache bound for ${policy.prefix}`);
      }
      assert.equal(store.get(`${policy.prefix}0`), undefined, 'Oldest entries are evicted first');
      assert.deepEqual(store.get(`${policy.prefix}${policy.maxEntries + 9}`), { item: policy.maxEntries + 9 });
    }
    // Simulate opening a database made by the previous uncapped implementation.
    for (let n = 0; n < 12; n++) store.db.prepare('INSERT INTO cache VALUES(?,?,?)').run(`upstream:report:legacy-${n}`, '{}', clock + n);
    store.close(); store = createStore(filename, { now: () => clock });
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM cache WHERE key LIKE ?').get('upstream:report:%').n, 100);
    clock += 3600001; store.prune();
    for (const prefix of ['upstream:tree:', 'upstream:job:', 'import:']) assert.equal(store.db.prepare('SELECT count(*) AS n FROM cache WHERE key LIKE ?').get(`${prefix}%`).n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM cache WHERE key LIKE ?').get('upstream:report:%').n, 100, 'Reports retain a full day');
    clock += Math.max(...CACHE_POLICIES.map(p=>p.retentionMs)) + 1; store.prune();
    for (const policy of CACHE_POLICIES) assert.equal(store.db.prepare('SELECT count(*) AS n FROM cache WHERE key LIKE ?').get(`${policy.prefix}%`).n, 0);
    assert.deepEqual(store.get('markets.snapshot'), { observed: 'fixed market snapshot' });
    assert.deepEqual(store.get('radar.index'), { lastBlock: 26211921, events: [{ id: 'persisted-index-event' }] });
    assert.deepEqual(store.db.prepare('SELECT * FROM audit_orders WHERE id=?').get(id), paidBefore, 'Pruning never removes or rewrites paid order secrets/signatures');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
