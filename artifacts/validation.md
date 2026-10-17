# Compact terminal revision · validation

Worker observations, 2026-10-17 UTC. This report records local, fork and live checks separately; it is not independent certification. No public transaction, activation, deployment, economic change or balance migration was performed.

| Area | Result |
| --- | --- |
| Website | Implemented; source, lockfile and complete relative-URL `dist/` included |
| Main action at 390×844 | Yes, entire connect/trade action visible on the first screen |
| Frontend / contracts / pinned fork | 38 passed / 215 passed, 2 skipped / 3 passed |
| Connected browser / quote regressions / site | 19 / 5 / 14 checks passed |
| Accessibility scan | 0 axe violations, 51 passing rules |
| taste@1 | 14/16; two reviewed exceptions below |
| HTTPS | Existing hostname verified; preferred hostname returns 404 |
| Delivery | Export ready; publication/name mapping and delivery commit belong to IMD delivery |

## Scope, reference and rollback

Continues `ffae6425390ebabad6dd89d83aae0c200d250e26`, including its newer quote-expiry fix. Presentation was recovered from the requested commit `40d70b7bd0853aedf84eac839a40a5f12e6ac341`, using its `web/src/styles.css` and `App.tsx`, plus screenshots of the live visual reference. Recovered file SHA-256 values:

- styles: `e44f4e14b716485976d7d43be3335c48124909d6abaa8ca8563f96f5d192c0cd`
- App: `ea52f7c8b31e55f5cf5511c3d9140ba208483afd14c058ffa3850e2c8dc9b746`

The visual idea is a compact monospaced trading terminal whose staircase explains cumulative permanent rights. Desktop screenshots were compared at 1440×900; mobile at 390×844. The revised export restores the reference's diamond brand, local JetBrains Mono, near-black page/panels, fine dividers, amber dashed staircase, green earned path and cyan selection. The summary and aligned 70/30 panels replace the oversized hero. The additional mainnet statuses and all sixteen targets necessarily differ from the reference's old testnet rules. The original reference's initial 25%, final $5M, ETH swap currency and delayed gates were not carried over.

Screenshots of the production export, visually inspected:

- [Desktop terminal](terminal-desktop.jpg)
- [Mobile first screen](terminal-mobile.jpg)
- [Mobile ladder, $50M selected while confirmed rights remain 20%](terminal-mobile-ladder.jpg)

Keep baseline commit `ffae6425390ebabad6dd89d83aae0c200d250e26` and prior hosted export `ipfs://bafybeib4cpjndxi4ipjrb3f5wdtanbv6jgo5yr3x4olm6hl7ocpd5dlxuu` for rollback. `dist/recovery.html` remains a read-only fallback. History was preserved; `.git` is protected in this workspace, so the delivery service must assign the new commit. No final hash is invented.

## Implemented requirements

| Requirement | Implementation / evidence |
| --- | --- |
| Original compact presentation | `styles.css`, `App.tsx`, `NextRelease.tsx`; screenshots above; local regular/semibold fonts, exact requested palette, 6px corners, 14px root body and tabular figures |
| Desktop terminal / mobile action | Four live cells, 7fr/3fr workspace, aligned tops; stacked swap first at 900px; no horizontal page overflow at 320,390,768,900,1000,1440 |
| All gates | Initial20; $100K25, $250K30, $500K35, $1M40, $2M45, $3.5M50, $5M55, $7.5M60, $10M65, $15M70, $20M75, $25M80, $30M85, $35M90, $40M95, $50M100. Native select/list exposes each; actual tier and next state remain separate from selection/FDV estimates |
| Real history | Actual official PoolManager/pool Swap events; 2,000/10,000-block bounded options, complete coverage label, freshness/reorg checks, honest empty/error/retry; local actual buy event displayed in connected test |
| Mainnet bindings and signing | Chain1/launch2071; all 13 runtime roles and companion/factory/PoolKey bindings verified; existing router, Quoter, Permit2, exact approvals, fee/quota/expiry and final simulation code unchanged |
| Activation | Live inactive state explained with unavailable FDV; connected swaps disabled. Local owner activation appears through polling without page reload or release. No mainnet activation |
| Wallet accounting | Mature and pending one-block credits, sold counter, quota and min(balance,quota); full-unlock balance behavior retained; independent claim/attestation/reward sync/payer sync; no transfer-created rights or reset counters |
| Treasury/NFTs | Existing accrued/pending/redeemed/withdrawn/claimable/donation accounting preserved. Verified official collection and `ownerOf` custody, compact image/ID rail; real live cards and injected indexer/image failures checked |
| English rules | Whitepaper covers fixed supply, cumulative example, instant observed permanent gates, pricing, fee bases/effective costs, manual NFT purpose and manipulation/shared-executor risks |
| Static/share delivery | Relative assets, hash navigation, refresh at `#milestones`, local fonts/favicon/share image, title/description/og:title/og:image; build and export checks |
| Requested hostname | Existing working HTTPS hostname retained. Preferred `unlock` is not mapped; no naming/publishing/Explorer writer exposed. Hosting limitation reported below |

Contract sources, tests, ABIs, network pins, reader, router builder, wallet/signing implementation, dependency manifests/lockfiles and Foundry settings remain unchanged. The only ignore change overrides the checkout’s local artifact exclusion for exactly five deliverables: this report, HTTPS results and the three named screenshots. No other artifact or cache path is admitted. `git diff --exit-code` on these paths passed. New runtime logic is confined to the presentation and read-only bounded pool history. Build/share and browser-check scripts were updated; no dependency was added.

## Actual commands and results

Node/npm dependencies were installed outside the repository from its existing manifest/lockfile. The final build used that source copy and wrote directly to root `dist/`. Browser dependencies/runtimes were also outside the repository. Foundry output/cache used `/tmp`. No installation/cache directory is submitted. The final export contains26 files /1,359,522 bytes. The current-tree Git snapshot (including all five named artifacts) is below8,388,608 bytes with an additional16KiB report reserve; the exact measurement is in `web/evidence/submission-check.json`. This temporary snapshot measurement excludes source history; delivery preserves the existing parent history.

| Check | Actual result | Record |
| --- | --- | --- |
| `npm run typecheck` | Exit0 | `web/evidence/typecheck.txt` |
| `npm test` | Exit0, 38 passed; includes wrong-chain/stale/reorg/incomplete/cancelled history reads and real signed v4 deltas | `web/evidence/unit-tests.txt` |
| `npm run build -- --outDir <repo>/dist --emptyOutDir` | Exit0, TypeScript and production Vite build | `web/evidence/build.txt` |
| `forge test --match-path 'test/mainnet/*.t.sol' --out /tmp/unlock-forge-out --cache-path /tmp/unlock-forge-cache -vv` | Exit0, 215 passed, 2 skipped across42 suites | `web/evidence/contract-unit-tests.txt` |
| `UNLK_FORK_RPC=https://eth.drpc.org forge test --match-path 'test/website/MainnetWebsiteFork.t.sol' --out /tmp/unlock-forge-out --cache-path /tmp/unlock-forge-cache -vv` | Exit0, 3 passed | `web/evidence/fork-tests.txt` |
| `node scripts/verify-mainnet-source.mjs` and `--live` | Exit0; source hashes, five compiled runtimes (immutable slots excluded), ABI matches including token/hook attestations | `web/evidence/source-verification*.{json,txt}` |
| `node scripts/verify-native-distributor.mjs` and `--live` | Exit0; factory/initcode/deployed template match | `web/evidence/native-distributor-verification*.{json,txt}` |
| Fresh `verifyMainnetBindings` / `readMainnetCandidate` | Read-only; 13 runtime pins and all bindings matched | `web/evidence/live-verification.{json,txt}` |
| `node scripts/check-mainnet-browser.mjs <preview> <loopback-fork> --chromium-only` | Exit0, 19 checks | `web/evidence/browser-interactions.{json,txt}` |
| `node scripts/check-quote-expiry.mjs <preview> <loopback-fork>` | Exit0, 5 scenarios | `web/evidence/quote-expiry-after.{json,txt}` |
| `node scripts/check-site.mjs <preview> --chromium-only` with axe | Exit0, 14 checks; no page errors/local asset failures; 0 axe violations/51 passes | `web/evidence/site-review.{json,txt}` |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | Exit0 for runner; 14/16 individual checks passed | `web/evidence/design-probe.{json,txt}` |
| `node web/scripts/check-export.mjs` / `python3 web/scripts/check-bundle.py` | Final integrity/size results in the named records | `web/evidence/export-check.txt`, `bundle-check.txt`, `submission-check.json` |

The two setup skips are `RecordedLaunchBoundaryTest` and `RecordedLaunchBoundaryReverseOrderTest`; they were not counted as passes. They are separate from the three actually executed website mainnet-fork tests. Historical-state reads from the contributor provider failed, and PublicNode refused archive state; the successful fork used dRPC. No endpoint failure is represented as a successful test.

### Local/fork results

The fork pins block **26212727**, hash `0xc9b35b7491a98046f97b3704cce6845afab12b04e79501591acd5052a2865405`. Actual deployed router/Quoter/Permit2/contracts execute locally. Solidity tests cover inactive rejection, activation, actual buys/sells, quota rejection, maturity, fee accounting and independent native claim/attestation/sync. Local fixtures impersonate named owners/claimants, fund test gas and change fork state only.

The EIP-6963 test provider checks network/account changes, final-estimate invalidation, rejection, claim before activation, activation polling, separate attestation/credit and payer sync, active oracle failure, exact approvals, treasury receipt events, buy/sell, expiry, precision, duplicate confirmation, retained timeout hash, manual receipt check, replacement and mined revert. Every recorded router write has value0. The new history browser test displays the actual local buy. Anvil's mixed historic/local log forwarding hit an upstream range error; the adapter now fetches the actual historical prefix from PublicNode and concatenates actual post-fork Anvil logs. The result records0 historical events and1 local event; no event is fabricated.

Slow gas, slow final reads, excessive block drift and expired deadline each produce **zero** wallet send requests. The fresh control makes **one** request to a reject-only wallet, with no broadcast. All fork snapshots are restored. After these connected checks, only explanatory Whitepaper copy changed; the export was rebuilt and the final site/probe checks rerun. Transaction/signing code did not change.

### Live read-only results

At block **26213689**, hash `0x888aada5978a14c69112b0a7c1333d1446f0ab2c5825906955762c3bf3a51ba7`, chain1 bindings were valid, activation was false, tier0/20%, native round0 certified and FDV unavailable pending oracle binding. This is a timestamped observation, not a promise about future activation. Public source: `https://ethereum-rpc.publicnode.com`; dRPC is the configured fallback. No wallet signing occurred on mainnet.

The production site check read an actually empty official-pool range and stated its successful block coverage. Two verified NFT IDs/images were observed from the custody wallet; that count is not hard-coded. Mock RPC failure removed confirmed rights rather than inventing a tier; mock NFT indexer failure showed retry/error without cards, and image failure kept the verified ID. Public services can fail or lag; one transient PublicNode403 during inspection recovered through fallback.

## Better Interface coverage and fixes

Applied the pinned workflow and the core principles of all six domains during implementation, using the requested terminal as design authority. Supporting keyboard/dialog, form, contrast, wrapping, responsive and design-documentation guidance was consulted. `DESIGN.md` describes the final source, not a proposal.

| Domain | Coverage and result | Remaining limitation |
| --- | --- | --- |
| Accessibility | Native fields/select/dialogs, tab roles and keyboard navigation, focus return and visible2px ring, announcements, full gate selection, reduced motion; axe0 violations | No screen-reader or switch-control session; automated scan is not compliance certification |
| Layout | Desktop/mobile screenshots; 320–1440 representative widths, intermediate breakpoints, mobile action above fold, aligned panels, contained rail/table scroll, hash refresh | Native200% zoom and physical devices unperformed |
| Writing | Explicit pay/receive/gas labels, activation vs failure, verified empty vs unavailable, fees/estimates/coverage, recoverable errors and plain English risks | English only; no localization required |
| Typography | Local400/600 fonts, six tokens, mono/tabular numbers, wrapping addresses and bounded prose; restored reference density | Mono prose is an explicit brief choice and a probe exception |
| Colors | Exact requested semantic palette, text/pattern/ring state cues; all probe-measured text meets4.5:1 or3:1 large | SVG artwork excluded; no claim about every NFT image or unexercised dynamic pair |
| UI | Thin flat panels, compact6px shapes, buy/sell variants, loading/empty/error/pending/replacement states, native phone bottom sheet, restrained motion | WebKit could not launch; emulated phone is Chromium, not Safari/native device |

Applicable findings were corrected:

| Finding / source | Reproduction and impact | Fix and recheck |
| --- | --- | --- |
| High layout: oversized hero, `web/src/NextRelease.tsx:866`, `web/src/styles.css:366` | Baseline presentation separated market and action with excess space, contrary to compact reference | Compact heading/summary and aligned workspace; screenshots and first-screen CTA assertion pass |
| Medium semantics: invalid summary definition-list children, `web/src/NextRelease.tsx:875` | Initial revised markup used a non-definition child; axe flagged `definition-list` | Metric notes are now proper `dd` elements; final axe0 violations |
| High responsive UI: mobile wallet sheet anchoring, `web/src/styles.css:1468` | CSS rewrite initially lost the bottom-anchored mobile dialog behavior | Restored fixed bottom sheet and safe-area padding; browser asserts its base aligns with viewport, Tab/Escape/focus return pass |
| Medium writing/state: hidden oracle failure explanation, `web/src/NextRelease.tsx:949` | Active-feed failure explanation was only inside collapsed gate details | Added visible status notice; connected mock feed failure retains active trading/stored rights and shows unavailable FDV |
| Medium density: redundant gate controls, `web/src/MarketTerminal.tsx:414` | Range plus select and a separate readout made the ladder unnecessarily tall | One compact inspector with native selector, readout, pointer interaction and complete list; all17 options and keyboard Home/End pass |

Two probe candidates remain deliberately accepted:

- **`type-faces`**: `web/src/styles.css:36` applies JetBrains Mono to prose. The task explicitly requests locally hosted JetBrains Mono throughout, overriding the generic mono-prose preference. One family/two real weights are loaded.
- **`eyebrows`**: the heuristic flags functional activation status (`NextRelease.tsx:850`), tab controls (`MarketTerminal.tsx:251`), summary/ledger labels and adjacent section text as kickers. These are required controls/data/status, not promotional labels. Viewed screenshots show no slogan/kicker stack. Removing them would hide useful information.

All other probe checks passed, including render, overflow/overlap/clipping, targets, measured contrast, casing/tracking, type scale, copy budget, share metadata, surfaces and motion. The first-screen prose budget was below60 words. The retained probe JSON includes all checks/thresholds; repetitive DOM geometry dumps were omitted as unnecessary packaging data.

## HTTPS, naming and delivery limitations

[HTTPS evidence](https-results.json), captured2026-10-17T17:17:54Z, is read-only and refers to the existing hosted version:

- `unlk-b35c.sites.imd.fun`: DNS resolves, HTTPS200, TLS1.3, authorized certificate chain/hostname for `*.sites.imd.fun`, issuer Let's Encrypt YR1; valid Oct2–Dec31 2026. HTTP301 redirects to HTTPS. Existing main JS/CSS/favicon return200.
- `unlock.sites.imd.fun`: DNS/TLS valid but HTTP404 “No such site”. A page-title change cannot map this name. No supported authenticated naming/publishing control is exposed.
- `unlk.sites.imd.fun`: reference remains HTTPS200 with verified hostname/chain; no unrelated-site change or redirect attempted.
- PublicNode and dRPC chainId reads returned chain1 and CORS `*`. The export uses HTTPS remote services and local relative assets; no mixed-content or certificate bypass was introduced. The failed `.eth.limo` alias is unused.

Canonical/og:url retain the verified existing URL **https://unlk-b35c.sites.imd.fun/**. The Explorer token page returns200 and its actual site anchor links to the existing hostname (`web/evidence/explorer-links.json`); no metadata write was needed. IMD delivery must publish this export, map `unlock` if supported, preserve old access/redirect if authorized and then verify new assets, wallet access and Explorer backlink on the final hosted version. That new-host verification cannot be claimed before publication. Clean alternatives are retaining the current HTTPS hostname or mapping the preferred IMD hostname and verifying it before metadata changes; no domain purchase is necessary.

WebKit runtime installation was attempted, but launch failed for missing system libraries (see `web/evidence/webkit-attempt.txt`). Physical iOS/Android, real browser-wallet/Smart Wallet signing, native zoom and screen-reader tests were unperformed. All writes in the supplied evidence are loopback fork fixtures. The verifier's none profile checks paths/bytes only; it does not certify these behavior claims.
