# UNLOCK chart and Labs removal validation

Worker observations for the update based on accepted commit `090436c1b4881eb1f980c826a2fe0127ea30d696`. This is a local static-export delivery for the existing HTTPS site. Nothing was published externally, deployed on chain, signed or transacted. These checks are worker evidence, not independent certification.

## Result and scope

The two requested changes are implemented: Labs is absent from the published runtime, and the main price view uses a maintained, real canvas trading chart for the exact official Ethereum v4 UNLK/IMD PoolId. The current mainnet swap/wallet, fees, contract guards, claims, rights, all gates through $50M, treasury/NFT wallet, Docs and whitepaper remain.

`dist/` contains the production export with relative assets. Its default Trade screen has the chart on the left and swap on the right at desktop; the swap comes first on phones. The 390×844 screenshot shows UNLK/IMD, live mainnet metrics, both swap directions, amount/slippage and the complete Connect to trade action (bottom 785.80px). Canvas height is 450px desktop and 360px mobile. The final screenshot also confirms real green/red bodies, wicks, aligned executed volume and readable axes.

The existing `.git/`, `.github/`, environment files, dependency/build manifests, lockfiles and Solidity dependencies were not edited. No deployment, approval, wallet signature or mainnet write was attempted. Backend/indexer code, stored-report/order/payment schemas and prior evidence remain; Labs snapshots were moved byte-for-byte outside the public directory. The obsolete prior Git transport archive was removed as packaging, not application data.

## Actual commands and outcomes

Dependencies were installed outside the repository with the **unchanged** `web/package.json` / `web/package-lock.json` and an external npm cache. An isolated exact copy of web/service source was checked using the existing scripts/configuration; its generated root export was copied back to `dist/`. No repository node_modules, registry mirror or dependency archive was created or committed.

| Check | Actual outcome |
| --- | --- |
| Locked `npm ci` with external cache | Passed |
| `npm run typecheck` (`tsc --noEmit`) | Passed |
| `npm test` (`tsx --test tests/*.test.ts`) | 67 passed, 0 failed |
| `npm run build` (`tsc --noEmit && vite build`) | Passed; Vite 7.1.7; separate lazy chart chunk |
| `node web/scripts/check-chart.mjs` | Passed on production `/preview/` export; Chromium 154.0.8037.57 |
| Pinned `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Measured all 16 checks; 14 passed; two reviewed exceptions below |
| Final targeted production smoke after the last source correction | Passed; live mainnet replay, all 23 displayed 1h OHLCV rows recomputed, responsive screenshots, console/local assets checked |

The full browser run used `IMD_PLAYWRIGHT` for an external Playwright install, a contributor mainnet transport for RPC reads and `UNLK_TEST_CHART_RELAY=1` to relay fresh public GeckoTerminal responses through the host's network proxy. The relay changes no prices, timestamps, identities, volumes or response fields, and is test infrastructure only. The production frontend fetches the public APIs directly; no relay/server is required by the static site. A direct Chromium fetch from the existing HTTPS site independently returned 200, 53 exact-pool IMD candles and correct token metadata before integration. Additional direct production-browser runs loaded every USD interval before the free provider began rate-limiting repeated checks. Direct access, relay transport and injected test states are not conflated.

The final full browser JSON records all six USD intervals, panned-range retention, canvas interactions, fullscreen and fallback, ordinary wallet/swap controls, 17 ladder levels, Activity, whitepaper, treasury links, all retired Labs deep links, responsive widths, mobile touch pinch, live RPC replay, reload and error/retry cases. `consoleErrors` in that report is the Playwright `pageerror` collection (uncaught script errors). The final smoke separately collected browser console error messages and failed local assets: all were empty.

## Live data evidence

- **Identity:** chainId 1; official PoolId `0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32`; UNLK `0x99fa82b022be4575891a43b757bc770691e18fda`; IMD `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`. The v4 PoolManager is a separate log-emitter address.
- **Primary:** [GeckoTerminal exact-pool API](https://api.geckoterminal.com/api/v2/networks/eth/pools/0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32). Pool metadata verifies the 32-byte PoolId, Ethereum DEX and both addresses; every OHLCV response verifies base/quote addresses. The API calls IMD “VIBE”; symbols never determine identity.
- **Historical USD:** requested with `currency=usd`, not computed from a current conversion rate. Historical IMD uses `currency=token&token=base`. No-trade bars are excluded explicitly. See [provider OHLCV semantics](https://docs.coingecko.com/reference/pool-ohlcv-contract-address).
- **Independent samples:** three exact-pool transaction receipts were decoded. IMD closes equal `abs(amount1/amount0)`, IMD volume equals `abs(amount1)/1e18`, and USD closes match the provider's corresponding historical trade prices (relative tolerance 1e-9). Each original sampled 5m bucket contained that trade. All raw signed legs, sqrt prices, hashes, timestamps and checks are in `source-verification.json`.
- **RPC:** the actual production browser indexed canonical Swap logs from the deployment block. The full run and final smoke record their block bounds/trade counts. The final smoke covered blocks 26211921–26232161 with 318 trades, independently recomputed all 23 displayed 1h OHLCV rows from the replay's ordered executed legs, and matched the UI table. Three raw receipt sqrt prices/legs were checked separately against that replay. No fixture was used for these prices or screenshots.
- **Incremental/cached behavior:** newest provider pages reconcile overlapping buckets; completed RPC pages persist. Replayed recent 12 blocks replace prior logs; changed canonical anchors invalidate the old index. Unit tests cover page failure/resumption, duplicate/reconciled data, invalid identities/bounds, cancellation, empty results and all intervals. The browser reloaded the production site and resumed an actual saved mainnet index.

Primary documentation for the renderer: [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs). The unmodified 5.2.1 runtime/types, hashes, Apache license and NOTICE provenance are recorded in `web/src/chart/vendor/README.md`. Both the library's attribution logo and visible NOTICE/TradingView link are published. No DEXTools assets or branding are used.

## Synthetic checks, clearly separated

These are explicit test injections in `web/scripts/check-chart.mjs`; none is evidence of live market activity:

1. Disable the native fullscreen API: the expanded fallback contains focus, makes background inert, and Escape restores the page.
2. Return HTTP 429 from the chart source: cached candles retain their timestamp and unconfirmed label; retry then returns to fresh public data.
3. Return valid exact-pool identity metadata with an empty OHLCV list: no candles or volume are generated, and the empty state explains inactivity.
4. Return HTTP 503 from both mainnet RPCs: the chart reports a recoverable failure; restore real RPC and retry to recover genuine candles and mainnet state.

Fixtures in the existing/new unit suites are simulated contracts/provider responses, not live account, payment or trade evidence. No fixture screenshots are presented as completion evidence.

## Better Interface review: six domains

The pinned workflow, all six domains' core principles and the implemented-design documentation method were read and applied while building. The requested emerald/monospace terminal direction remains authoritative. The one visual idea is a compact trading terminal: readable data and restrained emerald state, without a marketing hero.

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility | Checked native controls/labels, pressed/selected states, tab arrows, keyboard inspector, wallet dialog/Escape, fullscreen focus/background restoration, named tables, error/status states, visible source/freshness and 2px focus tokens | No screen-reader session or physical assistive technology; not a WCAG certification |
| Layout | Checked production at 320, 390, 768, 900, 1000, 1440; actual desktop/mobile screenshots viewed; no page overflow, clipped axes, overlapping text or obscured main action | Native browser 200% zoom and RTL were not tested; English only |
| Writing | Checked source/method, provider limit/retry, partial/unconfirmed/empty distinctions, actual-state rights disclaimer, control labels and archived-link redirects | Provider conversions/tracking remain external; historical completeness is not asserted |
| Typography | Local regular/semibold JetBrains Mono loaded; six source sizes, two weights, tabular data; wrapping identifiers and mobile 16px native chart selects | Native iOS input zoom untested; canvas text is paired with HTML data |
| Colors | Checked the actual dark surfaces and primary colors; pinned rendered solid-background text contrast check passed | No claim about every third-party NFT image or wallet app |
| UI | Checked loading, data, empty, cached, failure, retry, hover/pressed/focus, reset, line/candle, fullscreen and responsive states; reduced-motion probe shows no endless animation or transition-all | Safari/WebKit and physical devices unperformed; mobile touch was Chromium emulation |

Measured implemented pairs (computed from final rendered values): primary action `#09090b` on `#34d399`, primary text `#f4f4f5` on `#09090b`, and muted `#a1a1aa` on `#111114` meet 4.5:1; exact ratios are recorded below with packaging results. The probe also passed its rendered contrast check, share metadata, target-size baseline, type-size, tracking, layout and motion checks. It notes compact controls below the comfortable 44px recommendation; they remain at least 36px desktop/40px mobile, separate and above the 24px baseline.

## Findings fixed and rechecked

| Severity / source | Observed issue | Fix and recheck |
| --- | --- | --- |
| High · `web/src/App.tsx:5` | Retired hashes/default route mounted a disconnected research product | Default Trade; normalize all Labs hashes without importing the archive. Browser visited six legacy routes, found no Labs controls/config/snapshot requests. |
| High · `web/src/PriceChart.tsx:117` | Progressive replay could collapse a panned viewport to its first returned candle | Keep pending UTC range through backfill; fit automatically until a meaningful view exists. Browser interval/currency panning checks pass. Final smoke also changes source during initial loading and verifies that the replay still fits over two days. |
| High · `web/src/chart/chart.css:31` | Long provider errors could widen the 320/390px page to 522px | Wrap error/source text anywhere. Repeated probe and mobile live/failure checks show no page overflow. |
| Medium · `web/src/PriceChart.tsx:108` | Ordinary line rendering could connect across inactive intervals | Transparent outgoing segments over gaps plus separate observed-point markers. No empty candles, generated volume or interpolated trades. |
| Medium · `web/src/PriceChart.tsx` fullscreen control/effect | Fullscreen font glyph was unsupported; non-native expansion needed focus containment | Authored SVG and contained/inert expanded fallback. Native and injected-unsupported fullscreen tests pass. |
| Medium · `web/src/PriceChart.tsx` coverage text | Unverified/capped history could use wording implying full scan coverage | Distinguish unverified, capped/partial and deployment-reaching coverage; final export smoke checks the resulting live view. |
| Medium · `web/src/chart/chart.css:57` | Compact mobile native selects were 12px | 16px selects on phones; final computed source select font confirmed 16px. |
| Medium · `web/src/PoolActivity.tsx` | Replacing the old chart would remove its recent-trade disclosure | Retain independent official-pool Activity with timestamps, executed legs and transaction links; actual browser navigation loads genuine swaps. |

The probe's two remaining flags are reviewed exceptions, not hidden failures: `type-faces` objects to monospace prose, while the brief explicitly requires the existing monospace identity; `eyebrows` misclassifies functional network/risk disclosures, metric labels, refresh controls and navigation as promotional kickers. No small tracked capitals were added. Full unaltered probe check outputs plus these interpretations are in `taste-results.json`.

## Remaining data/testing limitations

GeckoTerminal is a free public service and returned intermittent timeouts/429s during repeated validation. IMD automatically falls back to mainnet logs when an initial provider request fails. USD needs the provider's time-aligned history; a source outage cannot be repaired by multiplying old IMD prices by today's rate. The UI offers explicit retry or mainnet/IMD recovery. Provider history starts when it tracked the pool, not necessarily at deployment, and boundary candles may be incomplete. Coverage and method are visible; provider opens may carry its previous close. The RPC cache is bounded to 6,000 trades/12 pages per read and may require further pagination. Browser storage denial falls back to memory, so persistence is then unavailable. Public RPCs can also fail.

The treasury gallery's retained live read returned zero held/verified NFTs in this run; the long interaction run correctly labeled that earlier snapshot stale. Wallet identity, collection code/balance reads, navigation and refresh UI were preserved. No positive NFT-image rendering is claimed for an empty holding. Transaction execution and physical wallet signatures were intentionally unperformed. Existing transaction guards and tests passed; code and economics are unchanged.

Before images came from the existing HTTPS deployment; after images came from the actual production export with live data. The last source correction was re-built/typechecked/tested and verified with the separate final live smoke; its screenshots replace the desktop/mobile/chart images. Hosting the committed export under the existing site name is the publisher's next step.

Complete for the stated implementation scope, with the external-provider and unperformed-device limitations above.

## Final rendered contrast and export

| Foreground / background | Ratio | Threshold |
| --- | --- | --- |
| `#09090b` / `#34d399` | 10.35:1 | 4.5:1 |
| `#f4f4f5` / `#09090b` | 18.10:1 | 4.5:1 |
| `#a1a1aa` / `#111114` | 7.35:1 | 4.5:1 |

`export-manifest.json` records every production file and SHA-256. All required runtime assets remain local; no snapshot backend, dependency cache, npm registry, dependency archive or submodule is included. The explicit `artifacts/chart/` evidence path budget is 1.5 MiB.

## Commit delivery

The workspace `.git/` is protected. The update commit was therefore created in an isolated Git directory, retaining the accepted base as its parent, and is delivered as `change.bundle`. `git bundle verify` confirms the SHA-1 update ref and the exact accepted-base prerequisite. All requested source/export/evidence files are committed; the unchanged lockfile remains in the tree. The bundle is a transport attachment generated after committing, so it does not recursively include itself.

A full old-history bundle cannot be produced from this worker's pinned checkout: Git reports a missing older historical tree object. This is resolved for delivery by the verified standard incremental bundle against the requester-provided accepted base; no history was rewritten and no requester input is needed. The current tree's complete source/runtime asset set is present. Payload and evidence budgets are checked separately before finishing.
