> Historical validation from the accepted predecessor. Current repair results, mainnet limitations and screenshots are in [repair/validation.md](repair/validation.md).

# Attribution-quota revision · 2026-10-19

Current worker-recorded validation for finding `bdf5d73ecc9709eb3aa9a0547564c0b9c6cad73809c8979f3077c467200e6ffb`. The accepted frontend and its design are retained. Changes are limited to attribution persistence/retry, P&L certification, regression tests and documentation. The separately operated service was not deployed; no paid job, signature, approval or chain write was made. Earlier sections below are prior-run evidence.

| Check | Actual result |
| --- | --- |
| Reproduction | An isolated copy of the original production indexer/token API with the reviewer's 26-transaction fixture retained 78 logs, raw blocks 120–310, no omissions and `completeHistory=true`, but returned one buy/one sell, supported realized 4 / unrealized 12. The new partial-status assertion failed against that baseline |
| Correction | Versioned per-swap attribution states and separate asset/PoolId attribution coverage persist pending/unresolved gaps. The bounded queue retries old transactions beyond the 12-block overlap and preserves completed canonical work. Unexplained wallet settlements are unknown inventory. Raw log/candle coverage remains independent |
| Exact regression | Initial corrected response: two pending transactions, partial P&L, both totals null. Next refresh: two buys/two sells, supported realized 14 / unrealized 12. All 78 logs and exact candle arrays are unchanged |
| Other regressions | New traffic cannot starve older pending transactions; transaction/receipt outages and missing receipts retry; ambiguous routing stays unresolved; legacy caches fail closed; real SQLite restart resumes the old attribution backlog |
| Service/browser suite | 62/62 cases passed: 61 service cases plus the opt-in production-export attribution case. The latter passed in Chromium at 390×844 and 1440×900 using production `createIndexer`/`createTokenData` responses, checked the actual partial/recovered trader cells and coverage text, retained real candles, and found no page overflow, uncaught errors or missing local resources |
| Frontend | `npm run typecheck`, `npm test` (60/60), and `npm run build` passed in a disposable `/tmp` copy using unchanged manifest/lockfile. Vite 7.1.7 built 523 modules. `diff -qr dist /tmp/dist` returned no differences; the retained complete `dist/` is exactly the new production output |
| Existing interactions | Retained `check-upgrade.mjs`: 14 Chromium interaction/reflow groups passed at 320/390/768/1440, plus four axe scans with zero violations and no uncaught script or local-resource errors. Covered search/filter/watchlist, excluded URLs, charts, P&L gaps, Radar, Audit scope/recovery controls, profiles, wallet sheet, Trade, Treasury and whitepaper |
| Design probe | taste@1 passed 13/16: render, layout, targets, contrast, tracking, sizes, glyphs, slogans, repetition, copy budget, surfaces, motion and share metadata. The same three accepted flags remain: requested brand capitals/monospace and navigation/status text misidentified as kickers |
| Mobile first screen | Inspected the actual 390px production screenshot: product, Refresh checks and market search are visible. Title, description, favicon, og:title, og:image and relative runtime assets remain present |

Tools/dependencies were installed only under `/tmp`; no repository package/dependency/build configuration changed. The first disposable frontend test run lacked the existing `docs/candidate/network/nft-ownership.json` fixture and passed 59/60. Copying that unchanged fixture into the temporary build context restored 60/60; no application change was needed.

Commands actually run:

```sh
npm ci --prefix /tmp/unlock-attribution-build --cache /tmp/unlock-attribution-npm-cache --no-audit --no-fund
npm run typecheck --prefix /tmp/unlock-attribution-build
npm test --prefix /tmp/unlock-attribution-build
npm run build --prefix /tmp/unlock-attribution-build
diff -qr dist /tmp/dist
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-attribution-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-attribution-browser/node_modules/playwright/index.mjs \
  LABS_TEST_ACCOUNTS_MODULE=/tmp/unlock-attribution-build/node_modules/viem/_esm/accounts/index.js \
  node --test services/labs/tests.mjs services/labs/data.test.mjs services/labs/upgrade.test.mjs services/labs/revision.test.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-attribution-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-attribution-browser/node_modules/playwright/index.mjs \
  IMD_AXE=/tmp/unlock-attribution-browser/node_modules/@axe-core/playwright/dist/index.mjs \
  node /tmp/unlock-attribution-smoke/web/scripts/check-upgrade.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-attribution-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-attribution-browser/node_modules/playwright/index.mjs \
  node .imd/reads/skills/design-critic/scripts/taste.mjs --out /tmp/unlock-attribution-taste --offline
git diff --check
```

The smoke script was an unchanged copy of `web/scripts/check-upgrade.mjs`, with its temporary project pointing to the real production `dist/`; this kept its scratch/generated screenshots outside the repository. New fixture screenshots are also only in `/tmp` and never ship as token data. The exact attribution browser case is retained in `services/labs/revision.test.mjs`; set `IMD_PLAYWRIGHT` to enable it, otherwise it explicitly skips.

Applied the pinned Better Interface guide across all six domains, scoped to the affected trader/coverage states and retained production surfaces:

| Domain | Coverage | Limits |
| --- | --- | --- |
| Accessibility | Native trader-view/timeframe/disclosure controls, text status independent of color, reachable horizontal table, retained keyboard interactions, target probe and four axe states | No screen-reader, physical-device or forced-colors session |
| Layout | Actual first screen at 390; partial/recovered rows at 390/1440; retained route reflow at 320/390/768/1440; tables scroll locally | Native 200% zoom, RTL and exhaustive content lengths unperformed |
| Writing | `services/labs/token-data.mjs:44` names pending/unresolved counts and states totals are unavailable; existing row status explicitly says partial. No false complete-history claim is used as P&L certification | Operator-authored content and wallet-provider copy not reviewed |
| Typography | Existing JetBrains Mono 400/600, six-size source scale, readable values/coverage text, retained loaded-font test and size probe | Native text zoom/print unperformed |
| Colors | Existing source tokens retained; rendered contrast probe and four axe scans passed; no new color encoding | Every third-party image/expanded state not measured |
| UI | Partial-to-supported transition, no invented totals, unchanged real chart history, retained loading/empty/error/recovery interactions and reduced-motion probe | No real wallet/payment/audit success or slow-motion animation replay |

High finding fixed at `services/labs/indexer.mjs:140` and `services/labs/token-data.mjs:42`: raw-log completeness previously certified P&L despite dropped attribution. Separate persisted attribution proof and fair bounded retries now gate numerical totals. API tests, restart tests and the rendered production responses passed. No visual redesign or additional unrelated fix was justified. `DESIGN.md` documents the existing table/disclosure behavior for the final implementation.

WebKit was installed but could not launch because required GTK/GStreamer and related system libraries are absent; Safari rendering remains **unperformed**, not passed. Physical wallets, mainnet spending, screen readers, Docker, external hosting and operator backend connection were not tested. No live token eligibility or real wallet attribution is asserted. The static API URL remains empty; backend-dependent live features await the operator. Attribution withholding is deliberately conservative for the whole token/PoolId, and unsupported routing or seven-day retention can keep P&L unavailable.

Complete for the reported service-source defect and retained static export, with the browser/operation limits above. `.imd-responses.json` answers the finding as fixed.

Final packaging: the complete current-tree Git snapshot bundle is below **8,380,000 bytes** (8,388,608-byte limit). The existing bundle probe was evaluated with temporary Git metadata entirely under `/tmp`, checkout report writes disabled, and an additional 8,192-byte reserve. The initial default snapshot exceeded the limit, so the two documentation screenshots `artifacts/terminal-{desktop,mobile}.jpg` were recompressed as progressive JPEGs at their original 1440×900 / 390×844 dimensions; all content is retained, and the final images were inspected. They are documentation images, not runtime assets. No source, dependency or required deliverable was dropped. The retained static export remains exactly the production build, including all runtime assets. Final `git diff --check`, protected-path, no-submodule and no-generated-dependency/cache checks passed; no ignore file changed.

---

# Prior revision validation · 2026-10-19

Worker-recorded results for the bounded revision. All four findings reproduced against the accepted source/export and were fixed. `.imd-responses.json` contains one response per finding. Existing contracts, economics, wallet transaction flows, build configuration, dependencies and hosting identity are unchanged. Only the static export is delivered for publication; no external service, persistent bot, paid job or chain transaction was run.

## Current results

| Check | Actual result |
| --- | --- |
| Baseline reproduction | Owner A denied with owner B available, then incorrectly authorized on timeout. Late token discovery first scanned block 289 but claimed global 100–310 and supported realized 4. Six-decimal transfer displayed -0.000000000001. Chromium at 390×844 rendered no chart after panning then selecting five daily candles |
| Typecheck / production | `npm run typecheck` and `npm run build` passed using unchanged manifests in a disposable `/tmp` build copy; Vite 7.1.7, 523 modules. Complete output copied to `dist/` and byte-compared |
| Frontend tests | `npm test`: 60/60 passed |
| Backend tests | 52/52 passed across `tests.mjs`, `data.test.mjs`, `upgrade.test.mjs` and the 14 new `revision.test.mjs` cases |
| Chromium | 14 interaction/reflow groups passed at 320/390/768/1440; four axe scans had zero violations; no uncaught script errors or failed local static resources |
| Chart regressions | Three Earlier actions on 120 hourly candles, then five daily candles: five remain visible and Reset enabled. Shorter quote series clears the crosshair and remains visible. Empty history disables Reset and a subsequent valid series recovers |
| Radar regression | Two SAME-symbol flows render separately as -1 and -2, with distinct token-address links, at 390 and 1440 |
| P&L regressions | New token backfill begins at evidenced deployment 120. Complete four-trade history returns realized 14 / unrealized 12. Bounded incomplete history returns partial with null totals, resumes after SQLite restart, and never inherits global coverage. Decode/event/timestamp/storage/retention omissions withhold certification |
| Owner regressions | Timeouts, reverts, undecodable/empty owner results and renunciation grant no rights. Current/former owner checks and profile submission/moderation/quote/pre-payment outage checks pass |
| taste@1 | 13/16 passed: render, layout, targets, contrast, tracking, sizes, glyphs, slogans, repetition, copy budget, surfaces, motion and metadata. Preserved brand capitals/monospace and functional nav/status labels explain the same three advisory flags as the accepted version |
| First screen / assets | Inspected actual 390px screenshot: product, Refresh checks and search visible. No page overflow. Title, description, favicon, og:title, og:image and relative assets remain present |
| Scope / packaging | No protected manifest/lockfile, contract, dependency, environment, Git/GitHub or ignore changes; no submodule or added dependency/cache/archive. The complete export remains about 1.61 MB; complete current source/export gzip tree measured below 8,388,608 bytes (about 8.30 MB), with over 80 KB remaining |

Commands run after installing tools outside the repository:

```sh
npm run typecheck --prefix /tmp/unlock-revision-web
npm test --prefix /tmp/unlock-revision-web
npm run build --prefix /tmp/unlock-revision-web
LABS_TEST_ACCOUNTS_MODULE=/tmp/unlock-revision-web/node_modules/viem/_esm/accounts/index.js \
  node --test services/labs/tests.mjs services/labs/data.test.mjs services/labs/upgrade.test.mjs services/labs/revision.test.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-revision-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-revision-browser/node_modules/playwright/index.mjs \
  IMD_AXE=/tmp/unlock-revision-browser/node_modules/@axe-core/playwright/dist/index.mjs \
  node web/scripts/check-upgrade.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-revision-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-revision-browser/node_modules/playwright/index.mjs \
  node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
git diff --check
```

The initial five targeted backend tests failed against the original implementation; the original export also failed the new daily-chart browser assertion. An isolated copy of unchanged `HEAD` backend modules reproduced the exact incorrect supported P&L (4 instead of 14). These are artificial fixture accounts/logs, never claimed live identities or site data. All temporary tooling, baseline copies and logs are outside the repository or in disposable `test/scratch/`.

## Review of the affected interface

Applied the pinned Better Interface workflow and all six core domains while retaining the accepted compact dark/emerald monospace system. No visual redesign was justified.

| Domain | Checked | Not verified / limits |
| --- | --- | --- |
| Accessibility | Native chart buttons/select labels; pointer and keyboard chart controls, disabled and empty states; wallet dialog Escape/focus return; four axe scans, target probe | Screen reader, physical device, forced colors |
| Layout | 320/390/768/1440 route reflow, first-screen product/action, five-candle chart and distinct flow rows, no page overflow; mobile/desktop screenshots inspected | Browser-native 200% zoom, RTL, exhaustive content lengths |
| Writing | Owner failure includes retry guidance and denies requester fallback; actual token range/partial P&L notes; flow labels remain transfer movements; existing snapshot and sponsored disclosures retained | Operator content and wallet-provider copy |
| Typography | Existing local JetBrains Mono 400/600, six-size scale, loaded fonts, chart dates/values and flow links wrapping; size probe passed | Native text zoom and physical print |
| Colors | Existing tokens retained; rendered contrast probe and four axe states passed; no new color encoding | Every possible expanded/third-party-image state |
| UI | Reset remains usable for shorter series, pan/crosshair reset, empty-to-valid recovery, distinct asset links; existing flat surfaces and reduced-motion behavior checked | Real wallet payment success, Safari rendering, motion-panel slow replay (no new animation) |

| Finding / source | Cause, correction and recheck |
| --- | --- |
| High · `services/labs/identities.mjs:31` | Catch-all requester fallback replaced by required live owner evidence. Outage/decoder failures now return unavailable. Production caller regressions pass |
| High · `services/labs/indexer.mjs:57`, `token-data.mjs:32`, `markets.mjs:160` | Added asset-specific contiguous coverage/backfill and omission persistence; pool-initialization settings no longer replace token inception. Legacy/global-only ranges cannot certify P&L. Backfill, omissions and restart regressions pass |
| Medium · `services/labs/indexer.mjs:170`, `web/src/labs/Radar.tsx:64` | Symbol aggregation/default decimals replaced by chain/address and exact decimals/raw amounts; frontend adds distinct token links. API and rendered regressions pass |
| Medium · `web/src/labs/Candles.tsx:11` | Old offset/crosshair reset on series/currency replacement; immediate visible offset clamped and Reset keyed to underlying candles. Shorter-series and recovery browser checks pass |

Current scratch evidence: `test/scratch/upgrade-browser/{results.json,static-390.png,timeframe-regression-390.png,radar-flows-390.png,radar-flows-1440.png}` and `test/scratch/taste/`. These are intentionally removed before submission. Existing delivered mobile/desktop screenshots were regenerated by the bounded browser script; fixture screenshots remain scratch only. `DESIGN.md` records the final chart and asset-link behavior.

## Limitations and completion

WebKit was installed outside the repository but could not launch because required GTK/GStreamer and related system libraries are absent. Safari behavior is unperformed, not passed. Physical wallets, real payments/audits, screen readers, external hosting, Docker operation and production backend connection were not exercised in this revision. No live market eligibility or wallet attribution is asserted.

The static API URL remains empty and backend-dependent features remain disabled until the operator supplies and operates the documented service. Non-Ownable tokens, including UNLK, cannot edit profiles until a reviewed source/runtime-bound authority policy is added; current requester evidence alone is deliberately insufficient. Per-asset omissions remain fail closed across restarts; the seven-day retained history cannot certify lifetime P&L once earlier events have been removed. These limitations are disclosed in `docs/backend.md` and `docs/labs-data.md`.

**Complete for this revision's static frontend and separately operated service-source scope.** All four finding responses are fixed; no publishing or onchain operation is claimed.

---

# Accepted upgrade validation (retained prior-run evidence)

Worker-recorded checks; these are not independent network certification. Scope: static `dist/`, retained trade/claims/treasury/whitepaper, upgraded Markets/Radar/Audit/Profiles, and separately deployable API/migrations/indexer source. No contract/economic change, service deployment, private key, paid test audit or mainnet broadcast occurred.

## Results

| Check | Actual result |
| --- | --- |
| TypeScript | `tsc --noEmit` passed against the final application source |
| Production build | Vite 7.1.7 passed; complete export copied to `dist/` and compared byte-for-byte with build output |
| Frontend regression tests | 60/60 passed, including mainnet math/guards, quotes, quota/claim proofs, treasury authority, NFT safety and whitepaper |
| Backend/data/security tests | 38/38 passed: accepted audit/security suite + market/indexer suite + 17 upgrade tests |
| Chromium production validation | 12 interaction/reflow groups passed, four axe scans had zero violations, no uncaught script errors or failed local resources |
| Rendered widths | 320, 390, 768 and 1440px, actual export served at `/preview/` |
| First screen at 390 | Product, Refresh checks and market search visible; actual screenshot inspected with page scrolled to top |
| Metadata/assets | Title, description, favicon, og:title, og:image present; CSS fonts resolve as `../fonts/...`; local assets complete |
| taste@1 | 13/16 checks passed. Three flags adjudicated below; no layout/contrast/target/render failure |
| Node service smoke | Health 200, chain 1/schema 2; empty tariff settings 200/configured false; warming Markets 200/zero rows; unauthenticated profile quote 401 |
| Live read-only Ethereum | Chain/head/price reads succeeded. UNLK position-log request returned HTTP 403; representative router sell reverted. No eligibility or successful sale established |
| Protected paths | No changed build manifests/lockfiles, contracts, lib, .github, .gitmodules, environment-secret files or tracked node_modules; no submodule |
| Packaging | Complete source/export retained. Duplicate font copies removed; canonical fonts/license kept. Radar snapshot explicitly bounded to 60 actual rows. Final byte count is recorded in `https-results.json` |

Build tools were installed outside the repository in a disposable `/tmp` build directory using the **unchanged** frontend manifest/lockfile. Source/public/tests/evidence were copied there; the output was copied back. No install/cache directory is delivered. Required native proofs, ABI files, whitepaper, wallet images, fonts and licenses remain complete.

Commands actually run (from the appropriate frontend build copy or repository root):

```sh
tsc --noEmit
tsx --test tests/*.test.ts
vite build
LABS_TEST_ACCOUNTS_MODULE=/tmp/unlock-labs-build/node_modules/viem/_esm/accounts/index.js \
  node --test services/labs/tests.mjs services/labs/data.test.mjs services/labs/upgrade.test.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-browser/node_modules/playwright/index.mjs \
  IMD_AXE=/tmp/unlock-browser/node_modules/@axe-core/playwright/dist/index.mjs \
  node web/scripts/check-upgrade.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/unlock-browsers \
  IMD_PLAYWRIGHT=/tmp/unlock-browser/node_modules/playwright/index.mjs \
  node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
git diff --check
```

The pinned probe is an input removed by the submission process; its measured results are retained here/JSON. The reusable interaction script is delivered in `web/scripts/check-upgrade.mjs` and closes its own preview/browser. Tests never submit paid requests or send transactions.

## Meaningful interaction/security coverage

The production browser exercised keyboard skip-to-content without changing tools, search/filter/ranking tabs, excluded-token deep links, local profile preview with rights/submission disabled, GitHub commit/file-tree selection, scope validation with payment unavailable, all three Radar groups, event/window filters and a device watchlist. It opened/closed the retained wallet sheet and navigated Trade, Treasury and the standalone whitepaper.

An isolated **TEST FIXTURE** API exercised cap sorting with unknown last, stale-row exclusion despite a large fake gain, local market watchlists, OHLCV/volume, quote unit/timeframe, pointer/keyboard chart controls, zoom/pan, holder/trader views and unavailable cost basis. Generated fixture candles are validation data only; none ships in the export. PNG screenshots of this explicitly labeled fixture remain in scratch, not public runtime assets.

Backend tests cover fail-closed/stale/low-liquidity checks; exact active-liquidity reconciliation and duplicate-position logs; full-router sell calls without overrides; missing USD candles and no-trade gaps; unavailable opening cost basis and transfer treatment; identity mismatches, unrelated wallets and unauthorized moderation/configuration; immutable quotes; altered/reused transactions; concurrent fulfillment; real SQLite restart/migration replay; and runtime-pinned NFT-sale evidence. The retained audit suite tests nonce replay/domain/expiry/logout, ownership, exact signed payment bytes, lost responses, retry/restart recovery, failed/expired orders, accepted judge reports and matching PDF content/attachment.

## Better Interface review

Applied the pinned Better Interface workflow and all six core domains during implementation, retaining its license/attribution. The brief's dark/emerald monospace terminal direction and accepted trade controls remain authoritative.

| Domain | Coverage and evidence | Remaining limitation |
| --- | --- | --- |
| Accessibility | Checked native links/buttons/checkboxes, labels, heading hierarchy, skip link, status/error text, disabled reasons, keyboard chart controls, native dialog Escape/focus behavior. Four rendered axe states returned zero violations; target probe passed | No screen-reader session, physical wallet/device, forced-colors session or full WCAG certification |
| Layout | Inspected production 320/390/768/1440 screenshots, local scrolling table/tabs, responsive profile/audit/detail grids, first-screen search and wrapped identifiers. Page overflow checks passed all tested routes | Native browser 200% zoom, RTL mirror and every possible content length unperformed |
| Writing | Checked action labels, current vs snapshot wording, exclusion reasons, partial P&L, editorial/sponsored separation, cost/disclosure/recovery messages | Operator-supplied moderated text and third-party wallet copy not reviewed |
| Typography | Checked implemented six-size scale, 400/600 local WOFF2, tabular digits, mobile input sizing, full addresses and responsive chart axes. Probe found one family/two weights | Physical print/native text zoom unperformed; requested monospace prose is retained |
| Colors | Checked source token roles, signed/text status cues and rendered probe/axe contrast on scanned states | No claim about untested third-party images, wallet UI or every expanded state |
| UI | Checked loading/empty/disconnected/failed states, selected/sort/watch states, modal dismissal, disabled checkout, chart interactions and flat surfaces. Reduced-motion probe found no continuing motion | Real paid/signing/success flows validated through isolated backend/crypto tests, not mainnet spending |

### Findings fixed

| Severity · source | Evidence and correction | Recheck |
| --- | --- | --- |
| High · `web/src/labs/domain.mjs:6`, `Markets.tsx:28` | Accepted Markets could render rows without a current sell proof. Central policy now filters every listing/badge/placement and provides direct-URL reasons | Stale/unknown/failed mutations excluded in unit/browser checks; live failures left UNLK withheld |
| High · `services/labs/markets.mjs`, `web/src/labs/TokenDetails.tsx` | A failed refresh could retain an earlier fresh proof, and a null detail response could fall back to prior metadata. Failed/unknown refreshes now withhold all rows immediately; detail failures/null exclusions override cached display data and offer retry | Regression test and connected-browser exclusion transition passed |
| Medium · `services/labs/server.mjs` | The token route did not attach moderated profile metadata, so a detail load could remove paid content. Market and detail routes now share a content-only decorator that cannot overwrite rank, badge or eligibility fields | Dedicated regression test passed; image payloads stay in the raster cache |
| Medium · `web/src/labs/terminal.css:6`, `Markets.tsx:40` | Initial mobile layout spent excess height on repeated copy, ticker wrapping and multirow view buttons. Shortened copy, kept the action beside its heading and used a local horizontal view rail | Final 390 screenshot and first-screen search assertion passed |
| Medium · `web/src/labs/Candles.tsx:12` | Source review found a fixed 1000-unit chart viewBox that would shrink mobile axis text. Width now follows ResizeObserver, with mobile-height/date formatting and a value table; time coordinates preserve actual gaps | Inspected the final 390/1440 fixture chart screenshots; controls/reflow passed |
| Medium · `web/src/labs/TokenDetails.tsx`, `Radar.tsx:196` | Browser exact-label selection exposed select names that included option text. Added explicit accessible names for pool/timeframe/unit/window controls | All named selectors now operate; scanned axe states have no label violation |
| High · `web/src/labs/domain.mjs:33` | Truncated opening inventory could make an observed-lot calculation look like supported FIFO profit. Numerical P&L now needs complete opening inventory; quote/token receipt reconciliation gates cost basis | Missing-history/transfer/unmatched-balance tests return partial/unavailable values |
| High · `web/src/App.tsx:8` | Hash-based skip-to-main could switch Labs to Trade. The skip hash now focuses main while preserving the tool | Keyboard Tab/Enter retained the Markets heading |
| Low · `web/src/styles.css:1` | Duplicate imported/public/built font binaries consumed submission budget. Public WOFF2 is now the single canonical source; Vite emits relative URLs | Production asset check, loaded-font/browser checks and byte comparison passed |

### Probe adjudication

The final probe passed render, layout, targets, contrast, tracking, size count, glyphs, slogans, repetition, copy budget, chrome, motion and share metadata. It reported three remaining flags:

- **Casing:** the preserved `UNLOCK LABS` product name. The requested brand/accepted design takes precedence; this is not a new decorative kicker.
- **Type faces:** monospace prose. The brief explicitly requires preserving the monospace design; one local family and two real weights remain.
- **Eyebrows:** header/tool navigation (`Treasury`, `Labs`, `Markets`) and the service-status line near headings. Rendered inspection confirms these are working navigation/status, not decorative pre-heading labels. Removing them would remove required controls/context. No new kicker component was added.

The probe reports 21 controls below its comfortable 44px size, but all meet its 24px/spacing check. Dense mobile navigation uses the established 32px rows; primary controls remain 44px.

## Evidence and limits

Current delivered viewport screenshots: `artifacts/terminal-mobile.jpg` (390) and `terminal-desktop.jpg` (1440). Additional mobile route/chart screenshots and machine-readable results were produced in `test/scratch/upgrade-browser/` and `test/scratch/taste/`; scratch is intentionally not submitted. The older `terminal-mobile-ladder.jpg` and `web/evidence/` files are retained historical artifacts, not claimed as fresh observations.

The MCP browser answered that Chrome was absent at `/opt/google/chrome/chrome`; a separate permitted foreground Playwright preview supplied actual Chromium evidence. WebKit installation completed but launch failed for missing GTK/GStreamer-related system libraries. WebKit behavior is **unperformed**, not passed. Docker is not installed, so container build/HTTPS operation is unperformed; the Node process and HTTP routes were checked directly. Physical-device/wallet signing, native zoom, screen readers, real payment settlement/admission, public API hosting, DNS and persistent-disk disaster recovery remain unperformed.

Operator API/storage/providers/backfill, real sell-plan accounts/sizes, missing editorial identities, public personal-wallet attribution, verified NFT venues and owner tariff/refund settings remain intentionally unconfigured. No guessed identity, tariff or successful liquidity/sell status fills these gaps. Source limitations and setup are explicit in `docs/backend.md` and `docs/labs-data.md`.

**Complete for the assigned static frontend and separately operated service-source scope.** Live backend features remain disabled until the operator connects and configures the service. No external deployment or mainnet change is claimed.
