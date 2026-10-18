# UNLOCK update validation · 18 October 2026

## Chart RPC error revision · 18 October 2026

**Complete locally for the reported defect.** Finding `55339c60e263be4d2d936a231ad74566c325dc45923b87bed857f1c6faa33d77` reproduced on the supplied accepted export (`5ce9d4a`). `web/src/PriceChart.tsx:63` rendered the entire viem error, including an unbroken JSON request body. Returning JSON-RPC code `-32000`, message `Controlled history RPC failure`, for `eth_getLogs` on both configured providers expanded the page to 1,573px at 320/390px and 1,645px at 1440px. Other requests used real read-only Ethereum state.

The fix replaces raw provider diagnostics with **“History unavailable. Retrying in {seconds}s.”** and adds `overflow-wrap: anywhere` to `.price-chart .notice.error` (`web/src/styles.css:1540`). It preserves the existing backoff, Retry chart button, dated snapshot retention and stale labels. No contracts, chain/RPC configuration, treasury identities, wallet/signing code, swap/claim logic, economics, dependency manifests or lockfiles changed. The complete production `dist/` was rebuilt from the unchanged lockfile using tools installed outside the repository. `.gitignore` adds one exact-path exception for the requested root `.imd-responses.json`, with an explicit 4,096-byte budget; the response was otherwise ignored and is 1,027 bytes. Existing dependency/cache exclusions stay in place.

The dedicated `web/scripts/check-chart-error.mjs` regression serves the actual production export at `/preview/`. It checks cold failures, keyboard-activated retries, successful provider recovery and failures with a retained stale chart at each width. It also temporarily places an intact treasury address and official PoolId in the same alert to test defensive wrapping without clipping or ellipsis. Results are in `web/evidence/chart-error-revision.json`.

| Viewport | Original scrollWidth | Fixed cold / stale scrollWidth | Retry and recovery |
| --- | --- | --- | --- |
| 320×844 | 1,573px | 320 / 320px | Passed |
| 390×844 | 1,573px | 390 / 390px | Passed |
| 1440×844 | 1,645px | 1440 / 1440px | Passed |

Actual revision checks:

- External temporary copy of `web/`, unchanged manifest/lockfile: `npm ci`, `npm run typecheck`, `npm test` (**45 passed, zero failed**) and `npm run build` (**Vite 7.1.7, 507 modules, exit 0**). Existing treasury/beneficiary, NFT ownership, chart math/timestamps/reorgs and swap/claim regressions remain green.
- `IMD_PLAYWRIGHT=<external module> PLAYWRIGHT_BROWSERS_PATH=<external browser directory> node web/scripts/check-chart-error.mjs --rpc <contributor read-only endpoint> --proxy --reproduce --out test/scratch/chart-error-before`: passed against the original export; then the same command without `--reproduce`, with `--out test/scratch/chart-error-after`, passed against rebuilt `dist/`. Both runs used live reads and controlled log failures on both configured RPC hosts; zero write attempts, page exceptions or missing local resources. An initial test-harness retry timeout was corrected by restoring the original DOM nodes after the long-text stress check; the final full run passed.
- `IMD_PLAYWRIGHT=<external module> PLAYWRIGHT_BROWSERS_PATH=<external browser directory> node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline`: **14/16**. Render, layout, contrast, targets, tracking, sizes, metadata and motion passed. The existing two heuristic findings remain: explicitly required monospace prose, and functional labels/tabs misclassified as decorative kickers. Neither warrants changing accepted terminal styling. This probe measures the default ladder; the dedicated regression measures the chart failure states.
- Inspected actual screenshots `test/scratch/chart-error-before/chart-error-390.png`, `test/scratch/chart-error-after/chart-error-390.png` and `test/scratch/taste/shots/390.png`. The fixed error wraps, chart/controls remain readable, and the default first screen at 390 shows UNLOCK, the swap and its Connect to trade action. Screenshots are disposable scratch, not delivery dependencies.
- `node web/scripts/check-export.mjs`, `python3 web/scripts/check-bundle.py` and `git diff --check`: final export/size/path/whitespace checks; current exact export digest and byte counts are recorded in `web/evidence/export-manifest.json` and `web/evidence/submission-check.json`.

Scoped Better Interface review after the final source change:

| Domain | Coverage and result | Limits |
| --- | --- | --- |
| Accessibility | Preserved alert semantics, tested named Retry chart via keyboard Enter and recovery at all three widths. | No screen-reader session or new full-page axe scan. |
| Layout | Measured the original failure and fixed cold/stale states at 320/390/1440; reviewed the 390 chart screenshot and main action. | No physical-device or browser-native zoom test. |
| Writing | Short factual failure message states the retry delay and retains the explicit recovery action; stale data remains labeled. | No new copy outside the reported error. |
| Typography | Preserved local fonts/type scale. Checked `overflow-wrap:anywhere`, intact long identifiers and no clipping/ellipsis. | Long-identifier stress check uses temporary test DOM content. |
| Colors | Preserved existing error/status tokens; final probe measured default rendered text contrast successfully. | No separate contrast measurement of the chart alert; its color declarations are unchanged. |
| UI | Exercised cold loading/failure, keyboard retry, recovery and retained-stale failure; no raw provider request body is shown. | Chromium with emulated touch viewports; Safari and physical touch were not rerun. |

This is a local revision, not evidence of publication. No publishing or wallet transaction was performed. The existing hosting/delivery flow must publish the rebuilt export to the existing URL. The broader validation below remains the historical accepted-update record and was not all rerun for this narrow fix.

## Scope and result

Source and the complete static export continue commit `1c9927c137c4e4a3a4f6999ce9636ec29a4b89db`. The compact terminal, swap/claim code, verified mainnet ABIs/configuration, local fonts and all sixteen unlock gates remain. This update changes treasury inventory/balance reads, adds the English whitepaper and upgrades pool history into the Price chart tab. No contract source, economics, activation, package manifest, dependency lockfile, `.gitignore` or protected dependency was changed.

**Local implementation and checks are complete. Actual publication remains incomplete:** the existing HTTPS hostname still serves its prior CID. No launch-bound existing-site update writer is exposed. The generic installed CLI advertises publishing a contributor's own machine-signed site; that does not establish an update path for this existing launch site. No replacement site/name was created. The delivery service must pin `dist/` under the existing `unlk-b35c.site.identitymd.eth` name and verify the same URL after publication. No requester-only value is missing.

## Requirements checked

| Requirement | Evidence and outcome |
| --- | --- |
| New treasury, immutable old beneficiary | `treasury.ts`, `mainnetReader.ts`, `nftInventory.ts`; tests reject substituting the new wallet for the vault beneficiary and exclude old-beneficiary/visitor NFT ownership. Live runtime/binding/accounting checks passed. |
| Live cash path / no double-counting | Separate accrued, pending, redeemed, withdrawn, claimable, donations, vault balances and external treasury balances. UI and whitepaper explain claims → redeem into vault → beneficiary withdraw → manual transfer. No automatic movement added or executed. |
| Official NFT filtering, ownership, pagination and safe images | Existing bounded metadata/image safety, cursor checks and ID/image/error/stale states retained. Inventory now exclusively uses the new wallet and rejects stale RPC blocks. Mocked pagination/ownership/image safety tests pass; fresh indexer/onchain reads agree the new wallet is empty. |
| Versioned English `/whitepaper/` | Physical static HTML export with visible header/footer links, all rules/risks/addresses, reviewed ABI/source links and Print / Save as PDF. Browser generated a PDF of the matching print document in disposable scratch. |
| Live official-pool chart | Only the specified UNLK/IMD PoolId/PoolManager; canonical block timestamps; post-swap sqrt-price OHLC; executed pool-leg volume; intervals, style, crosshair, keyboard inspection, touch/pinch/pan/zoom; separate current spot/last trade/freshness/partial coverage. |
| Honest unavailable/empty data | Chart failure retains dated cached data, marks it stale and reports retry backoff. Verified empty ranges have no candles; no-trade gaps are blank. No historical USD series or all-time coverage is claimed. |
| Refresh/caching/reorgs | ~15s non-overlapping refresh, in-memory per-reader/range cache, recent 12-block rescan, deduplication, canonical-hash checks/deep reorg reset, bounded range splitting, cancellation and failure backoff to 120s. |
| Existing interactions / no wallet transactions | Encoding/fees/quota/proof regressions pass. Production browser obtained a real quoter result using a read-only injected account, switched chain state and checked claim controls/proof rejection. Signing and RPC writes were forbidden; write count was zero. |
| Static export / metadata / phone first screen | `dist/index.html`, required runtime assets, local fonts, claims, recovery and whitepaper included. Relative asset URLs verified. Title, favicon, description, og:title and og:image present. Full primary action visible at 390×844. |
| Source, build, design and byte budget | Unchanged dependency lockfile retained. Production build/typecheck/tests executed. `DESIGN.md` documents actual implementation. Export and complete current-tree Git bundle measured by the included checkers. |

## Fresh deployed-state evidence

`web/evidence/update-live.json` records a read-only chain-1 snapshot at block **26,218,144**, hash `0x65a1bde5e9c2c1d7ae30900e0f61a95397a7eab943b1bfa5ed223e1711c10fdf`.

- Runtime/provenance and exact token, IMD, hook, vault, official PoolKey/PoolId, PoolManager, router, quoter, Permit2 and companion bindings passed.
- The fixed 1-billion supply and all 16 deployed gate thresholds matched source/UI constants. Trading was active; tier 1 / 25% was stored even though the current valid FDV was below its earned $100K gate, consistent with no relocking.
- `50.187586664686516961` IMD had accrued and been redeemed; all remained claimable in the vault. Withdrawn fee total and pending fee claims were zero at that block. No transaction was sent to obtain these observations.
- New treasury IMD, UNLK and official NFT balances were zero. The official NFT name and runtime hash matched. Fresh Blockscout discovery returned an empty page with no next cursor (`update-inventory.json`). No ownership or fee-funded-purchase claim is inferred from the empty inventory.
- The 2,000-block chart scan returned **13 actual Swap events**, with actual timestamps, signed deltas and post-swap prices. The evidence stores its coverage and last ten events, with the total count separately.

These values are evidence at a particular block, not frontend constants. Public sources are named in the reports; contributor endpoint details are not delivered.

`update-source-verification.json` is a separate **offline** comparison of retained compiler/source/runtime evidence for token, hook, vault, oracle and evidence. All matched; canonical token/hook ABI hashes match the deployment manifest. Fresh runtime checks then matched the same pins. Neither check is an Etherscan verification claim or an independent security audit.

## Better Interface review

Applied the supplied Better Interface workflow and core principles for all six domains during implementation. The existing terminal direction has priority; no new typography, branding or decorative design was introduced.

| Domain | Coverage | Result / limits |
| --- | --- | --- |
| Accessibility | Checked native controls, labels, tab keyboard arrows, inspector range, focus trapping/return, errors/status, touch controls; automated axe on terminal/chart/whitepaper | Checked browser states have zero violations. Focus/keyboard behavior exercised. No screen-reader or physical-device session; native 200% zoom unperformed. |
| Layout | Checked production export at 320/390/768/1000/1440, first phone screen, chart/whitepaper widths and static subpath navigation | Mobile header overflow reproduced and fixed. Swap first, full main CTA visible at 390. Named tables/rails contain their own horizontal scroll. |
| Writing | Checked treasury vs beneficiary vocabulary, cash path, live/unknown/stale labels, chart units/coverage, whitepaper rules/risk/custody and action labels | No exact combined-2% fee claim, historical-USD repricing, fee-funded inventory claim or implied independent audit. Error states offer retry/refresh. |
| Typography | Checked local fonts, six size tokens, two weights, tabular values, wrapping addresses, responsive axis gutter, reading measure and printed document | Fonts confirmed loaded; mono prose retained because explicitly requested. Scientific notation keeps small pool prices inside the SVG axis gutter. |
| Colors | Reused original palette; probe measured resolved solid text pairs; inspected state cues | Measured text contrast passes. Current/future/selected and rising/falling states have labels/geometry. Arbitrary external NFT image contrast and every unvisited state remain unverified. |
| UI | Checked component rest/selected/focus/disabled/loading/empty/error/retry, chart gesture controls, native dialog, print action and reduced-motion declarations | Flat existing borders/corners preserved; no new animation. Physical wallet apps/Coinbase passkey enrollment, reduced-motion OS settings and animation-panel slow playback were not exercised. |

### Findings, fixes and rechecks

| Severity | Source | Finding → fix → recheck |
| --- | --- | --- |
| High | `web/src/mainnetReader.ts:431`, `:446`; `web/src/nftInventory.ts:46` | Old single custody/beneficiary identity could misattribute the requested inventory change. Added distinct constants and treasury snapshot; all balance/discovery/ownership reads use new treasury, immutable beneficiary validation stays old. Unit and live binding checks pass, including rejecting the wrong beneficiary. |
| High | `web/src/poolHistory.ts:40`, `:52`, `:154`, `:265` | Previous history used evenly spaced event indices and had no OHLC/incremental refresh. Added real block timestamps, unit-aware observed OHLC, actual volumes, incremental cache/reorg protection and stale/error states. Unit cases and production browser refresh/failure/empty checks pass. |
| High | `web/src/styles.css:1264` | Probe reproduced 442px page width at 390 after adding Whitepaper navigation. Allowed compact navigation to wrap. Rerun probe passes layout at 320/390/1440; production browser checks additional intermediate widths. |
| Medium | `web/src/PriceChart.tsx:256`; `web/src/styles.css:1589` | A fixed large SVG viewBox would shrink chart labels on phones. Use rendered-width coordinates with 12px axes and compact numeric labels. Inspectors/tooltips remain outside the plot; 320/390/1440 chart checks pass. |
| Medium | `web/src/PriceChart.tsx:97` | Rendered chart axis extended one interval beyond the scanned block. Ended it at the actual block timestamp and labeled boundary buckets partial. Browser now asserts the axis endpoint matches the snapshot clock. |
| Medium | `web/src/NftGallery.tsx:126` | A fresh request timestamp alone could hide an old RPC head. Reject stale NFT blocks before verifying ownership. Empty/indexer error/recovery checks and ownership safety tests pass. |
| Medium | `web/src/App.tsx:56`; `web/public/whitepaper/index.html` | Prior inline “Whitepaper” section was not a standalone readable page. Added physical English page, contents, source links, version/date and matching print view. Subpath navigation, local fonts, print call/PDF and mobile reflow pass. |

The final pinned taste@1 probe passed **14/16**. Its remaining candidates were reviewed: `type-faces` flags mono prose, which the brief explicitly preserves; `eyebrows` treats functional status strips, tabs, ledger fields and links as kickers. They are functional data/navigation, so deleting them would remove useful information. No marketing kicker or generic redesign was added. All render/layout/target/contrast/tracking/size/copy/share/motion checks pass. Full result: `web/evidence/update-design-probe.json`.

## Commands and actual outcomes

Commands below used the unchanged package/lockfile in an external temporary build workspace to respect the assignment's path restrictions. Raw output is in `web/evidence/update-{typecheck,unit-tests,build}.txt`.

| Command | Outcome |
| --- | --- |
| `npm ci` | Passed; dependencies installed outside the repository |
| `npm run typecheck` | Passed |
| `npm test` | **45 passed, 0 failed**, including treasury/beneficiary, NFT ownership, units, timestamped OHLC/gaps, deduplication, incremental/deep reorg, stale/error/range/cancellation cases and existing swap/claim math/proof regressions |
| `npm run build` | Passed; Vite production export, no source maps |
| `node web/scripts/verify-mainnet-source.mjs` | Passed retained compiled/source/runtime/ABI comparisons; offline evidence explicitly labeled |
| `tsx web/scripts/verify-update.ts` with contributor RPC | Passed fresh read-only chain checks and official-pool log scan; public source names retained |
| `node web/scripts/check-update.mjs` with external Playwright/axe modules | Passed production Chromium interaction checks; reports checks/states and zero write count in `update-browser.json` |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Ran on final export; 14/16 with two documented brief/heuristic exceptions |
| `node web/scripts/check-export.mjs` | Passed relative/runtime assets, required evidence, protected paths, no submodule/cache checks; exact file hashes in `export-manifest.json` |
| `python3 web/scripts/check-bundle.py` | Passed complete current-tree snapshot budget with reserve; actual final byte count in `submission-check.json` |

Browser checks use real mainnet RPC reads routed through the contributor's service, with a test-only read-only EIP-6963 provider and controlled log/indexer failures. NFT UI discovery responses are mocked empty; actual ownership discovery is separately recorded. No funds, signing request, transaction or wallet secret was used. Quote rendering/simulation does not establish that an actual signed swap/claim would settle. New contract/fork tests were not required for unchanged contracts and were not run.

The MCP browser could inspect the public HTTPS site but could not reach the worker's loopback preview. Local Playwright therefore owned and inspected the production preview under `/preview/` in one bounded process. Screenshots were inspected directly, not inferred from source. Delivered images: `artifacts/terminal-mobile.jpg`, `terminal-mobile-ladder.jpg`, `terminal-desktop.jpg`; chart screenshots and generated print PDF were inspected in disposable scratch.

## Publication and remaining limitations

Fresh HTTPS results are in `artifacts/https-results.json` and `web/evidence/publication-status.json`. The same hostname and canonical URLs are retained. The current public root is reachable over HTTPS; the whitepaper update is not yet live. No publication is claimed from a local build or screenshot.

WebKit installation completed but launching failed for missing system libraries. Safari/iPhone, physical pinch/scroll behavior, real wallet apps/signatures, assistive technology and native 200% zoom remain unverified. Public data is bounded, recent history may reorganize, and no time-aligned historical USD series is available. These are explicit limits, not synthetic fallback data.

The complete submission includes source, existing lockfile, local fonts, reviewed ABIs, native proofs, static runtime assets, tests and documentation. No generated dependency/cache directories, unnecessary npm archives or submodules were added. Existing historical evidence is retained separately from the `update-*` records.
