# Separately operated UNLOCK Labs service

This assignment publishes **only `dist/` through IMD/IPFS**. The API, database and indexers below are complete source for the operator to deploy separately. Nothing here was publicly hosted or run as a persistent worker. The current site name remains `https://unlk-b35c.sites.imd.fun/`.

## Local setup

Use Node 24. The service needs no npm install, wallet key, relay or new contract. It uses built-in HTTP/crypto/SQLite and the retained pinned viem runtime. Run from the repository root:

```sh
LABS_SITE_ORIGIN=http://127.0.0.1:4173 \
LABS_DB_PATH=/tmp/unlock-labs/labs.sqlite \
LABS_PORT=8787 \
node services/labs/server.mjs
```

Run the frontend preview at `http://127.0.0.1:4173`. Set `web/public/labs-config.json`'s `apiBase` to `http://127.0.0.1:8787/api`, rebuild, and reload. HTTP is allowed only for loopback. Production requires the actual HTTPS API URL ending in `/api`. The frontend first checks `/api/health`, chain ID and health status. Connection failure keeps login/checkout and other dependent features disabled. A later API failure is surfaced rather than replaced by made-up current data.

The delivered configuration remains disconnected. Revert any local connection setting before publishing a snapshot-only export. Never put provider secrets, session tokens, order credentials or private keys in a public configuration file.

## Docker and HTTPS

```sh
docker build -f services/labs/Dockerfile -t unlock-labs-api .
docker volume create unlock-labs-data
docker run --name unlock-labs-api --restart unless-stopped \
  --publish 127.0.0.1:8787:8787 \
  --mount source=unlock-labs-data,target=/data \
  --env-file /absolute/path/to/operator-labs.env \
  unlock-labs-api
```

These are operator setup commands, not actions run by this job. Copy `services/labs/.env.example` to an operator-controlled file **outside the static export and source control**. Set the actual origin and paths. The example contains no owner, tariff, seller account or API hostname stand-in. A blank setting disables its associated function.

Use the included Caddyfile with `LABS_API_HOST` set to the actual API hostname, or an existing HTTPS reverse proxy forwarding `/api/` and Authorization. The service's Docker health check calls `/api/health`; health checks SQLite and reports schema version 2. No wildcard CORS: `LABS_SITE_ORIGIN` must equal the exact frontend origin. The API does not trust forwarded IP headers; a reverse proxy therefore shares the conservative per-socket quota. Provision edge rate limits as needed.

Docker was unavailable in the worker environment. The actual Node entry point, migrations, HTTP health, disconnected settings and unauthorized quote refusal were exercised directly. Docker build, DNS, certificates and production storage operation await the operator.

## Configuration

| Setting | Meaning |
| --- | --- |
| `LABS_SITE_ORIGIN` | Exact frontend origin; production is the retained UNLOCK hostname. Local default `http://127.0.0.1:4173`. |
| `LABS_DB_PATH` | SQLite file on a durable mount. Docker default `/data/labs.sqlite`; development `/tmp` default is disposable. |
| `LABS_HOST`, `LABS_PORT` | Listener; loopback / 8787 by default, container binds 0.0.0.0. Expose through HTTPS. |
| `ETHEREUM_RPC_URL` | Read-only chain-1 provider supporting historical calls and filtered logs. Default publicnode. Provider refusal leaves affected checks unavailable. |
| `LABS_OPERATOR_OWNER` | Real operator wallet controlling tariff/refund settings and moderation. Blank disables owner actions and checkout. This is independent of treasury/beneficiary authority. |
| `LABS_MARKET_CONFIG` | Optional path to operator JSON. Start from `market-config.example.json`; empty configuration publishes no simulated sell checks. |
| `LABS_API_HOST` | Actual hostname for the optional Caddy configuration. |

The market JSON supports:

- `extraLaunchIds`: up to 30 authoritative IMD launch UUIDs for bounded discovery/ownership resolution. No symbol-based identity shortcut.
- `simulationPlans`: keyed by exact lowercase token address. Each value needs a real existing `account`, positive atomic `amountRaw`, and positive atomic `minimumQuoteRaw`. Select a representative account/size from evidenced real trades, document that source, and use a meaningful minimum quote return. The service executes a full Universal Router `eth_call` at the checked block with the account's **actual** balances, allowances and quota, without state overrides. It never sends that transaction. Configure no test keys or dummy sellers.
- `poolStartBlocks`: exact v4 PoolId → evidenced Initialize start block. For registry tokens the deployment block is used automatically. A later/incorrect start cannot qualify: the Initialize event, position history and active-liquidity reconciliation must all succeed. IMD's older pool needs its verified start configured before its liquidity can qualify.
- `indexStartBlock`: verified positive global Radar start block, or `null` for the recent bounded scan. Each discovered token/PoolId separately backfills from its authoritative token deployment block, in bounded pages. A pool initialization override never replaces that token deployment evidence. Only complete opening inventory and reconciled wallet flows can support P&L.
- `attributions`: optional Vitalik/CZ/Asem records with exact `address`, `label`, reliable public `sourceUrl`, a written `evidence` explanation, `custody: "personal"` and `reviewed: true`. The operator must actually verify the primary attribution. No entries are supplied or guessed. Exchange/custody addresses must never be entered as personal wallets.
- `marketplaces`: optional Seaport listing venues with exact `address`, verified `runtimeCodeHash` and authoritative `sourceUrl`. Only a matching runtime, single NFT listing fulfillment, native consideration and exact NFT Transfer evidence creates a sale record. Unsupported venues, bids and bundles remain transfers.

The service currently discovers static-fee IMD v4 pools quoting IMD or native ETH. Other pool versions/quotes are unindexed and remain unpublished. Provider quotas, archives, representative account selection, missing identity records and operator price/refund choices are deployment work; they are not guessed in the source.

## Database, persistence and recovery

Use one API process/replica with a persistent SQLite volume. WAL, foreign keys and busy timeout are enabled. `store.mjs` bootstraps the accepted audit schema; `migrate.mjs` applies `migrations/002-profiles.sql` transactionally once using `schema_migrations`. Do not replace an existing paid-order database with an empty one.

Retain the database and pending WAL consistently: stop the process for a filesystem backup or use SQLite's consistent backup API. Protect backups: saved audit bearer credentials, exact payment signatures and expiring sessions are sensitive even though no private wallet key is used. Monitor disk and back up before upgrading. A lost disk cannot be reconstructed solely from the static site. Profile submissions/orders have a 10,000-row ceiling; paid credentials/fulfillments are never silently pruned.

Ephemeral caches have per-prefix entry/age bounds; market/index state and paid records are separate. Seven-day event retention and event/request limits can make cost basis incomplete. On a legacy index, unknown omission state is treated as incomplete. After changing the history start, stop the API and explicitly rebuild public caches:

```sh
node services/labs/reindex.mjs --public-history-only /absolute/persistent/labs.sqlite
```

This utility clears only public market/history cache keys, preserving audit/profile orders, verified payments, moderation, settings and sessions. Restart the API to backfill. During warming, old listings stay withheld.

## Authentication and project rights

`POST /api/auth/nonce` binds a random one-use nonce to address, Ethereum, exact origin, issue time and five-minute expiry. `/auth/verify` verifies the signature and returns a hashed-at-rest one-hour bearer session. Logout, expiry and origin changes invalidate it. Current UNLK balance is rechecked for holder endpoints; zero-balance authenticated customers can still order audits and verified representatives can submit profiles. Deployed ERC-1271 login is supported; unsupported counterfactual login is refused.

Profile rights require a live chain-1 IMD project artifact matching the **exact token**, successful deployment receipt/block, existing code and a successful current nonzero `owner()` read. RPC failures, reverts, empty/undecodable results and renounced ownership grant no rights; an outage never substitutes the original requester. A new submission and each moderation/payment check repeat rights verification. A payment recipient is never inferred to be the project owner. Treasury inventory does not change the immutable vault beneficiary.

**Ownership policy:** requester evidence alone is not edit authority. There is currently no reviewed policy for tokens without an owner interface, including the immutable UNLK token. Their profile editing remains unavailable until an explicit source/runtime-bound authority policy is implemented and reviewed; neither a generic revert nor a cached former owner can establish that policy. Existing trading and claims do not depend on profile rights.

## UNLK-paid content sequence

1. Sign in, enter the token address and verify project rights.
2. Submit description/up to five HTTPS social links and PNG logo/banner. Server checks 300 KB limits, dimensions, RGB/RGBA pixel data and CRCs, strips ancillary chunks, and stores immutable content. Other formats use a fallback or an actionable upload error.
3. The configured operator owner signs in and approves/rejects that exact revision. Pending/rejected content cannot be quoted. The owner separately configures atomic price, duration and written refund policy for each placement type. **No tariff is invented.**
4. The approved representative requests a quote. The backend requires current market eligibility and binds an immutable order to payer, chain 1, UNLK, treasury, exact amount, content, duration, refund terms and ten-minute expiry. Existing active/fulfilled orders are recovered. Contract-wallet direct transfers are unsupported and disabled; existing EOAs/delegated EOAs can use this route.
5. Before signing, `/profiles/orders/:id/recheck` repeats rights, approval, expiry and market eligibility. The wallet review shows exact terms and ETH gas. There is no token approval: an ERC20 `transfer` carries the random 32-byte order binding as trailing calldata, supported by the existing token ABI decoder. No new contract is deployed.
6. Submit the existing hash to `/verify`. The backend checks mainnet, transaction sender/target/value/**exact calldata**, canonical successful receipt, exact Transfer recipient/amount, transfer block within the quote window and 12-block confirmation depth. Late recovery is allowed for a transfer made within the original window. A SQLite transaction and unique transaction/order constraints prevent reused payments or duplicate fulfillment. Concurrent retries share the saved order.
7. Publication requires current eligibility and approved content on every public read. Sponsorship is labeled and separate from organic ranks. Loss of eligibility withholds content without inventing a refund; the exact saved refund terms govern operator handling. A failed/expired/uncertain order never authorizes another automatic payment.

Public settings: `GET /api/profiles/settings`. Authenticated representative routes: `/profiles/rights`, `/profiles/submissions`, `/profiles/mine`, `/profiles/quote`, `/profiles/orders/:id`, `/recheck`, `/verify`. Owner-only routes: `PUT /profiles/settings`, `GET /profiles/moderation`, `POST /profiles/moderation/:id`. PNG cache routes are `/media/1/:token/logo.png`, `/banner.png`, `/sponsor-banner.png`.

## Audit integration retained

The documented [IMD request protocol](https://imd.fun/docs/) and [OpenAPI](https://api.imd.fun/openapi.json) remain fixed-origin. Public import/check creates no paid job. The selected existing files at the full commit enter the public objective. A customer reviews capabilities, current quote, public-code/report disclosure and funding costs before signing.

Payment remains exact IMD x402/Permit2 plus quote-bound EIP-712 approval; exact-amount IMD approval and verified ETH→IMD conversion are separate explicit wallet actions. Unsupported USDC conversion is disabled. No founder advance, markup, paid worker test or mainnet spending occurs automatically.

Order bearer credentials and the exact signed bytes are persisted before dispatch. Retry/reload/restart reconciles the same order; it never creates replacement signatures or charges from a timer. Expired unpaid renewal requires authoritative upstream final status. Pending, refused, blocked, failed and incomplete outcomes are explicit. Only accepted judge evidence contributes findings. HTML/PDF reports preserve job/commit/scope; PDF embeds the exact UTF-8 report. Core PDF fonts escape unsupported characters visibly rather than silently deleting them.

## Operational checks

Check `/api/health`, `/api/capabilities`, `/api/markets`, `/api/radar`, and an excluded `/api/tokens/:address` before connecting the site. Health is not a claim of full index coverage. Read each response's timestamps, block and errors. Exercise nonce/session/ownership and simulated payment recovery tests before enabling checkout. Production real-payment testing requires separate explicit authorization; this assignment made no paid test jobs or broadcasts.
