# UNLOCK · Trade & Labs

Upgrade of the latest accepted source, `bf3b76251ac03dd93204a16f5a9807cab97287fe`, for **https://unlk-b35c.sites.imd.fun/**. The static delivery is `dist/`. It uses relative assets and hash navigation for IPFS/gateway subpaths. This job prepares that export; the IMD publisher retains the existing website name. No contracts, deployments, pools or economics are changed.

The existing Ethereum swap, quota ladder, claims, treasury/NFT inventory, wallet connectors and standalone English whitepaper remain. Labs is the default entry; Trade remains in the primary navigation.

## Use and rebuild

Node 24 is required by the separate SQLite service; Node 24 also builds the frontend. The existing `web/package.json` and lockfile are unchanged.

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Vite writes root `dist/`. Deliver its entire contents. `npm run dev` serves source. The inherited package name mentions Sepolia; this application uses Ethereum **chain ID 1**. Canonical local fonts are in `web/public/fonts/`, shared by the app and whitepaper. Duplicate source/built font copies were removed; fonts, licenses and required runtime assets remain complete.

## What ships

- **Markets:** compact sortable table, market-cap default with unknown caps last, separate FDV, organic gainers ticker, seven ranking views, search, liquidity/editorial filters, device watchlists and excluded-token URLs. Every market, badge and sponsored placement passes the same current eligibility gate.
- **Token details:** pool/timeframe/unit controls, real-swap OHLCV candlesticks, volume, crosshair, zoom/pan buttons, accessible value table, separated swaps/transfers/liquidity, paginated holders/traders, infrastructure exclusions and partial/unavailable P&L.
- **Profiles:** local image/content preview, deployment-based edit rights, immutable moderated submissions, owner-set price/duration/refund terms, exact order-bound UNLK transfer and durable duplicate-payment protection. Sponsored placements are separate from organic ranks.
- **Radar:** separate IMD/NFT/public-wallet views, balances and evidenced NFT ownership, transfer/trade distinction, device/server watchlists, bounded history, and configurable coincident-flow windows. Coincidence is not proven coordination.
- **Audit:** repository → immutable commit → file tree → public scope/cost confirmation → customer-funded payment → saved progress → HTML/PDF report. Existing nonce login, IMD x402/Permit2 integration and recovery remain. IMD payment and verified ETH→IMD funding are supported; unsupported USDC funding stays disabled.

## Connect your separately operated backend

**Only the static frontend is submitted for IMD/IPFS hosting.** Backend/indexer source, Docker, SQLite migration, health check and a configuration template are in `services/labs/`. No external service, bot, account or persistent server was deployed by this job.

The shipped `web/public/labs-config.json` has an empty `apiBase`. A successful health check is required before enabling backend features. Static mode provides local browsing, previews, GitHub file selection and labeled historical Radar observations. **No stale market listings are published.** Current charts, persistent sessions/orders, moderation, checkout, server exports and live indexing await your operated API.

See [service setup and connection](docs/backend.md), [eligibility, identities and data coverage](docs/labs-data.md), [implemented design](DESIGN.md), and [actual validation and limitations](artifacts/validation.md).

## Checks recorded for this upgrade

This revision reproduced and fixed all four reported defects: owner-read outages, per-token history certification, Radar decimal/identity handling and chart pan recovery. Production typecheck/build, 60 retained frontend tests and 52 backend/data/security tests passed. Chromium passed 14 interaction/reflow groups under `/preview/` at 320, 390, 768 and 1440 widths, including shorter chart series and separate same-symbol flows. Four axe scans found no violations in scanned states. Fixtures never enter `dist/` and do not establish a live service. See `.imd-responses.json` and `artifacts/validation.md` for finding outcomes and limitations.

Reproduce service checks from the repository root after frontend dependencies are installed:

```sh
node --test services/labs/tests.mjs services/labs/data.test.mjs services/labs/upgrade.test.mjs services/labs/revision.test.mjs
```

Browser checks use externally installed Playwright and `@axe-core/playwright`:

```sh
IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs \
IMD_AXE=/absolute/path/to/@axe-core/playwright/dist/index.mjs \
node web/scripts/check-upgrade.mjs
```

WebKit could not launch because system libraries are missing; physical wallets/devices, screen readers, real payments and production hosting were not exercised. The bounded Playwright script served and closed its own local preview. Backend regressions used isolated fixtures; no new live market eligibility was established in this revision. The earlier upgrade recorded failed position-log/sell checks, which establish **no** current eligibility. No funds, approvals, signed paid audit jobs or broadcasts were made.

Profile edit rights now require a verified current nonzero `owner()`. Non-Ownable tokens, including UNLK, remain unavailable for profile edits until a reviewed source/runtime-bound authority policy is added. An original requester or cached former owner never becomes authorized during an outage.

Historical reports under `web/evidence/` and other documentation are retained history, not results of this upgrade. The current run is identified in `artifacts/validation.md`.

## Treasury authority

Inventory and profile-payment treasury: `0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736`. The vault's immutable beneficiary remains `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9`. Inventory, original payer attribution and beneficiary withdrawal authority remain separate. Profile fees transfer only UNLK `0x99fa82b022be4575891a43b757bc770691e18fda`; they create no contract, approval, badge, organic rank or eligibility entitlement.
