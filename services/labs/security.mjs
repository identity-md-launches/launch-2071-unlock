import { createHash, randomBytes } from 'node:crypto';
import * as bundledViem from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';

export const UNLK = '0x99fa82b022be4575891a43b757bc770691e18fda';
export const IMD = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';
export const UPSTREAM = 'https://api.imd.fun';
export const PUBLIC_RPC = 'https://ethereum-rpc.publicnode.com';
export const hexToken = () => randomBytes(32).toString('hex');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const canonical = (value) => value === null ? 'null' : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

export class HttpError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export function assert(condition, status, code, message, details) { if (!condition) throw new HttpError(status, code, message, details); }
export function address(value) {
  assert(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value), 400, 'invalid_address', 'Use an Ethereum wallet address.');
  return value.toLowerCase();
}
export function safeGithub(value, { imported = false } = {}) {
  assert(typeof value === 'string' && value.length <= 500, 400, 'unsafe_repository', 'Use a public https://github.com/owner/repository URL.');
  let url; try { url = new URL(value); } catch { throw new HttpError(400, 'unsafe_repository', 'The repository URL is invalid.'); }
  assert(url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && !url.search && !url.hash,
    400, 'unsafe_repository', 'Only public HTTPS github.com repository URLs without credentials or query strings are supported.');
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  assert(parts.length >= 2 && /^[A-Za-z0-9_.-]{1,100}$/.test(parts[0]) && /^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]), 400, 'unsafe_repository', 'The repository owner or name is invalid.');
  assert(!['.', '..'].includes(parts[0]) && !['.', '..'].includes(parts[1]), 400, 'unsafe_repository', 'The repository path is invalid.');
  if (imported) assert(parts.length === 2, 400, 'unsafe_repository', 'A pinned source must name a repository, not a page inside it.');
  else assert(parts.length === 2 || (parts.length >= 4 && ['tree', 'commit'].includes(parts[2]) && parts.slice(3).every(part => /^[A-Za-z0-9_.-]+$/.test(part))),
    400, 'unsafe_repository', 'Use a repository URL, /tree/branch, or /commit/40-character-SHA.');
  return url.href.replace(/\/$/, '');
}
export function scopePaths(value) {
  const list = typeof value === 'string' ? value.split(/[\n,]/) : value;
  assert(Array.isArray(list) && list.length > 0 && list.length <= 16, 400, 'invalid_scope', 'Choose between 1 and 16 repository paths.');
  return [...new Set(list.map(item => {
    assert(typeof item === 'string', 400, 'invalid_scope', 'Each scope entry must be a repository path.');
    const path = item.trim();
    assert(path.length > 0 && path.length <= 180 && !path.startsWith('/') && !path.includes('\\') && !/[\x00-\x1f\x7f<>]/.test(path)
      && path.split('/').every(part => part !== '..') && !/^https?:/i.test(path), 400, 'invalid_scope', 'Scope paths must stay inside the repository.');
    return path;
  }))];
}
export const quoteTypes = { QuoteApproval: [
  { name: 'resource', type: 'string' }, { name: 'requesterScopeHash', type: 'bytes32' },
  { name: 'quoteId', type: 'string' }, { name: 'quoteHash', type: 'bytes32' },
  { name: 'paymentHash', type: 'bytes32' }, { name: 'action', type: 'string' },
  { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'payTo', type: 'address' }, { name: 'expiresAt', type: 'uint256' },
] };
export function quoteApproval(challenge, payment) {
  const q = challenge.quote;
  return {
    domain: { name: 'IdentityMD Paid Action', version: '1', chainId: 1 },
    primaryType: 'QuoteApproval', types: quoteTypes,
    message: {
      resource: challenge.resourceUrl, requesterScopeHash: `0x${challenge.requesterScopeHash.replace(/^0x/, '')}`,
      quoteId: q.id, quoteHash: `0x${q.quoteHash.replace(/^0x/, '')}`, paymentHash: `0x${hash(canonical(payment))}`,
      action: q.action, asset: q.payment.asset, amount: BigInt(q.payment.amount), payTo: q.payment.payTo, expiresAt: BigInt(q.expiresAt),
    },
  };
}

export function createRpc(rpcUrl, fetchImpl = fetch) {
  const windows = new Map();
  return async function rpc(method, params) {
    const bucket = Math.floor(Date.now() / 60000);
    if (windows.get('bucket') !== bucket) { windows.set('bucket', bucket); windows.set('count', 0); }
    const count = windows.get('count') + 1; windows.set('count', count);
    assert(count <= 120, 429, 'rpc_quota', 'Wallet verification reached the 120 RPC calls/minute server limit. Retry in a minute.');
    const response = await fetchImpl(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: count, method, params }), signal: AbortSignal.timeout(15000) });
    assert(response.ok, 503, 'rpc_unavailable', 'Ethereum verification is temporarily unavailable.');
    const result = await response.json();
    assert(!result.error && result.result !== undefined, 503, 'rpc_unavailable', 'Ethereum verification returned an error.');
    return result.result;
  };
}

export function createAuth({ store, siteOrigin, rpc, now = () => Date.now(), viem = bundledViem }) {
  const { db } = store;
  const domain = new URL(siteOrigin).host;
  const sessionMillis = 60 * 60 * 1000;
  async function balance(wallet) {
    // Check both chain and balance for every protected request. No stale holder cache.
    const chain = await rpc('eth_chainId', []);
    assert(BigInt(chain) === 1n, 503, 'wrong_rpc_network', 'Eligibility verification requires Ethereum mainnet.');
    const raw = await rpc('eth_call', [{ to: UNLK, data: `0x70a08231000000000000000000000000${wallet.slice(2)}` }, 'latest']);
    assert(/^0x[0-9a-fA-F]{64}$/.test(raw), 503, 'balance_unavailable', 'UNLK balance could not be verified.');
    return BigInt(raw);
  }
  function nonce(wallet) {
    wallet = address(wallet);
    const nonce = hexToken(); const created = now(); const expires = created + 5 * 60 * 1000;
    const message = `${domain} wants you to sign in with your Ethereum account:\n${wallet}\n\nSign in to UNLOCK Labs. This login authorizes no spending or transfers.\n\nURI: ${siteOrigin}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${new Date(created).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`;
    db.prepare('INSERT INTO nonces(nonce,address,message,expires) VALUES(?,?,?,?)').run(nonce, wallet, message, expires);
    return { nonce, message, expiresAt: new Date(expires).toISOString() };
  }
  async function verify(body) {
    const wallet = address(body.address);
    assert(typeof body.nonce === 'string' && /^[a-f0-9]{64}$/.test(body.nonce), 400, 'invalid_nonce', 'Request a fresh login nonce.');
    const row = db.prepare('SELECT * FROM nonces WHERE nonce=?').get(body.nonce);
    assert(row && row.address === wallet && !row.used && row.expires > now() && row.message.startsWith(`${domain} wants you to sign in`) && row.message.includes(`\nURI: ${siteOrigin}\n`), 401, 'login_expired', 'This login request expired, changed domains, or was already used. Sign in again.');
    assert(typeof body.signature === 'string' && /^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(body.signature), 400, 'invalid_signature', 'A wallet login signature of at most 4,096 bytes is required.');
    let valid = false;
    try {
      // viem public client supports both EOAs and ERC-1271 contract-wallet login.
      const recovered = await viem.recoverMessageAddress({ message: row.message, signature: body.signature });
      valid = recovered.toLowerCase() === wallet;
    } catch {}
    if (!valid) {
      const code = await rpc('eth_getCode', [wallet, 'latest']);
      assert(code !== '0x' || body.signature.length === 132, 401, 'counterfactual_wallet_unsupported', 'This undeployed or counterfactual wallet cannot verify an ERC-1271 login. Deploy it in your wallet first; Labs does not initiate deployment or spending.');
      try {
        const digest = viem.hashMessage(row.message);
        const encoded = viem.encodeFunctionData({ abi: viem.parseAbi(['function isValidSignature(bytes32,bytes) view returns(bytes4)']), functionName: 'isValidSignature', args: [digest, body.signature] });
        if (code !== '0x') {
          const result = await rpc('eth_call', [{ to: wallet, data: encoded }, 'latest']);
          valid = typeof result === 'string' && result.startsWith('0x1626ba7e');
        }
      } catch {}
    }
    assert(valid, 401, 'invalid_signature', 'The login signature does not belong to this wallet and domain.');
    const unlkBalance = await balance(wallet);
    const used = db.prepare('UPDATE nonces SET used=1 WHERE nonce=? AND used=0 AND expires>?').run(body.nonce, now());
    assert(used.changes === 1, 401, 'nonce_reused', 'This login signature was already used.');
    const token = hexToken(); const expires = now() + sessionMillis;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(`${siteOrigin}:${token}`), wallet, expires, now());
    return { token, authenticated: true, address: wallet, eligible: unlkBalance > 0n, unlkBalance: unlkBalance.toString(), expiresAt: new Date(expires).toISOString() };
  }
  async function requireSession(req, { holder = false } = {}) {
    const raw = req.headers.authorization || '';
    const token = /^Bearer ([a-f0-9]{64})$/.exec(raw)?.[1];
    const row = token ? db.prepare('SELECT * FROM sessions WHERE hash=?').get(hash(`${siteOrigin}:${token}`)) : undefined;
    assert(row && row.expires > now(), 401, 'session_expired', 'Sign in again. Wallet sessions last one hour.');
    const unlkBalance = await balance(row.address);
    assert(!holder || unlkBalance > 0n, 403, 'unlk_required', 'Advanced tools require a positive UNLK balance on Ethereum. No staking or transfer is needed.');
    return { authenticated: true, address: row.address, eligible: unlkBalance > 0n, unlkBalance: unlkBalance.toString(), expiresAt: new Date(row.expires).toISOString() };
  }
  function logout(req) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    if (token) db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(`${siteOrigin}:${token}`));
    return { authenticated: false };
  }
  return { nonce, verify, requireSession, logout, balance };
}
