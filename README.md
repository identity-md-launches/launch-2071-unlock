# UNLOCK · launch 2071 website

A compact UNLK/IMD terminal for Ethereum mainnet, continuing commit `ffae6425390ebabad6dd89d83aae0c200d250e26`. The original mono terminal presentation comes from `40d70b7bd0853aedf84eac839a40a5f12e6ac341`; newer mainnet transaction logic, quote-expiry fixes and accounting remain intact. This revision changes the website, validation and documentation only.

The complete static export is in **`dist/`**, alongside source, the existing dependency lockfile, local fonts, share assets, ABIs and native round-0 proofs. Vite retains `base: "./"`; the export works at a gateway subpath without a backend or route rewriting. The inherited npm package name contains “sepolia”; the application is pinned to chain 1.

## Install, preview and rebuild

Use Node 24, npm and the existing lockfile:

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`. `npm run dev` runs source development. The build writes root `dist/`; include that entire directory in static delivery. Hash navigation supports mobile refresh. `dist/recovery.html` retains read-only contract links and native proofs. Do not ship `node_modules`, npm caches or Foundry output. For this worker run, dependencies were installed under `/tmp` from the unchanged manifest/lockfile, and the build targeted the repository's `dist/`.

## What changed

The oversized hero is replaced with the diamond UNLOCK_ header, mainnet/status strip, compact UNLK/IMD heading and four-cell live summary. Desktop uses a roughly 70/30 ladder/history and swap layout; mobile puts the swap first. JetBrains Mono 400/600, original dark palette, thin borders, 6px corners and tabular figures are restored.

The amber dashed categorical ladder exposes initial 20% plus all sixteen gates through $50M/100%, using pointer selection, a native keyboard/touch selector and a complete gate list. Confirmed, next and selected states are separate from price estimates. History reads actual official-pool Swap events, states its complete block coverage, and distinguishes unavailable data from a verified empty range. Treasury/NFTs and English rules remain below the primary interaction.

[`DESIGN.md`](DESIGN.md) documents the final design system. [`artifacts/validation.md`](artifacts/validation.md) records requirements, the six-domain Better Interface review, actual test results, limitations and HTTPS observations. Screenshots: [desktop](artifacts/terminal-desktop.jpg), [mobile first screen](artifacts/terminal-mobile.jpg), [mobile ladder](artifacts/terminal-mobile-ladder.jpg). Raw evidence is under [`web/evidence/`](web/evidence/).

## Mainnet and transaction boundaries

Chain **1**, launch **2071**. UNLK: `0x99fa82b022be4575891a43b757bc770691e18fda`; hook: `0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc`. Deployment/network records and compiled-source evidence are included in `web/evidence/`. Runtime hashes, source/ABI attestations, factory/registry provenance, companions, native distributor and exact PoolKey are verified before writes.

Buy pays IMD and receives UNLK; sell pays UNLK and receives IMD. ETH pays gas only; router `msg.value` is zero. The pinned Universal Router, Quoter and Permit2, exact approvals, 30-minute router allowance, directional fee math, quota checks and final pre-sign simulation are preserved. Quotes expire after 30 seconds or more than three blocks. Account/network changes invalidate reviews. Rejection, revert, timeout and replacement never trigger automatic resends.

At the recorded live read on 2026-10-17, trading was **inactive**, tier 0/20%, with the oracle awaiting its activation binding. That is unavailable FDV, not zero FDV or a failed deployment. The page polls every 15 seconds and enables swaps after confirmed activation without another release. This job never activates mainnet; the owner does that separately. Native claims remain independent. Claims, evidence attestation, reward-credit sync and payer sync remain separate wallet actions.

Quota is `max(0, floor(mature eligible credits × allowance) − cumulative sold)` and sellable is the lesser of quota and balance. Buy credits mature after one block; transfers create no rights or counter resets. At full unlock every holder uses balance. Pool fees are 1.25%, plus 0.75% of the executed IMD leg for the treasury; the bases differ, giving approximately 1.9851% buy / 1.990625% sell costs at zero protocol fee and without impact/rounding. Quotes include current directional fees and receipts show actual treasury events.

Treasury accounting separates accrued, pending, redeemed, withdrawn, claimable and donated funds. NFT discovery uses free paginated data from the verified official collection; every displayed ID requires `ownerOf` verification for custody `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9`. Image/indexer failures are explicit. Holdings do not prove fee-funded purchases. Purchases are manual; there are no automatic purchases/burns or return guarantees. The rules disclose permanent spot-touch gates, pool/reference manipulation and shared-executor quota pooling.

## Reproduce validation

```sh
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
forge test --match-path 'test/mainnet/*.t.sol' -vv
UNLK_FORK_RPC=https://eth.drpc.org forge test --match-path 'test/website/MainnetWebsiteFork.t.sol' -vv
node web/scripts/verify-mainnet-source.mjs
node web/scripts/verify-native-distributor.mjs
node web/scripts/check-export.mjs
python3 web/scripts/check-bundle.py
```

The two JavaScript source verifiers default to offline comparison of included compiler/runtime/source records; `--live` fetches the pinned block. Contract sources, ABIs, build configuration and dependency manifests/lockfiles are unchanged. The only ignore change has an explicit five-file path budget for the named `artifacts/` deliverables; dependency/cache exclusions remain intact.

For browser checks, install Playwright and browser runtimes outside the repository, then set `IMD_PLAYWRIGHT` to its `index.mjs`. Optional `IMD_AXE_MODULE` points to an external `@axe-core/playwright/dist/index.mjs`. With Anvil and Python 3:

```sh
node web/scripts/run-fork-browser.mjs full --chromium-only
node web/scripts/run-fork-browser.mjs quote
# Against an already running production preview, live reads only:
node web/scripts/check-site.mjs http://127.0.0.1:4173/ --chromium-only
```

The runner owns disposable loopback services and restores the fork snapshot. Connected tests reject non-loopback RPC destinations for writes. Fixture activation, impersonation, gas funding, virtual time and injected wallet failures are local only. Actual deployed contracts/router are used at block **26212727**, hash `0xc9b35b7491a98046f97b3704cce6845afab12b04e79501591acd5052a2865405`. The history test separately reads the actual historical prefix from PublicNode and combines it with actual post-fork Anvil events, avoiding an upstream mixed-range limitation.

Current results: **38 frontend tests**, **215 contract tests** (2 setup skips), **3 deployed-mainnet fork tests**, **19 connected-browser checks**, **5 stale-quote scenarios** and **14 site checks** passed. The site audit found **0 axe violations**. The pinned design probe passed **14/16**; its mono-prose warning conflicts with the requested typography, and its kicker heuristic misidentifies functional status/data labels. Both are documented with source references. Chromium was exercised; WebKit could not launch because this machine lacks required system libraries. Native devices, real wallet signing and screen readers were not tested. These are worker observations, not independent certification.

## URL, publication and rollback

Existing working URL: **https://unlk-b35c.sites.imd.fun/**. Read-only checks verified DNS, TLS chain/hostname, HTTP-to-HTTPS redirect and existing assets. The preferred **https://unlock.sites.imd.fun/** has valid DNS/TLS but returns **404**. No supported naming or Explorer metadata writer is available in this job, so the working hostname is retained in canonical/share metadata. No domain was bought, unrelated site changed or publishing command run. The revised export awaits the delivery service; it is not claimed live.

The [IMD Explorer token page](https://explorer.imd.fun/token/0x99fa82b022be4575891a43b757bc770691e18fda) returns 200 and already links to the existing HTTPS site; the rendered anchor was verified read-only. IMD hosting must map the preferred hostname, publish this export, and recheck the backlink/redirect after delivery. Do not use the failed `.eth.limo` alias. Clean options are to keep the existing HTTPS hostname or map `unlock.sites.imd.fun` through IMD and verify it before changing metadata.

Rollback: retain baseline commit `ffae6425390ebabad6dd89d83aae0c200d250e26` and the prior hosted export `ipfs://bafybeib4cpjndxi4ipjrb3f5wdtanbv6jgo5yr3x4olm6hl7ocpd5dlxuu`. The old visual reference `https://unlk.sites.imd.fun/` remains accessible; it is not a mainnet configuration to restore. `dist/recovery.html` is the current read-only fallback. Git history was preserved; the delivery service assigns the new commit because this workspace prohibits `.git` writes. No delivery hash is invented.
