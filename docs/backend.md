# UNLOCK Labs service

The service is implemented and locally tested. **It has not been deployed to a public host.** The current site remains at `https://unlk-b35c.sites.imd.fun/`; its IPFS export cannot execute a Node process, retain orders, or run an indexer. The delivered site labels its bundled market observations as dated snapshots and disables login, protected tools and payment while `labs-config.json` has an empty `apiBase`.

No authorized free backend hosting account, persistent disk, or HTTPS API hostname was supplied. The remaining hosting blocker is an operator-controlled, zero-cost Node 24 host with persistent storage and an HTTPS hostname. No paid plan, subscription, private key, founder advance or external account was created. Existing free infrastructure may be used; a host that sleeps or replaces its filesystem loses continuous coverage or database durability. Do not use an ephemeral free web-service disk for paid orders. This is an explicit operational dependency, not a claim that the unhosted API is live.

## Run locally

The backend uses Node 24's built-in HTTP, crypto and SQLite modules plus the repository's existing pinned viem runtime. It requires no npm install, new dependency manifest, API key or wallet key.

From the repository root:

```sh
LABS_SITE_ORIGIN=http://127.0.0.1:4173 \
LABS_DB_PATH=/tmp/unlock-labs/labs.sqlite \
LABS_PORT=8787 \
node services/labs/server.mjs
```

Use the production frontend preview on `http://127.0.0.1:4173`. In the preview's `labs-config.json`, set `apiBase` to `http://127.0.0.1:8787/api`. The frontend permits HTTP only for loopback development. `/api/health` reports service availability and limits. On startup, the service refreshes its bounded data caches; its internal scheduler wakes every minute and the market provider enforces a five-minute minimum refresh interval. The first cache may take time to populate. Failed refreshes preserve prior observations and expose their age/errors.

## Production setup

1. Use an existing authorized free Node 24 host with a persistent filesystem. Keep a single service process: the SQLite write-ahead store and in-process dispatch locks are intended for one replica. Run behind HTTPS on a hostname the operator controls. DNS and host provisioning are still required.
2. Place the repository's `services/labs/` source and `web/vendor/runtime/c5e656ecf7fbe34e412c.mjs` on that host, preserving their relative paths. Set the variables below. Start `node services/labs/server.mjs` under the host's process manager. The listener should remain private behind the HTTPS reverse proxy.
3. Mount persistent storage at `LABS_DB_PATH`. Protect the directory and its backups: the database contains upstream order bearer credentials, signed payment payloads, expiring sessions, saved watchlists, and cached public reports. It contains no private wallet keys. Stop the process or use a SQLite-consistent backup method; preserve the database plus pending WAL state. Do not recreate an empty database for an existing installation.
4. Verify `GET /api/health`, `GET /api/capabilities`, `GET /api/markets`, and `GET /api/radar`. Test public import/check, login and holder access with the production origin. An operator must finish the mocked payment checks before enabling user payments; a paid mainnet test still requires separate authorization.
5. Set `web/public/labs-config.json` to `{"apiBase":"https://YOUR_OPERATOR_API_HOST/api"}`, replacing the host with the actual configured HTTPS API hostname. This is an operator-set deployment setting, not a supplied or invented service endpoint. Rebuild the frontend and deliver its relative-asset `dist/` under the **existing** website name. The hosting mechanism for the static site is unchanged. Repeat origin and expired-session checks from the real website.

An optional container build is included:

```sh
docker build -f services/labs/Dockerfile -t unlock-labs-service .
docker volume create unlock-labs-data
docker run --detach --name unlock-labs-service --restart unless-stopped \
  --publish 127.0.0.1:8787:8787 \
  --mount source=unlock-labs-data,target=/data \
  --env LABS_SITE_ORIGIN=https://unlk-b35c.sites.imd.fun \
  --env ETHEREUM_RPC_URL=https://ethereum-rpc.publicnode.com \
  unlock-labs-service
```

These are setup instructions, not commands executed on a production host. An included `services/labs/Caddyfile` supplies a free Caddy HTTPS reverse proxy. Install Caddy on the operator host, point an API hostname at that host, open ports 80/443, set `LABS_API_HOST` to that actual hostname, then run `caddy run --config services/labs/Caddyfile`. The API remains on loopback port 8787. Caddy preserves the `Authorization` header and `/api/` path; the current static-site domain is unchanged. Automatic certificate issuance needs the configured hostname to resolve to this host. The backend does not trust forwarded IP headers. A single reverse-proxy IP therefore shares the conservative request quota; configure an upstream edge quota if further separation is needed. HTTPS hosting, DNS and certificate issuance have not been exercised here. The Docker image was not built in this run; the Node entry point and HTTP routes were exercised directly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LABS_SITE_ORIGIN` | `http://127.0.0.1:4173` | Exact allowed frontend origin and login domain. Production: `https://unlk-b35c.sites.imd.fun`. No wildcard CORS. |
| `LABS_DB_PATH` | `/tmp/unlock-labs/labs.sqlite` | SQLite file; set to a persistent mount for production. `/tmp` is a local development default. |
| `LABS_API_HOST` | No default | Actual operator-controlled API hostname for the optional Caddy HTTPS configuration; this does not change the static site domain. |
| `LABS_HOST` | `127.0.0.1` | Listener address. Container sets `0.0.0.0`; only expose through the HTTPS proxy. |
| `LABS_PORT` | `8787` (or host `PORT`) | Listener port. |
| `ETHEREUM_RPC_URL` | `https://ethereum-rpc.publicnode.com` | Read-only Ethereum RPC. No paid API subscription is required. Public RPC outages and quotas affect refresh/eligibility. |
| `LABS_TEST_ACCOUNTS_MODULE` | existing installed `web/node_modules/viem/_esm/accounts/index.js` | Test-only absolute module URL/path for viem's account signer. Tests generate ephemeral keys and never submit them to mainnet. The production service does not use this setting. |

The IMD upstream origin is fixed to `https://api.imd.fun`; it is not an operator-supplied proxy target. Never put RPC access tokens, wallet keys, order bearer credentials, or session tokens into `labs-config.json` or `dist/`.

## Authentication and access

`POST /api/auth/nonce {address}` returns `{nonce,message,expiresAt}`. The exact message binds the wallet, Ethereum chain 1, configured domain/origin, issue time, random 32-byte nonce and five-minute expiry. `POST /api/auth/verify {address,nonce,signature}` consumes the nonce once and returns `{token,address,authenticated,eligible,unlkBalance,expiresAt}`. Subsequent calls use `Authorization: Bearer <token>`. Tokens are hashed with the site origin in SQLite and expire after one hour. Logout invalidates the stored hash. Changing the configured origin invalidates old sessions/nonces.

Each session/protected request verifies the Ethereum RPC chain and current UNLK `balanceOf`. The initial holder requirement is **any positive UNLK balance**. A zero-balance wallet can still own, quote, pay for and recover its own audit; it cannot use `/api/holder/*`. Login is a message signature and asks for no spending approval. Deployed ERC-1271 wallets can log in using bounded variable-length signatures. Undeployed/counterfactual wallet login receives a precise refusal; the service does not deploy wallets. The upstream IMD payment protocol currently supports EOAs and EIP-7702 accounts, not ordinary contract wallets; the UI disables unsupported paid signing separately.

Public routes are `/api/health`, `/api/capabilities`, `/api/markets`, `/api/radar`, `/api/audits/import`, `/api/audits/check`, and `/api/audits/reports/:jobId` (plus `/pdf`). Protected holder routes are `/api/holder/markets?sort=liquidity|volume|change&addresses=...`, `/api/holder/watchlist` (GET/PUT), and `/api/holder/export?kind=markets|radar`. Watchlists retain at most 20 addresses. Missing numeric values export as empty cells, with an explicit unavailable-data note; spreadsheet formula prefixes are escaped.

## Paid audit sequence

The implementation follows the public [IMD docs](https://imd.fun/docs/) and [paid request OpenAPI](https://api.imd.fun/openapi.json), inspected before implementation. No service markup is applied.

1. Import accepts only public HTTPS `github.com/owner/repo` URLs, including supported `/tree/ref` and `/commit/sha` forms. Credentials, arbitrary hosts, local addresses, queries and unsafe path forms are rejected. The IMD import resolves the full commit; it does not by itself reserve a quote.
2. The user selects 1–16 literal repository files/directories. Paths are checked against the pinned GitHub tree before check/quote. Traversal, absolute paths, nonexistent selections, truncated trees, and trees exceeding 20,000 entries are refused. The selected scope is embedded in the audit objective. The backend sends `template:"audit"`, `repoUrl`, `baseCommit`, and `github:false` through `/requests/check`; blockers prevent a quote. The service asks for no code edits, deployment or paid transactions.
3. An authenticated wallet creates a quote with a retained UUID request key. The server persists a random per-order upstream bearer credential **before** calling `/requests/quote`. Local ownership and the upstream order mapping survive reload/restart. Unresolved/lost quote responses reuse their original key and bearer. Identical active input recovers its existing order even if the browser supplies another key. Input changes with the same key are rejected.
4. `/api/audits/orders/:id/challenge` retrieves the actual x402 challenge from the saved order. Its pinned input/commit/scope and Ethereum IMD terms must match. Recipient, price and expiry come from capabilities/the saved quote/challenge; they are not fixed application payment recipients. The frontend shows public-code/public-report disclosure, prepared input, itemized fee/gas and outcome limitations before signing. ETH/USDC conversions are separately disabled where a verified exact-output path cannot be established; a failed or unsupported conversion cannot submit a job.
5. The visitor approves IMD to Permit2 if needed, then signs the exact Permit2 payment and the EIP-712 `QuoteApproval`. The backend checks session ownership, payer, token, amount, recipient witness, payment deadline, challenge/resource, and the recovered quote-approval signer. The IMD API performs the authoritative payment validation/settlement. No custody wallet or server private key exists.
6. The exact signed payment bytes and quote signature are written before dispatch. `/submit {retry:true}` reads current status and reuses **only** those bytes. Concurrent submissions share a lock. A lost response, browser reload or process restart cannot replace the saved payment with a new one. Pending, admitted, failed and uncertain orders do not solicit a new payment. A new quote for identical input is allowed only with a new request key after authoritative status says expired, unpaid, with no pending/confirmed/settling payment or admitted job, and the original signature window has ended.
7. The service maps admitted jobs to their owner, retrieves status without charging, and exposes blocked/incomplete work. Payment buys admission, not a guarantee of findings or completion. No unsupported refund promise is made. Orders that remain uncertain require status reconciliation rather than another payment.

Audit ownership routes are `GET /api/audits/orders`, `GET /api/audits/orders/:id`, `POST .../challenge`, `POST .../submit`, `GET .../report`, and `GET .../report.pdf`. Quote responses expose a **local** `order.id` for these routes and `order.upstreamId` for reference. The returned `quote.id` is the upstream ID and is signed unchanged. Upstream bearer credentials are never returned to the browser. A saved-but-unreconciled payment displays `submission_saved` and `submissionSaved:true`, which is not a new payable quote.

## Reports and PDF fidelity

Only an accepted, completed `audit_judge` submission contributes findings; unaccepted specialists are not presented as completed review. The service fetches the documented fixed-origin job, submissions and `report.md` routes. It never follows a URL supplied inside a repository, report, finding or artifact. Findings retain severity, code location, description, reproduction, proof, snippet and any supplied recommendation. Safe source links are constructed against the verified repository and immutable commit. Unavailable recommendations remain unavailable; they are not invented. Content is returned as text/data and the UI renders it without HTML execution.

The PDF uses the same accepted Markdown and immutable commit, job ID, judge date, scope and SHA-256 as the report view. It paginates the full report rather than truncating findings. The original UTF-8 `report.md` is embedded as a PDF attachment. The portable Courier font supports Windows-1252; other codepoints are visibly represented as Unicode escapes in the printed pages and remain exact in the attachment. This limitation avoids silently dropping non-Latin code or evidence. An accepted report may exist while the overall job remains incomplete; the PDF and API label that distinction. Every report states the limits of AI review.

## Bounds and operational limits

- General HTTP: 120 requests/minute per socket IP; 32 KiB input bodies. Conservative shared proxy quotas may limit a public deployment until its free edge configuration is tuned.
- IMD: 120 reads/minute and 20 combined import/check/quote/submit calls/minute across this process, below the documented upstream 300 requests/30 quotes limits. Quotes/challenges/payments are never automatically regenerated on a timer. A provider 429 retains order state and exposes retry information.
- GitHub: 40 unauthenticated tree calls/hour, one-hour commit-tree cache, 20,000 entries and 4 MiB/tree. The upstream unauthenticated GitHub quota is shared by IP and may be lower after other usage.
- Wallet verification: 120 RPC calls/minute for auth, 15-second call timeout, mainnet chain check. Market/Radar have separate bounded cached reads and backoff; see [labs-data.md](labs-data.md).
- Audit store: 30 new orders/wallet/day, 10,000 total, 100 returned per list page. Paid credentials are retained for recovery. An operator must monitor disk usage and reconcile completed/expired records before reaching the cap; old paid records are never silently removed.
- Ephemeral cache: pinned GitHub trees retain at most 40 entries for one hour; imports at most 100 for one hour; public reports at most 100 for 24 hours; public job details at most 100 for one hour; generic transient entries at most 200 for 24 hours. Each cache write immediately removes expired/oldest excess entries in its prefix. Startup and the existing one-minute scheduler also prune every ephemeral prefix, so unread stale entries cannot accumulate. Fixed market/Radar snapshot/index keys and all paid order credentials/signatures remain untouched. Evicted public data is refetched when needed; existing SQLite free pages may be retained for reuse instead of shrinking the file.
- Provider response readers reject oversized content (2 MiB for IMD, 4 MiB for GitHub) explicitly rather than presenting partial findings. SQLite retains jobs/sessions/watchlists and bounded Radar data. Nonces and expired sessions are pruned by the scheduler.

## Actual validation

On 2026-10-19, the local production Node entry point and service factories passed **10/10 backend interaction tests**:

```sh
LABS_TEST_ACCOUNTS_MODULE=/tmp/unlock-labs-build/node_modules/viem/_esm/accounts/index.js \
node --test services/labs/tests.mjs
```

The path above records this run's externally installed viem test signer. On another machine with the existing frontend dependencies installed, `node --test services/labs/tests.mjs` uses that installation. Production needs only the pinned runtime file already in the repository. Tests use random ephemeral accounts and mocked payment settlement; no test funds, paid mainnet submissions, account approvals or onchain writes occurred.

The tests cover nonce reuse, origin replay, expiry/logout, deployed ERC-1271 and unsupported counterfactual signatures, current positive/zero balance, ownership, unsafe repository URLs, path validation, scope/request-key conflicts, concurrent payment submissions, restart recovery, altered payload refusal, lost quote/payment responses, authoritative expired/unpaid renewal, payment failure, incomplete reports, safe source links, full PDF text/attachment, HTTP CORS, holder watchlists and CSV exports. A cache lifecycle test verifies hard per-write counts, hourly/daily expiry without cache reads, startup migration of older uncapped rows, and preservation of paid bearer/signature records plus fixed market/Radar state. `node --check` passed for the service modules.

Live **read-only** HTTP integration through the local server verified capabilities, import and check for the accepted UNLOCK repository (`c69ef33c084c608dea1a84b6ed050b43cd073336`), and an existing public completed audit `7db42bb7-5204-4805-894f-db1a2c11cd8e`. The check returned four specialists plus the judge and no blockers. The public report returned six accepted findings. Its generated PDF was independently parsed using PDF.js installed outside the repository: nine pages, 26,312 extracted characters, exact attached UTF-8 Markdown, and matching commit/job/date/evidence. No quote/payment was requested for that report. PDF pages 1, 2 and 9 were additionally rendered and visually inspected: metadata, wrapped source text, findings and footer remained readable; this was not a physical print test. The absence of `pdftotext`/Python pip was handled with the external PDF.js parser; no unperformed PDF visual review is claimed.

Not live-tested: public backend hosting, DNS/HTTPS provisioning, deployed login by a real customer, real token approvals, paid settlement/admission, paid job completion, EIP-7702 payment, contract-wallet login against a real mainnet account, and recovery after permanent loss of the persistent disk. Paid paths were simulated as required. The shipped frontend build/browser/design checks are recorded separately in the main validation documentation.
