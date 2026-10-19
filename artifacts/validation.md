# UNLOCK Labs upgrade validation · 2026-10-19

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
