import { migrate } from './migrate.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const CACHE_POLICIES = Object.freeze([
  { prefix: 'launchmeta:', maxEntries: 64, retentionMs: 3600000 },
  { prefix: 'logo:', maxEntries: 100, retentionMs: 604800000 },
  { prefix: 'identity:', maxEntries: 100, retentionMs: 86400000 },
  // Liquidity/ownership replay is durable state, not an expiring cache.

  { prefix: 'usd-reference:', maxEntries: 3000, retentionMs: 604800000 },
  { prefix: 'holders:', maxEntries: 64, retentionMs: 600000 },
  { prefix: 'upstream:tree:', maxEntries: 40, retentionMs: 3600000 },
  { prefix: 'import:', maxEntries: 100, retentionMs: 3600000 },
  { prefix: 'upstream:report:', maxEntries: 100, retentionMs: 86400000 },
  { prefix: 'upstream:job:', maxEntries: 100, retentionMs: 3600000 },
  { prefix: 'transient:', maxEntries: 200, retentionMs: 86400000 },
]);

/** A single durable database. Deploy one process with a persistent filesystem. */
export function createStore(filename, { now = () => Date.now() } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,address TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_orders(
      id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_key TEXT NOT NULL,token TEXT NOT NULL,
      input_hash TEXT NOT NULL,input_json TEXT NOT NULL,scope_json TEXT NOT NULL,
      upstream_id TEXT UNIQUE,quote_json TEXT,status_json TEXT,challenge_json TEXT,
      payment_json TEXT,quote_signature TEXT,payment_hash TEXT,
      job_id TEXT,submit_state TEXT NOT NULL DEFAULT 'new',created INTEGER NOT NULL,updated INTEGER NOT NULL,
      UNIQUE(owner,request_key)
    );
    CREATE INDEX IF NOT EXISTS audit_owner ON audit_orders(owner,created DESC);
    CREATE INDEX IF NOT EXISTS audit_input ON audit_orders(owner,input_hash,created DESC);
    CREATE TABLE IF NOT EXISTS watchlists(owner TEXT PRIMARY KEY,addresses TEXT NOT NULL,updated INTEGER NOT NULL);
  `);
  migrate(db);
  const removeExpired = db.prepare('DELETE FROM cache WHERE key LIKE ? AND updated<=?');
  const trimCount = db.prepare('DELETE FROM cache WHERE key IN (SELECT key FROM cache WHERE key LIKE ? ORDER BY updated DESC,rowid DESC LIMIT -1 OFFSET ?)');
  function prunePolicy(policy, timestamp = now()) {
    const match = `${policy.prefix}%`;
    removeExpired.run(match, timestamp - policy.retentionMs);
    trimCount.run(match, policy.maxEntries);
  }
  const store = {
    db,
    get(key) {
      const row = db.prepare('SELECT value,updated FROM cache WHERE key=?').get(key);
      const policy = CACHE_POLICIES.find(policy => key.startsWith(policy.prefix));
      if (row && policy && row.updated <= now() - policy.retentionMs) {
        db.prepare('DELETE FROM cache WHERE key=?').run(key); return undefined;
      }
      return row ? JSON.parse(row.value) : undefined;
    },
    set(key, value) {
      const timestamp = now();
      db.prepare('INSERT INTO cache VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated').run(key, JSON.stringify(value), timestamp);
      const policy = CACHE_POLICIES.find(policy => key.startsWith(policy.prefix));
      // Synchronous write-time eviction is a hard bound, even without the scheduler.
      if (policy) prunePolicy(policy, timestamp);
    },
    prune() {
      const timestamp = now();
      db.prepare('DELETE FROM nonces WHERE expires<?').run(timestamp - 3600000);
      db.prepare('DELETE FROM sessions WHERE expires<?').run(timestamp);
      // Fixed market/Radar keys and all paid order credentials remain outside these policies.
      for (const policy of CACHE_POLICIES) prunePolicy(policy, timestamp);
    },
    close() { db.close(); },
  };
  // Also migrate an older database whose ephemeral caches were previously unbounded.
  store.prune();
  return store;
}
