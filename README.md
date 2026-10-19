# UNLOCK · Trade & Labs

This extends accepted commit `c69ef33c084c608dea1a84b6ed050b43cd073336` of [launch-2071-unlock](https://github.com/identity-md-launches/launch-2071-unlock). The existing Ethereum terminal, wallet connectors, swap, quotas, claims, treasury/NFT fixes, price chart and English whitepaper remain. No contracts, hooks, tokens, pools or economics were changed.

The complete static export is **`dist/`**, with relative assets and hash navigation. The retained website URL is **https://unlk-b35c.sites.imd.fun/**, under `unlk-b35c.site.identitymd.eth`. HTTPS returned 200 during this run, serving the prior site. This worker prepared the next export; publication of this revision has **not** been performed or verified.

## What is usable

- **Trade:** the existing mainnet terminal and whitepaper, with the original transaction review and chain guards.
- **Labs → Markets:** public search, liquidity/age filters, verified token/pool links and dated actual observations for 11 Ethereum launches plus separately featured IMD. Unsupported metrics say Unavailable.
- **Labs → Radar:** actual bounded buys/sells, plain transfers and settlement transfers, covered wallet holdings, indexed transfer flow, transaction links, periods and pagination. Coverage is incomplete and explicit; this is not a global holder ranking or profit calculation.
- **Labs → Audit:** public GitHub commit pinning and path checks work without the backend. The implemented backend performs the documented IMD import/check/quote/payment/status flow, persists owned orders and retrieves accepted judge findings with a matching downloadable PDF.

**The Labs backend is not publicly hosted.** Its source, durable SQLite store, bounded indexer, container and HTTPS proxy configuration are included. No authorized free hosting account, persistent disk and API hostname were supplied. Until an operator deploys it, the shipped site uses clearly dated snapshots and disables login, paid submission and holder tools. Static IPFS hosting cannot run server jobs. Exact setup, environment variables and the account/hosting blocker are in [docs/backend.md](docs/backend.md); provider limits and coverage are in [docs/labs-data.md](docs/labs-data.md).

## Install, preview and rebuild

Use Node 24 and the unchanged frontend manifest and lockfile:

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`, `/#labs-markets`, `/#labs-radar`, `/#labs-audit` and `/whitepaper/`. Vite writes root `dist/` with `base: "./"`; deliver the entire folder. `npm run dev` previews source. The inherited package name mentions Sepolia; the application is Ethereum **chain ID 1**.

This run installed build/browser tools outside the repository, copied `web/` source and its unchanged manifest/lockfile into a temporary build directory, then copied the complete Vite export back. No dependency installation, cache or new registry mirror is included. The existing pinned runtime under `web/vendor/runtime/` remains necessary for the dependency-free backend.

## Run the service

From the repository root, separately from the frontend preview:

```sh
LABS_SITE_ORIGIN=http://127.0.0.1:4173 \
LABS_DB_PATH=/tmp/unlock-labs/labs.sqlite \
LABS_PORT=8787 \
node services/labs/server.mjs
```

For local preview, set `web/public/labs-config.json`'s `apiBase` to `http://127.0.0.1:8787/api`, rebuild, and use that exact frontend origin. Production requires a persistent database path, the actual HTTPS API URL, and `LABS_SITE_ORIGIN=https://unlk-b35c.sites.imd.fun`. The shipped empty `apiBase` deliberately enables no payment destination or invented service. No private wallet key or paid provider is needed. [Backend deployment](docs/backend.md) covers the single-process Docker setup, Caddy, backups, ownership and quotas.

## Audit payment and access

Basic markets are public. Initially, **any positive UNLK balance on Ethereum** unlocks server-checked advanced rankings, comparisons, saved watchlists and CSV exports. Login signs a nonce bound to this domain, chain and five-minute expiry, with a one-hour session. It needs no spending approval or staking. The server rechecks current balance; a zero-balance account can still buy and recover its own audit.

Audits use `template: "audit"`, a full pinned commit, checked paths and a current quote. The price and recipient come from IMD capabilities/quote, not a hardcoded payment address. Labs adds no markup. Payment is a separate exact IMD Permit2 signature plus a quote-bound EIP-712 signature. If needed, an exact-amount IMD approval is a separate gas-paying transaction. Signed bytes and order/job mapping persist before dispatch; retries and reloads recover the same order. Pending, failed, refused, blocked and expired outcomes do not imply completion, a refund or guaranteed findings.

ETH funding uses the verified native ETH/IMD v4 pool, exact output to the customer's wallet, a bounded maximum input and an unused-ETH refund to that same wallet. Conversion, IMD approval and audit payment are separate explicit steps. A failed conversion cannot submit a job. The original terminal's zero-native-funding guard now has one narrow exception: exact verified Labs calldata, account, pool, output, limit, freshness, expiry and refund recipient are rechecked before review and signing. Existing UNLK swaps still cannot send ETH.

**USDC is disabled:** no supported exact-output USDC→IMD route was verified. Ordinary contract wallets cannot pay IMD's current API; EOAs and EIP-7702 accounts are supported by its documented protocol. Deployed ERC-1271 wallets can log in. Unsupported routes/wallets have explicit reasons rather than speculative approvals.

Code and accepted reports are public. Reports show severity, affected source, evidence/reproductions, recommendations, scope, commit, job ID and date. Content renders as text; only approved HTTPS source links are followed. The PDF includes the complete accepted Markdown and embeds its exact UTF-8 original. Core PDF fonts display unsupported codepoints as visible Unicode escapes. AI review is never a security guarantee.

## Preserved treasury authority

| Role | Address |
| --- | --- |
| Treasury balances / NFT inventory | `0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736` |
| Immutable vault beneficiary | `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9` |
| UNLK | `0x99fa82b022be4575891a43b757bc770691e18fda` |
| IMD | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |

Inventory uses the new treasury. Beneficiary validation, withdrawal authority and payer attribution remain separate. The cash path remains PoolManager claims → vault redemption → beneficiary withdrawal → separate manual transfer to treasury. No automatic NFT purchase or cash movement was added. The standalone whitepaper and native recovery/proof assets remain complete.

## Checks actually run

The final source passed TypeScript and the Vite production build. **60 frontend tests, 10 backend tests and 11 data/indexer tests passed.** Production Chromium checks exercised the retained terminal/whitepaper and both Labs public and simulated protected flows at 320, 390, 768 and 1440 widths (terminal also 1000). Checked pages had no page overflow, uncaught script errors or failed local resources. Automated axe scans found zero violations on the scanned terminal, chart, whitepaper, Audit and Radar states.

The paid-browser fixture used real cryptographic signatures from an ephemeral test account, with mocked IMD/RPC settlement. It verified login/disclosure, two payment signatures, retries/reload recovery, ownership, zero balance, expiry, wallet/network changes, refused/blocked/expired jobs, safe accepted reports and PDF download. It sent **zero broadcasts**. These are simulated payment results, not a mainnet purchase.

Live read-only checks verified the current GitHub head, deployed mainnet bindings, supply, 16 gates, beneficiary/NFT identity, IMD capabilities/import/check, registry/pool data, an existing accepted report and its PDF. The ETH exact-output quote and router `eth_call` passed; the latter used a temporary account-balance override and changed no state. No mainnet funds were spent and no paid test audit was submitted. Evidence is in `web/evidence/labs-*.json` and [artifacts/validation.md](artifacts/validation.md).

Reusable checks, after installing Playwright/axe externally:

```sh
node --test services/labs/tests.mjs services/labs/data.test.mjs
IMD_PLAYWRIGHT=/path/to/playwright/index.mjs \
IMD_AXE=/path/to/axe-core-playwright/dist/index.mjs \
node web/scripts/check-labs-markets.mjs
IMD_PLAYWRIGHT=/path/to/playwright/index.mjs \
node web/scripts/check-labs-audit.mjs
IMD_PLAYWRIGHT=/path/to/playwright/index.mjs \
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

The service tests use the normal frontend `viem/accounts` installation, or the `LABS_TEST_ACCOUNTS_MODULE` override documented in [backend.md](docs/backend.md). Browser scripts own bounded local previews at `/preview/`; payment fixtures never forward writes. The pinned probe is an assignment input and is removed by delivery; its actual results are recorded in validation.

The Better Interface review covered all six domains and fixed applicable findings. The pinned probe passed **14/16**: retained functional terminal labels triggered its eyebrow heuristic, and monospace prose is explicitly required by this assignment. [DESIGN.md](DESIGN.md) describes the final tokens and components. WebKit could not launch because host runtime libraries are missing. Physical devices, screen readers, native 200% zoom, production hosting and real paid settlement remain unverified.

## Bundle and historical evidence

The complete current-tree Git bundle must remain below 8 MiB. Historical documentation evidence is preserved byte for byte in a lossless archive, with original SHA-256, Git blob, mode and path metadata. No runtime, required fixture, contract source, dependency manifest, lockfile or build configuration was removed. Some older evidence-check scripts require explicitly restoring their historical inputs first. See [historical evidence](docs/labs-historical-evidence/README.md).

```sh
python3 scripts/labs/evidence-archive.py
python3 web/scripts/check-bundle.py
```

Default archive verification writes nothing. No ignore file was changed. The delivery system commits/submits this tree and pins `dist/` under the existing site name; this worker did not create a replacement site, change DNS or publish an unhosted backend.
