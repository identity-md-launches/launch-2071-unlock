import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createStore } from './store.mjs';
import { createRpc, createAuth, HttpError, assert, address, PUBLIC_RPC } from './security.mjs';
import { createUpstream } from './upstream.mjs';
import { createAudits } from './audits.mjs';
import { createMarketServices } from './markets.mjs';

function originSetting(value) {
  const url = new URL(value);
  assert(url.origin === value && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))),
    500, 'invalid_site_origin', 'LABS_SITE_ORIGIN must be the exact HTTPS website origin; HTTP is permitted only for localhost development.');
  return url.origin;
}
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    assert(bytes <= 32768, 413, 'body_too_large', 'Requests are limited to 32 KiB.'); chunks.push(chunk);
  }
  if (!bytes) return {};
  assert((req.headers['content-type'] || '').startsWith('application/json'), 415, 'json_required', 'Use application/json.');
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert(value && typeof value === 'object' && !Array.isArray(value), 400, 'invalid_json', 'Use a JSON object.'); return value;
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json', 'The request is not valid JSON.'); }
}
function csv(records, fields) {
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    // Spreadsheet cells beginning with formulas remain text on export.
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [fields.map(cell).join(','), ...records.map(item => fields.map(field => cell(item[field])).join(','))].join('\r\n');
}
function filterMarkets(data, search) {
  let rows = [...(data.markets || [])]; const addresses = search.get('addresses');
  if (addresses) {
    const allowed = addresses.split(',').map(address); assert(allowed.length <= 12, 400, 'comparison_limit', 'Compare at most 12 markets.');
    rows = rows.filter(item => allowed.includes(String(item.address).toLowerCase()));
  }
  const sort = search.get('sort') || 'liquidity';
  assert(['liquidity', 'volume', 'change'].includes(sort), 400, 'invalid_sort', 'Sort by liquidity, volume, or change.');
  const field = { liquidity: 'liquidityUsd', volume: 'volume24h', change: 'priceChange24h' }[sort];
  rows.sort((a, b) => (b[field] ?? -Infinity) - (a[field] ?? -Infinity));
  return { ...data, markets: rows, protected: true, eligibility: 'Positive UNLK balance on Ethereum; no staking or transfer.' };
}

/** Factories are injectable for payment tests; the executable never accepts another IMD API origin. */
export function createLabsServer({
  filename = process.env.LABS_DB_PATH || '/tmp/unlock-labs/labs.sqlite',
  siteOrigin = process.env.LABS_SITE_ORIGIN || 'http://127.0.0.1:4173',
  rpcUrl = process.env.ETHEREUM_RPC_URL || PUBLIC_RPC,
  fetchImpl = fetch, now = () => Date.now(), store: injectedStore, marketServices, authRpc,
} = {}) {
  siteOrigin = originSetting(siteOrigin);
  const store = injectedStore || createStore(filename);
  const upstream = createUpstream({ store, fetchImpl, now });
  const rpc = authRpc || createRpc(rpcUrl, fetchImpl);
  const auth = createAuth({ store, siteOrigin, rpc, now });
  const audits = createAudits({ store, upstream, now });
  const markets = marketServices || createMarketServices({ store, rpcUrl, fetchImpl, now });
  const callers = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('vary', 'Origin');
    try {
      // Reverse proxies may set X-Forwarded-For; never trust it for access or quota identity.
      const caller = req.socket.remoteAddress || 'unknown'; const bucket = Math.floor(now() / 60000);
      const key = `${caller}:${bucket}`; const count = (callers.get(key) || 0) + 1; callers.set(key, count);
      if (callers.size > 5000) for (const old of callers.keys()) if (!old.endsWith(`:${bucket}`)) callers.delete(old);
      assert(count <= 120, 429, 'request_quota', 'This server accepts at most 120 requests per minute per connection IP.', { retryAfter: 60 });
      const origin = req.headers.origin;
      assert(!origin || origin === siteOrigin, 403, 'origin_mismatch', 'Open UNLOCK Labs on its configured website domain.');
      if (origin === siteOrigin) res.setHeader('access-control-allow-origin', siteOrigin);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': 'Authorization,Content-Type', 'access-control-max-age': '600' }); res.end(); return;
      }
      const url = new URL(req.url || '/', 'http://labs.local'); const path = url.pathname; const method = req.method;
      if (method === 'GET' && path === '/api/health') {
        json(res, 200, { ok: true, service: 'UNLOCK Labs', version: 1, running: true, siteOrigin, chainId: 1, persistentStore: 'SQLite; requires a persistent LABS_DB_PATH mount across host replacement', noCustody: true,
          limits: { requestPerMinute: 120, upstreamReadPerMinute: 120, upstreamWritePerMinute: 20, githubTreesPerHour: 40, ordersPerWalletPerDay: 30 },
          coverage: 'Markets and Radar have bounded caches. Read their coverage and missing-history metadata.' }); return;
      }
      if (method === 'GET' && path === '/api/capabilities') { json(res, 200, await upstream.capabilities()); return; }
      if (method === 'POST' && path === '/api/auth/nonce') { json(res, 200, auth.nonce((await body(req)).address)); return; }
      if (method === 'POST' && path === '/api/auth/verify') { json(res, 200, await auth.verify(await body(req))); return; }
      if (method === 'GET' && path === '/api/auth/session') { json(res, 200, await auth.requireSession(req)); return; }
      if (method === 'POST' && path === '/api/auth/logout') { json(res, 200, auth.logout(req)); return; }
      if (method === 'POST' && ['/api/audits/import', '/api/import'].includes(path)) { json(res, 200, await audits.importSource(await body(req))); return; }
      if (method === 'POST' && path === '/api/audits/check') { json(res, 200, await audits.check(await body(req))); return; }
      if (method === 'POST' && path === '/api/audits/quote') {
        const session = await auth.requireSession(req); json(res, 200, await audits.quote(session.address, await body(req))); return;
      }
      if (method === 'GET' && path === '/api/audits/orders') {
        const session = await auth.requireSession(req); json(res, 200, audits.list(session.address)); return;
      }
      const publicReport = /^\/api\/audits\/reports\/([^/]+)(?:\/(pdf)|\.(pdf))?$/.exec(path);
      if (method === 'GET' && publicReport) {
        const report = await audits.reportByJob(publicReport[1]);
        if (publicReport[2] || publicReport[3]) { res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="UNLOCK-audit-${report.jobId}.pdf"`, 'cache-control': 'public,max-age=60' }); res.end(audits.pdf(report)); }
        else json(res, 200, report); return;
      }
      const orderRoute = /^\/api\/audits\/orders\/([^/]+)(?:\/(challenge|submit|report|report\.pdf|pdf))?$/.exec(path);
      if (orderRoute) {
        const session = await auth.requireSession(req); const [, id, action] = orderRoute;
        if (method === 'GET' && !action) { json(res, 200, await audits.status(id, session.address)); return; }
        if (method === 'POST' && action === 'challenge') { json(res, 200, await audits.challenge(id, session.address)); return; }
        if (method === 'POST' && action === 'submit') { json(res, 200, await audits.submit(id, session.address, await body(req))); return; }
        if (method === 'GET' && ['report', 'report.pdf', 'pdf'].includes(action)) {
          const report = await audits.report(id, session.address);
          if (action !== 'report') { res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="UNLOCK-audit-${report.jobId}.pdf"`, 'cache-control': 'no-store' }); res.end(audits.pdf(report)); }
          else json(res, 200, report); return;
        }
      }
      if (method === 'GET' && path === '/api/markets') { json(res, 200, await markets.markets()); return; }
      if (method === 'GET' && path === '/api/radar') {
        const period = url.searchParams.get('period') || '24h'; const cursor = url.searchParams.get('cursor');
        assert(['1h', '24h', '7d'].includes(period), 400, 'unsupported_period', 'Supported Radar periods are 1h, 24h, and 7d, clipped to indexed history.');
        assert(cursor === null || /^\d{1,5}$/.test(cursor), 400, 'invalid_cursor', 'Use the bounded cursor from the previous Radar response.');
        json(res, 200, await markets.radar({ period, cursor })); return;
      }
      if (path.startsWith('/api/holder/')) {
        const session = await auth.requireSession(req, { holder: true });
        if (method === 'GET' && path === '/api/holder/markets') { json(res, 200, filterMarkets(await markets.markets(), url.searchParams)); return; }
        if (path === '/api/holder/watchlist' && ['GET', 'PUT'].includes(method)) {
          if (method === 'PUT') {
            const value = await body(req); assert(Array.isArray(value.addresses) && value.addresses.length <= 20, 400, 'watchlist_limit', 'Save at most 20 Ethereum addresses.');
            const addresses = [...new Set(value.addresses.map(address))];
            store.db.prepare('INSERT INTO watchlists VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET addresses=excluded.addresses,updated=excluded.updated').run(session.address, JSON.stringify(addresses), now());
          }
          const row = store.db.prepare('SELECT * FROM watchlists WHERE owner=?').get(session.address);
          json(res, 200, { addresses: row ? JSON.parse(row.addresses) : [], updatedAt: row ? new Date(row.updated).toISOString() : null, limit: 20 }); return;
        }
        if (method === 'GET' && path === '/api/holder/export') {
          const kind = url.searchParams.get('kind') || 'markets'; assert(['markets', 'radar'].includes(kind), 400, 'invalid_export', 'Export markets or radar.');
          let output;
          if (kind === 'markets') {
            const data = await markets.markets();
            const rows = [data.featured, ...(data.markets || [])].filter(Boolean).map(item => ({ ...item, updatedAt: data.updatedAt, missingValues: 'Unavailable; blank cells are not zero.' }));
            output = csv(rows, ['symbol', 'address', 'chainId', 'priceUsd', 'priceChange24h', 'volume24h', 'liquidityUsd', 'fdv', 'updatedAt', 'poolId', 'projectUrl', 'missingValues']);
          } else {
            const data = await markets.radar({ period: url.searchParams.get('period') || '24h' });
            const rows = (data.events || []).map(item => ({ ...item, coverageStart: data.coverage?.fromTime, updatedAt: data.updatedAt }));
            output = csv(rows, ['type', 'time', 'token', 'symbol', 'poolId', 'amount', 'wallet', 'from', 'to', 'hash', 'block', 'coverageStart', 'updatedAt']);
          }
          res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="unlock-${kind}.csv"`, 'cache-control': 'no-store' }); res.end(output); return;
        }
      }
      throw new HttpError(404, 'not_found', 'This API route does not exist.');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const status = error instanceof HttpError && error.status >= 400 && error.status <= 599 ? error.status : 500;
      if (status === 429) res.setHeader('retry-after', String(error.details?.retryAfter || 60));
      json(res, status, { error: error instanceof HttpError ? error.code : 'internal_error', message: error instanceof HttpError ? error.message : 'The service could not complete this request. Existing orders remain saved.', ...(error instanceof HttpError && error.details ? { details: error.details } : {}) });
    }
  });
  let timer;
  function startJobs() {
    if (timer) return;
    const run = async () => { try { store.prune(); await markets.refresh(); } catch { /* Failed refresh retains marked stale cache. */ } };
    void run(); timer = setInterval(run, 60000); timer.unref();
  }
  function close() { clearInterval(timer); server.close(); if (!injectedStore) store.close(); }
  return { server, store, auth, audits, upstream, markets, startJobs, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createLabsServer();
  const port = Number(process.env.LABS_PORT || process.env.PORT || 8787);
  assert(Number.isInteger(port) && port > 0 && port <= 65535, 500, 'invalid_port', 'LABS_PORT must be a valid TCP port.');
  app.server.listen(port, process.env.LABS_HOST || '127.0.0.1', () => { console.log(`UNLOCK Labs API listening on port ${port}; persistent store enabled.`); app.startJobs(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close(); });
}
