# UNLOCK · launch 2071 website

A static React/TypeScript interface for the deployed **UNLK/IMD pool on Ethereum mainnet**. This submission changes the website and its validation only. It performs no public deployment, activation, contract change or balance migration.

The complete production export is included in **`dist/`** for the job’s Git submission, with relative asset URLs, local JavaScript/fonts/share assets, mainnet ABIs and the native round-0 proofs. Hosting serves that export without a server or rebuild. Source is in `web/`; its existing package manifest and lockfile are preserved. The inherited npm package name still contains “sepolia”; it does not set the site's chain.

## Install, preview and rebuild

With Node 24 and npm:

```sh
cd web
npm ci
npm run typecheck
npm test
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

Vite's existing `base: "./"` and `outDir: "../dist"` are retained. Use one page with section/hash navigation. `npm run dev` runs the source during development. `dist/recovery.html` provides read-only contract links and native proofs if the main interface cannot load. Historical contract work and audit evidence remain under `docs/`; historical arithmetic fixtures in `web/tests/fixtures` are explicitly separate from mainnet evidence. Retired Sepolia UI modules, the old candidate export and old public evidence were removed from the current website.

## Mainnet configuration

Pinned contract source: [`40d70b7bd0853aedf84eac839a40a5f12e6ac341`](https://github.com/identity-md-launches/launch-2071-unlock/tree/40d70b7bd0853aedf84eac839a40a5f12e6ac341). Chain 1, launch 2071, token `0x99fa82b022be4575891a43b757bc770691e18fda`, hook `0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc`. Full input records are retained in `web/evidence/deployment.json` and `web/evidence/network.json`.

`web/src/mainnet.ts` and `mainnet-pins.json` hold the verified addresses, runtime hashes and exact UNLK/IMD PoolKey: currencies sorted by address, fee 12500, spacing 60. `mainnetReader.ts` checks code, factory/registry provenance, token minter, source attestation, companion bindings, PoolKey/PoolId and mature-credit accounting. Compiled token/hook ABI hashes exactly match the supplied attestations. The factory-native distributor's runtime is separately verified against the embedded initcode in the pinned factory, rather than equating it with a local test implementation.

At the recorded preparation read, companions are deployed, native round 0 is certified, and `activated()` is **false**. The page polls every 15 seconds, rejects stale reads, and enables swaps automatically only after owner activation is observed. The owner performs activation separately. No activation control exists in the site. Native claims and read-only views remain available independently.

Buy with IMD; sell UNLK for IMD. ETH pays gas only and every router call has zero `msg.value`. The pinned Universal Router uses Permit2's allowance flow: exact ERC20 approval, then exact router allowance with a 30-minute expiry. Each is separately confirmed. The Quoter includes the treasury component but bypasses quota; exact router calldata is simulated from the connected execution account before review and again before signing. TAKE_ALL sends proceeds to that same execution account. Quotes expire after 30 seconds or more than three blocks; account/network changes invalidate them. No automatic resends occur after rejection, reversion, timeout or replacement.

Initial allowance is 20%; all sixteen gates through $50M are shown. Quota uses mature cumulative acquisitions minus all previous sales, limited by balance. Transfers do not create credit. At $50M, quota checks are permanently bypassed for every holder. Only stored onchain observations open rights; estimated FDV progress does not. Native claim, evidence attestation, reward-credit sync and payer sync are distinct actions with real timing and deduplication checks.

The rule-relevant FDV is read from the deployed oracle, never substituted with an external price API: UNLK/IMD × IMD/ETH × validated ETH/USD × fixed 1B supply. Before the oracle is bound at activation, FDV is unavailable. The site distinguishes the 1.25% pool fee and 0.75% treasury component, directional protocol fees, estimates and actual receipt TreasuryFee events. Sell fee estimates can have one wei of ambiguity when inverted from net output; actual receipts provide the executed leg and fee. Treasury accounting separates pending PoolManager claims, redeemed/withdrawn/claimable fees, donations and actual wallet holdings.

The official `identity.md` NFT collection is verified from [IMD's contract table](https://imd.fun/docs#contract-addresses), its code hash and onchain name. Discovery uses free paginated Blockscout data; cards require matching collection and `ownerOf` verification at the displayed block. Images/metadata are bounded and rendered as inert blobs. PublicNode/dRPC/Blockscout can fail, rate-limit or lag. No key, paid API or private backend is needed. NFT purchases are manual; holdings do not establish purchase funding or promise returns.

## Validation

Actual results and limitations are recorded in [`web/evidence/validation.md`](web/evidence/validation.md); raw outputs are alongside it. This revision restores the missing evidence in a source-submitted directory. No verification command depends on `.imd/reads/`, an upload-only `artifacts/` directory or an omitted build cache. Main checks:

```sh
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
forge test --match-path test/website/MainnetWebsiteFork.t.sol -vv
forge test --match-contract '^(ImdFeeMathTest|OneWayGatesTest|QuotaMitigationTest|ImdPermitAndBatchTest)$' -vv
forge test --match-contract '^ImdProtocolFeesTest$' -vv
node web/scripts/verify-mainnet-source.mjs
node web/scripts/verify-native-distributor.mjs
web/node_modules/.bin/tsx web/scripts/verify-mainnet.ts
```

The two JavaScript verification commands default to **offline verification of recorded mainnet bytes**, with explicit evidence labels. They compare the included minimal compiler outputs, source-file hashes, delivered ABIs, token/hook ABI attestations and distributor template against the saved runtimes. They do not rewrite ABIs. Add `--live` to either command to refetch the same block from the configured public RPC; both modes passed in this revision. To regenerate inputs, run `forge build`, `node web/scripts/record-compiled.mjs`, then `web/node_modules/.bin/tsx web/scripts/record-mainnet-evidence.ts`. Compiler settings, input files, block hash and RPC are included in `web/evidence/`.

The deployed-launch fork pins Ethereum block **26212727**, hash **`0xc9b35b7491a98046f97b3704cce6845afab12b04e79501591acd5052a2865405`**. Its tests impersonate named accounts **only locally**, activate only the fork, use the actual deployed router/Quoter/Permit2/contracts, and test buys/sells, quota rejection, one-block maturity, fees and native claims. IMD test funding in the Solidity swap test and ETH gas funding in browser tests are local fixture changes. PublicNode refused this historical state during the revision (`fork-tests-publicnode-attempt.txt`); the successful rerun used dRPC. `UNLK_FORK_RPC` can override the Solidity test's public read endpoint without changing Foundry configuration. Earlier missing logs are not reconstructed or claimed as evidence.

For connected browser validation, install Playwright and its browser runtimes outside the repository. With Anvil and Python 3 installed, the bounded runner starts and closes its own loopback fork and static preview:

```sh
export IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs
node web/scripts/run-fork-browser.mjs quote
node web/scripts/run-fork-browser.mjs full --chromium-only
# Against a running npm preview (live public reads; no wallet writes):
node web/scripts/check-site.mjs http://127.0.0.1:4173 --chromium-only
```

The connected test rejects any RPC destination except loopback. Its wallet provider is an injected EIP-6963 test adapter; transactions execute on the real-contract local fork. It restores the fork snapshot after testing. The quote regression rejects every wallet send request, records the pre-fix reproduction, and checks slow gas estimation, slow final reads, block drift, deadlines and a fresh-quote control. Expired quotes now close review with zero wallet send requests. Browser time starts at the fork timestamp; virtual time advances are labelled fixture changes. Optional `IMD_AXE_MODULE` identifies an externally installed `@axe-core/playwright` module. Production code has no test RPC override or injected test provider. The original npm `verify:chain` and `verify:live` aliases perform read-only mainnet verification; browser aliases use the current scripts. Chromium checks passed; WebKit could not launch because system libraries were unavailable (`webkit-attempt.txt`). Omit `--chromium-only` on a host with those libraries to include WebKit.

The pinned design probe is run from the repository root during this job: `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`, with `IMD_PLAYWRIGHT` when needed. Those input files disappear after submission; the resulting report, six-domain review, measured screenshots and design system remain in `web/evidence/` and `DESIGN.md`.

## Publication, Explorer link and rollback

This is the existing Add a website job **`b35cc3bc-234d-4e8a-880f-e6081c3c78a6`**, continuing the project that deployed launch **`0528a007-5ec6-4acd-b9cc-b3ded6fe2929`**. Its public job record requests hosting and GitHub delivery. At validation time it has **no assigned site URL or delivery commit yet**. The supported site URL is therefore **pending the job's publication step**. No hostname, CID or final commit is invented.

The [UNLK token page in IMD Explorer](https://explorer.imd.fun/token/0x99fa82b022be4575891a43b757bc770691e18fda) resolves and matches this launch, but the recorded page has no website link. This job exposes no authenticated metadata-writing tool. The job delivery service must publish the submitted `dist/`, attach that site to launch 2071, and verify the token-page backlink. This blocker and fresh public observations are recorded in `web/evidence/publication-status.json`, `public-job-status.json` and `explorer-links.json`. No new launch/job, public write or manual publishing command was used.

Keep the final export's CID and delivery commit from that job record for future rollback. Until those are assigned, `dist/recovery.html` is the included read-only fallback. The accepted baseline commit is recorded in `publication-status.json`; it precedes this quote-expiry fix, so restoring its swap code would restore that defect. The old `unlk.sites.imd.fun` is a visual reference, not this job's assigned site or a verified mainnet rollback target. Source history remains rooted at the pinned commit; the delivery service records the new submission commit. Do not activate, migrate balances or redeploy contracts as part of a website rollback.

## Submission boundaries

All contract source, `lib/`, Foundry settings, dependency manifests/lockfiles, ignore files and protected directories remain untouched in this revision. The existing dependency ignore has the path budget **directories named `node_modules` at any depth only**. It does not hide `dist/`, source, proofs, screenshots, manifests, lockfiles or other deliverables. Foundry cache/output and `test/scratch` already had exclusions. No submodule or dependency archive was added. Export integrity and the submission size check are recorded in `web/evidence/submission-check.json`.
