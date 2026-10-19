import { UPSTREAM, HttpError, assert, safeGithub } from './security.mjs';

/** No arbitrary URL proxy, credentials, paid worker account or founder wallet. */
export function createUpstream({ store, fetchImpl = fetch, now = () => Date.now() }) {
  const counts = new Map();
  const inflight = new Map();
  function quota(name, limit, window = 60000) {
    const key = `${name}:${Math.floor(now() / window)}`;
    for (const old of counts.keys()) if (old.startsWith(`${name}:`) && old !== key) counts.delete(old);
    const count = (counts.get(key) || 0) + 1; counts.set(key, count);
    assert(count <= limit, 429, 'provider_quota', `The ${name} allowance (${limit} requests per ${window / 60000} minute(s)) is exhausted. Retry after this window.`, { retryAfter: Math.ceil(window / 1000) });
  }
  async function readResponse(response, maxBytes = 2 * 1024 * 1024) {
    assert(!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= maxBytes, 502, 'provider_response_too_large', 'The provider response exceeds the bounded reader limit.');
    if (!response.body) return '';
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(502, 'provider_response_too_large', 'The provider response exceeds the bounded reader limit.'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function request(path, { method = 'GET', body, token, payment, text = false, allow402 = false } = {}) {
    assert(/^\/(requests(?:\/|$)|jobs\/)/.test(path) && !path.includes('..') && !path.includes('?'), 500, 'invalid_upstream_path', 'The upstream path is not permitted.');
    quota(method === 'GET' ? 'IMD read' : 'IMD quote/check/import/submit', method === 'GET' ? 120 : 20);
    const headers = { accept: text ? 'text/markdown' : 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (payment) headers['PAYMENT-SIGNATURE'] = payment;
    let response;
    try { response = await fetchImpl(`${UPSTREAM}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(45000) }); }
    catch { throw new HttpError(503, 'provider_unavailable', 'The IMD API is temporarily unavailable. The existing order is retained; retry the same order.'); }
    const raw = await readResponse(response);
    let data; try { data = text && response.ok ? raw : JSON.parse(raw); } catch { throw new HttpError(502, 'invalid_provider_response', 'The IMD API returned an unreadable response. The existing order is retained.'); }
    if (!response.ok && !(allow402 && response.status === 402)) {
      throw new HttpError(response.status, typeof data?.error === 'string' ? data.error : (data?.error?.code || data?.code || 'imd_request_failed'),
        typeof data?.message === 'string' ? data.message.slice(0, 1000) : 'The IMD API refused this request. No new payment is authorized by this response.',
        { provider: data, retryAfter: response.headers.get('retry-after') || undefined });
    }
    return { data, status: response.status };
  }
  async function cached(key, ttl, callback) {
    const saved = store.get(`upstream:${key}`);
    if (saved && now() - saved.at < ttl) return saved.data;
    if (inflight.has(key)) return inflight.get(key);
    const promise = callback().then(data => { store.set(`upstream:${key}`, { at: now(), data }); return data; }).finally(() => inflight.delete(key));
    inflight.set(key, promise); return promise;
  }
  async function capabilities() {
    return cached('capabilities', 60000, async () => (await request('/requests/capabilities')).data);
  }
  async function githubTree(repoUrl, commit) {
    const safe = safeGithub(repoUrl, { imported: true });
    const [owner, repo] = new URL(safe).pathname.slice(1).replace(/\.git$/, '').split('/');
    assert(/^[a-f0-9]{40}$/.test(commit), 400, 'invalid_commit', 'The imported commit must be a full 40-character SHA.');
    return cached(`tree:${owner}/${repo}:${commit}`, 3600000, async () => {
      quota('GitHub tree', 40, 3600000);
      let response;
      try { response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commit}?recursive=1`, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'UNLOCK-Labs-public-scope-validator' }, redirect: 'error', signal: AbortSignal.timeout(20000),
      }); } catch { throw new HttpError(503, 'scope_verification_unavailable', 'GitHub scope validation is temporarily unavailable. No payment can be made until paths are checked.'); }
      assert(response.ok, response.status === 403 || response.status === 429 ? 429 : 422, 'scope_verification_failed', 'GitHub could not return the public pinned tree. Its unauthenticated quota may be exhausted; retry later.');
      const data = JSON.parse(await readResponse(response, 4 * 1024 * 1024));
      assert(!data.truncated && Array.isArray(data.tree) && data.tree.length <= 20000, 422, 'scope_tree_too_large', 'The repository tree exceeds this service’s 20,000-entry scope-verification limit. Use a smaller repository.');
      return data.tree.map(item => ({ path: item.path, type: item.type }));
    });
  }
  return { request, cached, capabilities, githubTree, readResponse, quota };
}
