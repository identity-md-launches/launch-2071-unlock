CREATE TABLE IF NOT EXISTS profile_submissions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, token TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('profile','sponsor')),
 content TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profiles_by_owner ON profile_submissions(owner,created DESC);
CREATE TABLE IF NOT EXISTS profile_orders (
 id TEXT PRIMARY KEY, binding TEXT NOT NULL UNIQUE, payer TEXT NOT NULL, submission_id TEXT NOT NULL REFERENCES profile_submissions(id),
 quote TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'quoted', transaction_hash TEXT UNIQUE, created INTEGER NOT NULL, fulfilled INTEGER
);
CREATE TABLE IF NOT EXISTS verified_profile_payments (
 transaction_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES profile_orders(id), block INTEGER NOT NULL, block_hash TEXT NOT NULL, verified INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_publications (
 token TEXT NOT NULL, kind TEXT NOT NULL, submission_id TEXT NOT NULL REFERENCES profile_submissions(id),
 order_id TEXT NOT NULL UNIQUE REFERENCES profile_orders(id), starts INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(token,kind)
);
CREATE TABLE IF NOT EXISTS operator_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL, owner TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operator_log (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created INTEGER NOT NULL);
