# UNLOCK · UNLK / IMD

Update of the latest accepted source, `090436c1b4881eb1f980c826a2fe0127ea30d696`, for **https://unlk-b35c.sites.imd.fun/**. The committed static export is `dist/`; the publisher keeps the existing HTTPS/ENS site name. This repository update does not itself publish or deploy anything.

Trade is the default screen. Labs navigation, screens, badges, login/payment controls, runtime imports and published snapshots/config are removed. Old `#labs-*` links safely resolve to Trade. The archived frontend, backend, documentation and snapshots are indexed in [archive/labs/README.md](archive/labs/README.md); no stored orders, payment records, reports or browser storage were erased.

The existing Universal Router/Permit2 swap, quotes, slippage, approvals, quota checks, native claims, milestone ladder through $50M, treasury/NFT gallery and English whitepaper remain. Deployment identities, chain parameters, treasury identities and economics are unchanged. The shared trading wallet rejects nonzero native value at preparation and both signing validations; its retired Labs conversion exception and action metadata are no longer part of the public runtime.

## Install, preview and rebuild

Use Node 24 and the existing locked toolchain:

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Vite writes **root `dist/`**, including all required assets. Its base is `./`, and hash navigation works at IPFS/gateway subpaths. Preview the production export, not just `npm run dev`. Commit the complete export after rebuilding. Dependencies and caches are not committed. Existing manifests, lockfiles and build configuration have not been changed.

TradingView Lightweight Charts 5.2.1 is an unmodified local standalone renderer with upstream types, Apache-2.0 license, NOTICE text and public attribution. Its version, original files and SHA-256 hashes are in [the chart vendor record](web/src/chart/vendor/README.md). No CDN or additional package install is required for the chart.

## Chart data and controls

Only Ethereum **chainId 1**, UNLK `0x99fa82b022be4575891a43b757bc770691e18fda`, IMD `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` and official v4 PoolId `0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32` are admitted. The PoolManager address is never substituted for that PoolId. Provider symbols are not trusted for identity.

The default 1h view fits the available history. Select 1m/5m/15m/1h/4h/1D, candles/line and IMD/USD. Drag to pan, wheel/pinch to zoom, or use the keyboard-accessible navigation buttons. Reset fits the loaded range; fullscreen expands the chart. Crosshair OHLCV, a keyboard candle inspector and a recent-candle table provide exact values. No candles or volume are generated for empty intervals; line segments stop across inactive gaps.

GeckoTerminal's free exact-pool API supplies historical IMD and USD OHLCV directly to the browser. USD is its historical series, never a conversion of all past prices at today's IMD rate. Address/DEX identity and every OHLCV response are checked. The API calls IMD “VIBE”; both addresses match the official pool. First/older requests fetch at most 1,000 active bars, incremental refresh reconciles the recent 100, and the device cache holds up to 3,000 bars per series across six series. Older pagination resumes from saved timestamps. Coverage is partial and provider-limited; its OHLC opens follow its previous-close convention.

If the initial IMD source fails, the chart switches visibly to bounded mainnet Swap-log history. You can also select **Ethereum logs · IMD**. It scans only this PoolId at the official PoolManager, in pages of 2,000 blocks, up to 12 pages/96 log requests per read, with PublicNode/dRPC fallback. Each completed page persists, reload resumes, recent 12 blocks are reconciled and deep reorgs invalidate the cache. Cache is bounded to 6,000 trades; partial coverage and provider errors are explicit. RPC candles use actual post-swap `sqrtPriceX96`, while GeckoTerminal uses execution-average trade prices; the source/method is disclosed. RPC history supports IMD only: selecting USD requests the provider's historical series. These logs alone cannot supply historical USD.

Both sources refresh about every 30 seconds while visible, cancel obsolete reads and retain timestamped cached data on failure. Storage refusal falls back to memory. A provider outage can still prevent new history; retry/source controls explain recovery. Chart prices are informational. **Only actual contract state grants selling rights.**

## Checks and evidence

See [revision validation](artifacts/chart-revision/validation.md) for the two reviewed fixes, fresh production Chromium/mainnet checks, before/after error screenshots and wallet-guard regressions. The [original chart validation](artifacts/chart/validation.md), [source trade/receipt checks](artifacts/chart/source-verification.json), [original Chromium results](artifacts/chart/browser-results.json) and screenshots in `artifacts/chart/` remain historical evidence. [DESIGN.md](DESIGN.md) documents the final interface. Live mainnet/API checks are distinguished from injected empty/error responses.

To repeat the production browser checks with an external Playwright install:

```sh
npm install --prefix /tmp/unlk-browser-check playwright
IMD_PLAYWRIGHT=/tmp/unlk-browser-check/node_modules/playwright/index.mjs node web/scripts/check-chart.mjs
```

The script serves `dist/` under `/preview/` for its own lifetime and closes its browser/server. It requires Chromium (Chrome channel) and network access. It does not connect a wallet or submit a transaction. `--before` also captures the currently hosted site; use it only before publication when recreating a before/after comparison. The current screenshots were captured before this update was published. Physical devices, Safari/WebKit and screen readers remain outside the performed checks.

## Prepared commit

`artifacts/chart/change.bundle` carries the current revision commit, with accepted commit `faeca565632f6e9f7fafbc1878cd4b9dd734c3f9` as its parent/prerequisite. It replaces the previous round's transport bundle, whose source remains in history. It was prepared in an isolated Git directory so the protected workspace `.git/` was not edited. Source, the unchanged dependency lockfile, finished `dist/`, finding responses and revision evidence are in that commit. The transport bundle and its final packaging report are delivery attachments and cannot recursively contain themselves. See `artifacts/chart-revision/package-results.json` for the commit and size audit.

From an existing clone that contains the accepted base:

```sh
git bundle verify artifacts/chart/change.bundle
git fetch artifacts/chart/change.bundle HEAD
# Inspect FETCH_HEAD before applying the update to your branch.
```
