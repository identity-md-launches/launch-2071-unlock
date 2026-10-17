# UNLOCK terminal redesign validation

Date: 2026-10-14. Accepted website base: `b01b41bfdf20a20519c5902eda3d0677b7f2b6df`. Deployed contract source pin: `ea89426f3fe9df79096a5e02345fc8821bd1c783`. This is a frontend continuation, not protocol activation. No contract, dependency manifest, lockfile, existing build configuration, ignore file or Git metadata was changed. No public transaction, deployment, mainnet operation or signing key was used.

## Delivered interface

The old cream/serif hero and oversized diamond are replaced by a compact black terminal. The entry view contains four status metrics, an original seven-checkpoint categorical Unlock ladder beside Buy/Sell, then a wallet ledger, real trade/holder preview and expandable operational detail. Local JetBrains Mono, original share art, small emblem, accessible focus and relative static assets are bundled. The existing Coinbase SDK is dynamically loaded; no new dependency was added.

Desktop/mobile screenshots of https://sat0.org/ and the old accepted UNLK export were rendered and inspected before implementation. Final screenshots were compared with them: Sato's compact panel/grid character informed density, but UNLK uses its own milestone staircase, allowance semantics, branding and text. No Sato price/supply curve, asset or copy was reused. The final 1440×900 form ends at y=834.2; the 390×844 Connect to trade action ends at y=840.6. The mobile ladder is 240px high; desktop is 280px. A 320px viewport reflows without horizontal overflow, though the trading action requires scrolling at that narrower width.

Screenshot artifacts: `screenshots/sato-1440.png`, `sato-390.png`, `old-unlk-1440.png`, `old-unlk-390.png`, `unlk-1440.png`, `unlk-390.png`, `unlk-mobile-selection.png`, `unlk-market-history.png`, `unlk-offline.png`, `unlk-webkit-1440.png`, `unlk-webkit-390.png`. Screenshot paths are relative to the contributor's `artifacts/` bundle, not runtime dependencies.

## Production and interaction results

| Check | Actual result | Evidence |
| --- | --- | --- |
| Existing production build | PASS; TypeScript then Vite, relative asset export | `build.txt` |
| Standalone TypeScript | PASS | `typecheck.txt` |
| Frontend unit tests | 10 PASS: allowance, rounding, full bypass, swap math, parsing, confirmation/reset and shortcut gas reserve | `frontend-tests.txt` |
| Existing contract regressions | 64 PASS in 9 suites | `test-results.txt` |
| Cross-language math | 2 PASS: 14 v4 swap vectors and 43 quota vectors checked in Solidity | `cross-language-tests.txt`, `swap-math-vectors.json`, `allowance-vectors.json` |
| Deployed bindings/ABI/runtime | 35 PASS at Sepolia block 11913027; five companion/token/hook runtime matches and pinned ABI consistency | `chain-verification.json` |
| Live data/simulation | 3 exact buy simulations; all 459 authentic round-0 proofs; 3 holder ledgers agree with contract quota | `live-interactions.json` |
| Chromium production UI | 24 views: six routes × 320/390/768/1440. No overflow, script errors or missing local resources. Axe at 390 on all six routes: zero violations | `browser-validation.json` |
| Wallet state/provider fixtures | 8 checks PASS: connection has no signing, chain switch, simulation, quote expiry, rejected send, sell route, account changes and reward network guard | `wallet-validation.json` |
| Recovery/outage fixtures | 5 checks PASS: real RPC fallback, authentic proof fallback, pending reload, existing confirmed receipt and explicitly injected revert | `recovery-validation.json` |
| Disposable local fork UI | 8 checks PASS, 7 UI-confirmed local transactions: Buy, exact approval, Sell, withdrawal, native claim, evidence attestation, hook sync | `fork-validation.json` |
| WebKit | 320/390/1440 reflow and font checks; chart, wallet dialog/Escape and Sell input/slippage passed | `webkit-validation.json` |
| Contrast | 24 token/surface pairs meet relevant text/control thresholds | `contrast.json` |
| Pinned design probe | 14/16 raw PASS, two reviewed exceptions below | `design-probe.json` |
| Submission/static export | Path, size, relative URL, public-asset completeness and metadata audit | `submission-check.json` |

Chromium interactions include touch milestone selection, Arrow/Home/End navigation, full-bypass explanation, history ranges/crosshair/event slider, manual amount and slippage changes, mobile wallet-browser links, Coinbase option, modal focus restoration, hypothetical wallet calculations, transfer-only/full-bypass examples, invalid input, FAQ keyboard operation, activity filtering and skip-link behavior. The offline fixture retains usable public rules and wallet discovery with no invented series, balances, confirmed tier or FDV.

The live read at block 11912977 covered blocks 11906181–11912975: 27 real events including four Swaps, four router Executed events, one Sale and one native claim. The UI indexes the actual official PoolId and exposes covered interval, two-block delay and read time. History remains sparse, with per-event price/ETH volume and no fabricated OHLC candles. Price display is indicative; verified milestone FDV remained unavailable at the recorded latest verification and is shown as unavailable.

The fork starts from block 11913004 and forwards browser reads to localhost. It impersonates existing public accounts only in disposable Anvil state; local gas funding and approval reset are explicit test setup. All four Buy percentages estimated actual fork gas, reserved a 20% buffer and filled without signing. Sell percentages used executable quota/balance and seed capacity. The UI then confirmed a buy, a bounded exact 1 UNLK approval to the existing router, a sale settling to nativeCredit, full withdrawal, and an authentic unclaimed round-0 beneficiary's claim/attest/sync. The hashes in fork evidence are local-only, never Sepolia receipts. The live rejecting-provider harness uses public account addresses, rejects every send request and never broadcasts. Recovery tests label injected pending/reverted responses separately from the existing real receipt.

## Better Interface review

Applied the supplied pinned Better Interface workflow while building, then reviewed all six domains against final source and rendered output. The guide, reference, design-critic thresholds, wallet-connector guidance and license were read. `DESIGN.md` records the final implementation using the guide's document-web-design structure. This review is worker evidence, not independent certification.

| Domain | Coverage | Findings and fixes in final source | Remaining limitations |
| --- | --- | --- | --- |
| Accessibility | Semantics, visible labels, keyboard, touch, focus, status announcements, reduced motion, contrast, offline states; axe on all six views at 390 | `web/src/charts.tsx:163`: milestone hit regions bounded to prevent overlap, keyboard arrows/Home/End and persistent live readout. `web/src/styles.css:87`: 2px focus outline. `web/src/App.tsx`: route focus and skip link preserved. Primary body trade/wallet actions are 44px | No screen-reader or physical assistive-device test. Dense chart/nav controls meet 24px or spacing baseline; 26 probe targets are below its optional 44px comfort recommendation. Mobile header wallet is 40px |
| Layout | Desktop/mobile reference comparison; six views at four Chromium widths, three WebKit widths; loading, offline and connected fixtures | `web/src/styles.css:434`: 1280px workspace and 360px form. Mobile overrides around `styles.css:2190` keep the 240px chart and connection action in the first 390px screen. Removed the previous hero and decorative whitespace. `charts.tsx:157`: stagger very narrow category ticks | Native browser 200% zoom and physical device safe-area/browser chrome not tested. At 320px the main form action is below the first screen |
| Writing | Labels, units, risks, action outcomes, unknown states, technical detail disclosure | `web/src/Terminal.tsx:27`: distinct indicative FDV, confirmed tier and oracle status. `charts.tsx:217`: hypothetical label and threshold warning. `web/src/Unlock.tsx:110`: outside allowance stays in wallet, no escrow. `web/src/Trade.tsx`: router-credit settlement and costs beside actions | English only, as requested. Contract terms and exact addresses remain in expandable diagnostics |
| Typography | Local font loading, six-size scale, tabular numbers, responsive graph labels, real sparse history axes | `web/src/styles.css:1`: two licensed JetBrains Mono weights. `charts.tsx:15`: actual rendered SVG width avoids scaling 12px labels below readable size. Sparse price labels use enough significant digits to remain distinct | Monospace prose intentionally follows the task; this conflicts with the generic taste heuristic |
| Colors | Exact requested semantic palette; rendered opaque surfaces plus calculated WCAG luminance pairs; non-color cues | `web/src/styles.css:22`: active input borders strengthened from #52525B (2.438:1 on panel) to #71717A (3.900:1). Text is #F4F4F5/#A1A1AA; green/amber/cyan/pink/red pair with labels, line styles and status text | Automated taste omits SVG text, so explicit token calculations supplement it. Supplemental grid/separators are intentionally low contrast; disabled controls are exempt |
| UI | Chart/form hierarchy, filters, disclosures, wallet flows, transaction states, gas/percentage behavior, account races and oracle truthfulness | `web/src/Trade.tsx:85`: same-account/same-block readiness and stale/error guards. `Trade.tsx:103`: integer percentage fills and actual gas reserve without signatures. `web/src/data.tsx:129` and `Unlock.tsx:13`: synchronously exclude prior account data. `web/src/math.ts:154`: confirmation progress derives from recorded on-chain observations, not wall-clock prediction | Real extension/passkey signing and phone handoff were not performed. Public oracle advancement depends on valid data and permissionless transactions, not a timer in this site |

No observed high/medium interface defect remains unresolved within this review's coverage. The remaining limitations above are not represented as successful tests.

### Design probe exceptions

Ran the pinned probe against `dist/` from the repository root. PASS: render, layout, targets, contrast, casing, tracking, type-sizes, glyphs, slogans, repetition, copy-budget, chrome, motion, share. Raw failures retained:

1. **type-faces:** reports monospace prose. JetBrains Mono throughout is an explicit requirement, so this is an intentional exception, not changed to satisfy a generic heuristic.
2. **eyebrows:** misclassifies the required test-asset disclosure above the pair heading, “You receive” above its output value and “Unlock ladder” chart tab above the chart heading. These are a network disclosure, form label and navigation control. None is a decorative tracked-capitals kicker. Retained for clarity and required disclosure.

The raw report is retained as `artifacts/design-probe-raw.json`; bundled `design-probe.json` preserves every check result/output, thresholds, viewport summaries and errors while omitting the large per-node measurements. First-screen prose measured 21 words mobile/28 desktop. The probe found no overflow at 320/390/1440, no overlaps, no missing files, no perpetual motion and no cards inside cards.

## Commands and runtime

Node 22.22.2; existing dependency lockfile installed outside the repository. All source changes were synchronized before the final build. Build/check commands:

```sh
rsync -a --delete --exclude=node_modules web/ /tmp/unlk-redesign/web/
npm --prefix /tmp/unlk-redesign/web run typecheck
npm --prefix /tmp/unlk-redesign/web test
npm --prefix /tmp/unlk-redesign/web run build
rsync -a --delete /tmp/unlk-redesign/dist/ dist/
```

Chromium browser module `/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs`, browsers `/opt/imd-tools/ms-playwright`; axe `/tmp/unlk-checks/node_modules/@axe-core/playwright/dist/index.mjs`. These external tools are not submission assets.

```sh
IMD_PLAYWRIGHT=/opt/imd-tools/playwright-mcp/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/opt/imd-tools/ms-playwright \
UNLK_AXE_MODULE=/tmp/unlk-checks/node_modules/@axe-core/playwright/dist/index.mjs \
  node web/scripts/check-browser.mjs
# Same IMD_PLAYWRIGHT/BROWSERS settings:
node web/scripts/check-wallet.mjs
node web/scripts/check-recovery.mjs
node /tmp/unlk-redesign/web/scripts/check-fork.mjs
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
npm --prefix /tmp/unlk-redesign/web run verify:live
npm --prefix /tmp/unlk-redesign/web run verify:chain
forge test --match-contract 'TradingTest|SeedBoundaryTest|NativeLaunchTest|ClaimLifecycleInvariants|OracleTest|CreditsAndFeesTest|NativeWithdrawalTest|NativeCustodyInvariantsTest|QuotaInvariantTest' -vv
forge test --match-contract 'FrontendSwapMathTest|FrontendAllowanceTest' -vv
```

The cross-language test sources are generated into disposable `test/scratch/` by the delivered `web/scripts/check-swap-math.ts` and `check-allowance-math.ts`; generation requires installed frontend dependencies. Existing compilation output was copied to the isolated parent for `verify:chain` so it could compare the unchanged Foundry ABI/runtime artifacts.

The browser connector could not launch because its managed cache was read-only (EROFS); direct Playwright successfully rendered the export instead. WebKit used the available 1.56.1 runner/browser and temporary system-library extraction outside the repository. Direct WebKit HTTPS requests failed in this runtime, so `check-webkit.mjs` forwards them through Node to the real public read endpoints. No response values are fabricated. This verifies WebKit rendering/interaction, not native Safari's external-network behavior. Public RPC/proof-service availability remains external.

## Publication and scope

The static export and source are prepared for the contributor network to publish under the existing `unlk.site.identitymd.eth` name at https://unlk.sites.imd.fun/. The task prohibits writing `.git/`; no new commit or IPFS CID is claimed from this worker. `artifacts/publication.json` records the accepted base and pending publisher-assigned values. The previous CID is not reused as a redesign result.

The frontend does not complete or change protocol activation, oracle economics or any outstanding public transaction tests. Earlier contract documentation is retained separately in README for provenance. Current live bindings are active, but valid milestone FDV remains unavailable; the redesign does not make an economic or milestone promise.
