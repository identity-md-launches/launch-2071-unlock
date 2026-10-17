# Revision validation · launch 2071 website

Complete for the two reported repository defects. Production source, static export, tests and evidence are included. Publication and Explorer metadata remain an IMD delivery-service step; this report is worker evidence, not independent certification. No public transaction, activation, redeployment or balance migration was performed.

## Scope and provenance

The accepted website was preserved. Runtime changes are limited to the final signing guard in `web/src/wallet.tsx:513` and quote validation in `web/src/trading.ts:182`. The missing evidence is regenerated under `web/evidence/`, which is included in the source submission. The scripts do not rely on removed `.imd` inputs, an excluded `artifacts/` folder, or a shipped Foundry/npm cache. Dependencies, lockfiles, Solidity contracts, build settings and ignore files were not changed. The website fork test now permits a public RPC override and defaults to dRPC because PublicNode rejected the historical state.

Contract source commit: `40d70b7bd0853aedf84eac839a40a5f12e6ac341`. Accepted website baseline: `71376a1` (full hash in `publication-status.json`). The final submission commit is assigned by delivery, not invented here.

Recorded Ethereum mainnet block: **26212727**, hash **`0xc9b35b7491a98046f97b3704cce6845afab12b04e79501591acd5052a2865405`**. `fork-config.json` and `fork-block.json` include the timestamp and RPC. `live-preparation.json` records the actual inactive hook, deployed companions, certified native round 0, PoolKey and bindings. `mainnet-code.json` contains the RPC runtime bytes for 13 roles. `compiled/` retains only the compiler output needed for comparison, compiler/settings, source hashes and ABI hashes. Both token/hook ABI attestations match; the factory-native distributor matches the factory's embedded initcode/template with immutable slots excluded. Source-file hashes are checked against the delivered repository.

A separate fresh mainnet read at block **26212969**, hash **`0x647c66a36701f9e98b75963c99ac38e4503b8c8b3c4abe06859a6a0382cd0a72`**, also found `activated=false`, tier 0, round 0 certified. See `live-verification.json`. This is a time-stamped observation, not a promise that the owner will leave activation false.

## Reproductions and fixes

| Finding | Reproduction | Correction and recheck |
| --- | --- | --- |
| `ddf151f…` · high | Both documented verifiers exited 1 before verification, with ENOENT for the missing preparation/fork records. See `missing-evidence-reproduction.json` and the two `*-before.txt` logs. | Included configuration, recorded chain data, compiler comparison inputs and results. Updated all current README/design references. The two commands pass offline with `fetch` disabled and with `--live`. Verification no longer rewrites ABIs. `check-export.mjs` now rejects missing or excluded evidence. |
| `db199e9…` · high | At 390×844, a real-contract local fork buy quote became 31 seconds older during the final gas estimate. The old export showed “Quote expired” but sent one request to the reject-only wallet. See `quote-expiry-before.json`. No transaction was broadcast. | Revalidate after gas estimation and wallet reads, then check the connection synchronously before `writeContract`. Recheck age after the awaited state read, along with activation, snapshot age, block bounds and deadline. `quote-expiry-after.json` records zero sends for slow gas, slow final read, four-block drift and deadline expiry; a fresh quote reaches the rejecting wallet once. Each failed review closes. |

The regression's deadline fixture advances from the actual current fork head by 301 seconds; it does not assume the activation fixture mined at an exact timestamp. The final results refer to the rebuilt export. The earlier accepted export was used only to reproduce the defect.

## Commands and actual results

Run from the repository root unless noted. Dependency installation used the unchanged `web/package-lock.json` via `npm ci --prefix web`. Node 24 and the repository's Solidity 0.8.26 settings were used.

| Command | Result | Record |
| --- | --- | --- |
| `npm --prefix web run typecheck` | Exit 0 | `typecheck.txt` |
| `npm --prefix web test` | Exit 0; 35 passed, 0 failed | `unit-tests.txt` |
| `npm --prefix web run build` | Exit 0; TypeScript check and production Vite export | `build.txt` |
| `forge build` | Exit 0; initial compilation succeeded, final cached confirmation retained | `forge-build.txt` |
| `node web/scripts/record-compiled.mjs` | Five compiler records exported | `record-compiled.txt`, `compiled-provenance.json` |
| `web/node_modules/.bin/tsx web/scripts/record-mainnet-evidence.ts` | Read-only pinned-block capture; all runtime pins and factory/PoolKey bindings matched | `record-mainnet-evidence.txt`, `live-preparation.json` |
| `node web/scripts/verify-mainnet-source.mjs` | Exit 0; five runtimes, source hashes and ABIs matched | `source-verification.json`, `.txt` |
| `node web/scripts/verify-native-distributor.mjs` | Exit 0; factory, initcode, runtime template and deployed runtime matched | `native-distributor-verification.json`, `.txt` |
| Both verifiers with `--live` | Exit 0; fresh RPC reads at the pinned historical block | `source-verification-live.*`, `native-distributor-verification-live.*` |
| Both verifiers imported with `globalThis.fetch` set to throw | Exit 0; no network or omitted build-cache dependency | `offline-verification.txt` |
| `web/node_modules/.bin/tsx web/scripts/verify-mainnet.ts` | Exit 0; fresh mainnet read, no writes | `live-verification.json`, `.txt` |
| `forge test --match-path test/website/MainnetWebsiteFork.t.sol -vv` | Exit 0; 3 passed | `fork-tests.txt` |
| `forge test --match-contract '^(ImdFeeMathTest\|OneWayGatesTest\|QuotaMitigationTest\|ImdPermitAndBatchTest)$' -vv` | Exit 0; 33 passed | `contract-unit-tests.txt` |
| `forge test --match-contract '^ImdProtocolFeesTest$' -vv` | Exit 0; 10 passed | `protocol-fees-tests.txt` |
| `node web/scripts/run-fork-browser.mjs quote` | Exit 0; all five regression scenarios passed | `quote-expiry-after.json`, `.txt`, `quote-slow-gas.jpg` |
| `node web/scripts/run-fork-browser.mjs full --chromium-only` | Exit 0; 18 checks passed; no page errors | `browser-interactions.json`, `.txt` |
| `node web/scripts/check-site.mjs http://127.0.0.1:4173 --chromium-only` | Exit 0; 10 checks, axe 0 violations/50 passes; no page errors or local resource failures | `site-review.json`, `.txt` |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Exit 0; 16/16 checks passed | `design-probe.json`, `.txt`; representative live screenshots below |
| `node web/scripts/check-export.mjs` and `python3 web/scripts/check-bundle.py` | Export, evidence inclusion, protected paths and 8 MiB budget checks | `export-check.txt`, `bundle-check.txt`, `submission-check.json`, `export-manifest.json` |

Browser commands used an external Playwright install through `IMD_PLAYWRIGHT`, external runtime storage through `PLAYWRIGHT_BROWSERS_PATH`, and external axe through `IMD_AXE_MODULE`. No browser binaries, npm caches or dependency archives are submitted. README gives the runnable commands; the runner owns and closes its loopback services. The pinned taste script is an input removed by the platform; its measured output is retained here.

## What the evidence establishes

**Real-contract local fork:** the three Solidity fork tests use deployed contracts at the recorded block. They locally activate as the actual owner; execute Universal Router buys/sells through Permit2; reject inactive trades, immature and excess-quota sales; check exact buy treasury rounding and treasury accounting; and claim native round 0 before activation, attest, synchronize credit separately and reject duplicates. Solidity test funding injects 100 IMD into a locally generated trader; it is a fixture, not a mainnet holding.

**Browser with fork:** the connected browser test uses an injected EIP-6963 adapter and routes only the two configured public read endpoints to loopback. Named owner/claimants are impersonated and given ETH for local gas. Approval resets, owner activation and all recorded transaction hashes are local-only. Browser time starts at fork time. Wallet rejection, account/network events, oracle read failure, low-gas revert, pending/replacement timing and an empty NFT indexer response are injected. The actual router/Quoter/Permit2/claim contracts execute. It checks automatic activation detection, independent claims/sync, payer sync, exact approvals, both swap directions, executed-fee receipt, one send after double confirmation, invalid amount precision, timeout without resend, cancellation/replacement and revert reporting. It restores the fork snapshot.

**Local unit/model tests:** the 35 frontend tests include historical fixtures, encoding, mature-credit math, fee/protocol rounding, all 461 claim proofs and the new quote boundary assertions. The 43 selected contract model tests are distinct from the three deployed-launch fork tests; they are not public-chain evidence.

**Live reads:** source/distributor `--live`, fresh mainnet snapshot, and disconnected site inspection use public read-only services. The site review observed the verified official collection's current custody IDs **1181** and **1116** and their images. The quote regression never broadcasts any wallet request, even its fresh-quote control. Offline verifiers establish consistency of recorded bytes with delivered source/compiler outputs; they do not establish fresh chain state by themselves.

## Better Interface review

Applied the pinned workflow and all six domains while preserving the accepted dark editorial system. Revision assumptions: English only, one dark theme, the existing swap-first layout, no new visual components. `DESIGN.md` describes the implemented tokens and behavior; no stylesheet or layout redesign was needed.

| Domain | Coverage and evidence | Findings, fixes and limits |
| --- | --- | --- |
| Accessibility | Checked native dialog/focus in `wallet.tsx:118`, status region at `wallet.tsx:730`, and focus rules at `styles.css:102`. Chromium: Tab stays inside dialog, Escape closes it and restores trigger focus; visible 2px outline; axe found 0 violations. | Expiry closes the review and presents a readable recovery instruction in the existing status surface. Screen-reader sessions, physical devices and every forced-color background combination were not tested. |
| Layout | Checked 320, 390, 1440 reflow, connected transaction states and mobile bottom sheet. Viewed actual 390×844 and 1440×900 production screenshots. Primary CTA at 390 spans y=703.36–747.36, entirely inside the first screen. | No overflow, clipping or first-screen defect reproduced. Screenshots: `mobile-live.jpg`, `desktop-live.jpg`, `quote-slow-gas.jpg`. Native 200% browser zoom and RTL were not performed. |
| Writing | Checked recovery message at `trading.ts:190`, action labels, mainnet/inactive state and receipts. | High finding `db199e9…`: the promised 30-second expiry formerly disagreed with signing behavior. Fixed underlying validation; retained the clear “Get a new quote; nothing was sent” instruction. |
| Typography | Checked local fonts and size tokens at `styles.css:1–30`, wrapping of account/allowance values and production screenshots. | Probe found five recurring sizes at 390, six at 1440, two font families and three weights. No new typography defect. Long exact allowances wrap, rather than losing precision. |
| Colors | Checked existing semantic tokens at `styles.css:14`, error/disabled states and rendered probe. | All text pairs measured by the probe met 4.5:1 (3:1 large). This does not certify unmeasured artwork/overlays or every wallet state. State remains textual, not color-only. |
| UI details | Checked review/preparation/error/receipt states, duplicate-send guard, loading, bottom sheet and reduced-motion probe. | High signing race fixed without adding visual structure. All 16 probe checks passed. 24 of 43 measured controls are below the guide's comfortable 44px target but pass its 24px/spacing baseline; no new target regression. |

## Limitations and delivery

PublicNode historical reads failed; that failed fork attempt is saved as `fork-tests-publicnode-attempt.txt`, not counted as a pass. dRPC completed the recorded-block rerun. These free services can rate-limit or stop serving archives. Default offline verification remains runnable without them.

WebKit launch failed because required system libraries were missing; see `webkit-attempt.txt`. Its checks are explicitly unperformed in this revision. Chromium/emulated phones are not physical wallets or native-device tests. Coinbase Smart Wallet and browser-wallet signing with real funds were not exercised. No claim is made that all contract tests, platform admission or independent network review ran. Some raw stack traces replace the checkout prefix with `<repo>`; no error or result was changed.

The public website job record reports hosting/delivery requested, `site=null`, `delivery=null`. The Explorer token page resolves but its recorded links include no website backlink. `publication-status.json` records what IMD delivery must provide: assigned URL/CID/commit, association with launch 2071, and verified Explorer backlink. The supported site URL is **pending**. The included `dist/recovery.html` is the read-only fallback; preserve the eventual delivery CID/commit for rollback. Do not roll back to the previous quote-signing defect.

Screenshot packaging retains the mobile/desktop first screens and the fixed expiry error. Redundant per-scenario, NFT, milestone and probe screenshot copies were removed to meet the 8 MiB bundle limit; all raw measurement/interaction results, code, compiler records, proofs and runtime assets remain included. No dependency or required runtime asset was removed.
