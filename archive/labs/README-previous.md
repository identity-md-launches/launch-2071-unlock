# UNLOCK · Trade & Labs

Upgrade of the latest accepted source, `cd95d08507d635239da996518ed0a7df4dc78338`, for **https://unlk-b35c.sites.imd.fun/**. The static delivery is `dist/`. It uses relative assets and hash navigation for IPFS/gateway subpaths. This job prepares that export; the IMD publisher retains the existing website name. No contracts, deployments, pools or economics are changed.

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

**Only the static frontend is submitted for IMD/IPFS hosting.** Backend/indexer source, Docker, SQLite migration, health check, doctor CLI and evidenced production seeds/configuration are in `services/labs/`. No external service, bot, account or persistent server was deployed by this job.

The shipped `web/public/labs-config.json` has an empty `apiBase`. A successful health check is required before enabling backend features. Static mode provides local browsing, previews, GitHub file selection and labeled historical Radar observations. **No stale market listings are published.** Current charts, persistent sessions/orders, moderation, checkout, server exports and live indexing await your operated API.

See [service setup and connection](docs/backend.md), [eligibility, identities and data coverage](docs/labs-data.md), [implemented design](DESIGN.md), and [current validation and limitations](artifacts/repair/validation.md).

## Repair and operator verification

Markets now retains a paginated catalog independently of per-cycle work, resumes fair queues, discovers representative sellers from successful swap receipts, checks actual allowances/quota and reports per-asset exclusions/recovery. Market cap is explicitly provider-reported and sourced, never FDV. Required editorial identities and INFER/OG ambiguities are documented. Official IMD SVG logos are supported securely.

NFT Radar replaces the 32-ID sample with durable deployment-to-head ownership reconstruction, canonical checkpoints and rotating owner/balance verification. IMD balances/flows have an independent queue and recent lane. Coverage stays visibly partial until reconstruction is complete; custody accounts are separated from individual whales. Immutable-token profile authority has an explicit source/runtime/registry policy; owner() failures never grant rights. The Audit file wizard retains selections across searchable file pages and keeps paid actions/order recovery guarded.

Reproduce bounded read-only mainnet diagnostics from the repository root:

```sh
node services/labs/doctor.mjs --db /tmp/unlock-labs/labs.sqlite --cycles 3 --output /tmp/unlock-labs/doctor.json
node web/scripts/serve-repair.mjs /tmp/unlock-labs/labs.sqlite
# Open http://127.0.0.1:4173/preview/#labs-markets, then stop the temporary preview.
```

This preview connects the REAL backend to the production export without changing the shipped empty API URL. See [operator setup](docs/backend.md) for persistence, HTTPS, provider configuration, migration/recovery and Docker commands. Source completion is not external hosting or ongoing indexing.

The fresh default database reproduced zero listings. Read-only repair diagnostics discovered 292 catalog assets and real recent IMD trades/candles/flows, but **zero tokens were admitted**: historical position-log access and representative seller allowances remain blocking. NFT evidence is **10 discovered / 2000 total**, with 0 IDs reconstructed from deployment history and archive backfill pending; it is not a global ranking. The supplied providers returned explicit archive/plan refusals, preserved in [doctor evidence](artifacts/repair/doctor.json). More code cannot grant provider access or create somebody else's approvals. No paid job, approval or mainnet write occurred.

Production Vite build, TypeScript check, existing frontend/service regressions, new repair tests and actual local API/browser interactions were run. Exact commands, results, screenshots, six-domain design review and limitations are in [repair validation](artifacts/repair/validation.md). The browser regression uses explicit isolated fixtures for partial/recovered P&L; real-mainnet diagnostics and integration checks are recorded separately. Report/PDF equivalence and simulated order/payment recovery pass without opening paid jobs.

After frontend dependencies are installed:

```sh
node --test services/labs/tests.mjs services/labs/*.test.mjs
IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node web/scripts/check-repair.mjs
```

The service suite defaults to `web/node_modules/viem` for test-only signing; `LABS_TEST_ACCOUNTS_MODULE` can point to an external viem accounts module when installs must remain outside the repository. `IMD_PLAYWRIGHT` enables the retained production-export attribution regression. The integration script expects the temporary real preview above. WebKit and physical wallets/devices were not validated: this worker lacks WebKit system libraries; Chromium was exercised at 320, 390, 768 and 1440 widths.

Packaging retains source, required runtime assets, fonts, ABIs, claims, static export and lockfile. Only the optional 2.3 MB esbuild WASM compiler archive was removed; normal locked Vite builds and an externally installed native esbuild are supported. The backend still verifies offline without npm. Historical evidence archives are preserved. See [vendor inventory](web/vendor/README.md).

Older reports under `web/evidence/` and `artifacts/validation.md` are retained history. The current run is `artifacts/repair/validation.md`.

## Treasury authority

Inventory and profile-payment treasury: `0xFe44fC8F6C32f681a0ce443902a0b08bB5B3C736`. The vault's immutable beneficiary remains `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9`. Inventory, original payer attribution and beneficiary withdrawal authority remain separate. Profile fees transfer only UNLK `0x99fa82b022be4575891a43b757bc770691e18fda`; they create no contract, approval, badge, organic rank or eligibility entitlement.
