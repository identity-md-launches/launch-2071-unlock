# UNLOCK · Sepolia terminal

This redesign continues accepted website commit `b01b41bfdf20a20519c5902eda3d0677b7f2b6df`. React/TypeScript source is in `web/`; the complete static export is in `dist/`. Existing Sepolia contracts, authenticated router, pool rules, wallet connectors and dependency/build configuration are preserved. No public transaction, deployment or mainnet operation was performed.

## Install, preview and rebuild

Use Node 22.12+ and npm (this run used Node 22.22.2).

```sh
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm --prefix web run preview -- --host 127.0.0.1 --port 4173
```

Vite writes the repository-root `dist/` with `base: "./"`. Serve that directory, including all assets, fonts, ABI downloads and the authentic reward proof fallback. Navigation uses hash routes, so GitHub Pages and IPFS gateway subpaths need no rewrite server. For development use `npm --prefix web run dev`; to serve the finished export without a build use `python3 -m http.server 4173 --directory dist`.

Dependencies are specified by the existing, unchanged `web/package.json` and `web/package-lock.json`. The worker installed into an isolated `/tmp/unlk-redesign/web` copy, synchronized frontend source into it, built there and copied its `dist/` back. No `node_modules`, dependency archive, registry mirror or cache is included. No ignore file was changed.

## Interface and data

- A 1280px terminal workspace pairs an original, interactive categorical **Unlock ladder** with a 360px Buy/Sell form. The main action is visible at 390×844; the complete desktop chart/form fits at 1440×900.
- The seven actual rules are 25%, 35%, 45%, 55%, 70%, 85% and permanent full quota bypass, at the configured FDV milestones. Confirmed rights, hypothetical selection, indicative spot FDV and verified oracle FDV are separate. Missing oracle data never becomes a confirmed milestone.
- Market History uses only covered official-PoolId Swap events: price lines, per-event ETH volume, 1H/24H/7D/All ranges, crosshair, touch selection and a keyboard event slider. It states the covered block interval, two-block delay and read time. No candles or synthetic trades are produced.
- My Unlock shows only the connected wallet’s W/E/S/C ledger and a labelled allowance bar. The outside segment remains in the wallet; it is not escrow. The hypothetical milestone selector holds the wallet ledger fixed. Exact BigInt arithmetic is `Q = max(0, floor(E × p / 10000) − S); C = min(W, Q)`; full unlock uses W for everyone. Transfers do not create E.
- Percentage buttons only fill amounts. Buy reserves real router-estimated gas with a 20% buffer; Sell uses current quota, balance and seed-range capacity. Inputs remain editable. Exact router simulation, bounded direct ERC-20 approval, minimum receipt, slippage, actual fee, fresh gas review, expiry and receipt/rejection/revert recovery remain intact.
- Sell proceeds settle as `nativeCredit`; `withdrawNative` is separate and cannot redirect the recipient. Native claim, evidence attestation, certification/chunks and hook sync, original payer sync, checkpoint and milestone update remain available. Every write requires explicit review and wallet confirmation.
- Browser wallets use EIP-6963; phones have wallet-browser links; Coinbase Smart Wallet remains available. Connection requests accounts/chain only. Account or network changes invalidate transaction reviews and personal data.

The current read-only verification still reports **verified milestone FDV unavailable**. The UI does not replace it with spot FDV. Oracle maintenance depends on permissionless transactions; the static site is not a keeper. Existing protocol economic risks and deployment history remain discoverable in Docs and Contracts.

## Checks and evidence

[DESIGN.md](DESIGN.md) documents the implemented system. The current [validation record](web/public/evidence/validation.md) records the six-domain Better Interface review, exact commands, fixes, coverage and limitations. JSON evidence is bundled under `web/public/evidence/` and `dist/evidence/`; full-size screenshot artifacts are in `artifacts/screenshots/` for the contributor uploader.

Actual results from this redesign:

- Production build and standalone typecheck passed; 10 frontend tests passed.
- 64 existing contract regressions passed. Two additional cross-language tests passed: 14 exact v4 swap vectors and 43 wallet-quota vectors, including wei rounding and full bypass.
- 35 ABI/runtime/pool/binding checks passed at Sepolia block 11913027. Live read-only buy simulations and holder quota comparisons passed; all 459 authentic round-0 proofs verified.
- Chromium: all six views at 320/390/768/1440px; no horizontal overflow, script/local-resource errors or axe violations. Chart touch/keyboard controls, history, mobile wallet links, navigation, disclosures, filters, invalid input and offline states passed.
- A disposable local Sepolia fork completed Buy, exact approval, Sell, ETH withdrawal, native claim, attestation and credit sync through the production UI. The test wallet used local account impersonation, no private key and no public broadcast. Live rejecting-provider tests also covered network/account changes, quote expiry and rejected signing. Recovery fixtures covered pending, confirmed, reverted and RPC/proof-service failure.
- WebKit rendered at 320/390/1440px and passed chart selection, wallet dialog/focus flow and Sell controls. Its machine-level direct HTTPS transport failed; the WebKit harness forwarded requests to the actual public read services with Node. Native iPhone/extension/passkey signing, a screen reader and browser-native 200% zoom were not tested.
- The pinned taste probe passed **14/16** raw checks. The two flags are reviewed exceptions: the required monospace prose, and the heuristic misclassifying the required testnet badge, output field label and chart tab as editorial kickers. Render/layout/contrast/targets/type scale/motion/metadata checks passed. No high or medium issue remains open in the implemented scope.

Reproduce browser checks with Playwright and axe installed outside the repository:

```sh
npm install --prefix /tmp/unlk-checks playwright @axe-core/playwright
/tmp/unlk-checks/node_modules/.bin/playwright install chromium webkit
IMD_PLAYWRIGHT=/tmp/unlk-checks/node_modules/playwright/index.mjs \
UNLK_AXE_MODULE=/tmp/unlk-checks/node_modules/@axe-core/playwright/dist/index.mjs \
  node web/scripts/check-browser.mjs
IMD_PLAYWRIGHT=/tmp/unlk-checks/node_modules/playwright/index.mjs \
  node web/scripts/check-wallet.mjs
IMD_PLAYWRIGHT=/tmp/unlk-checks/node_modules/playwright/index.mjs \
  node web/scripts/check-recovery.mjs
IMD_PLAYWRIGHT=/tmp/unlk-checks/node_modules/playwright/index.mjs \
  node web/scripts/check-webkit.mjs
```

`check-fork.mjs` additionally requires Anvil and the installed frontend `viem`; run it from `web/` with `node scripts/check-fork.mjs`. It starts and closes a local fork, forwards public-client reads to that fork and sends wallet requests **only to localhost**. Public RPC availability and upstream state can change, so live and fork evidence is explicitly block-stamped. Browser scripts manage their own foreground preview under `/preview/` and close it afterward.

The unchanged production verification scripts remain available via `npm --prefix web run verify:chain` (after the existing Foundry build) and `npm --prefix web run verify:live`. Cross-language generators are `web/scripts/check-swap-math.ts` and `check-allowance-math.ts`; their disposable Solidity scaffolding belongs in `test/scratch/`.

## Publication handoff

Target: **https://unlk.sites.imd.fun/**, existing name **`unlk.site.identitymd.eth`**. The complete source and `dist/` are ready for the contributor network’s GitHub/IPFS publication step. This task forbids writing `.git/`; the worker has not created a submission commit or claimed a new CID. The network assigns those after accepting the export. The previous hosted CID is not reported as this redesign’s CID. See `artifacts/publication.json` for this distinction.

## Earlier contract project documentation

The following pre-existing project record is preserved for provenance; its historical release status does not replace the newer block-stamped website verification above.

# UNLOCK / UNLK — Sepolia two-stage release package

**Revision 2026-10-13 (independent review findings):** `beforeInitialize` now runs the same Sepolia service pin
check as stage 2, so a launch through an unpinned factory, manager, fees or registry reverts in the launch
transaction instead of locking the seed in a pool that can never activate; and the router bounds every swap's
price limit to the factory's seed range, so a sell that drains the ETH reserve ends at the seed boundary (the
launch state) instead of walking the price into empty liquidity that the oracle classed illiquid. `UnlkHook` and
`UnlkSwapRouter` bytecode changed; the other four artifacts did not. Details, hashes and evidence:
[docs/REVISION_2026-10-13.md](docs/REVISION_2026-10-13.md); current status: [delivery/STATUS.json](delivery/STATUS.json).
The paragraphs below are the historical record of the restored published commit and still apply unless that
revision record says otherwise. The delivered suite is now 208 tests in 40 suites.

**This continuation fixes the source of launch 1534's admission failure; public trading remains inactive.**
Launch `55d5370e-7256-465c-808f-09ba4cc8ccee` is parked because the old `HookDeployer` runtime was 26,264 bytes.
The helper now accepts the reviewed hook creation code as input and has a **728-byte runtime**. All five production
contracts have identical creation/runtime bytecode. The full 175-test suite and `imd launch check .` pass locally;
service re-admission of the parked launch remains a separate operation. No transaction was broadcast.
Both stages were previously rehearsed on the real Sepolia factory at recorded block **11,904,506**.
Stage 1 must remain unbroadcast until the owner's stage-2 execution path and the outstanding release decisions are secured.
See [deployment and required signatures](docs/DEPLOYMENT.md), [release status](RELEASE_STATUS.json), and
[review and measured manipulation risk](docs/SECURITY_REVIEW.md). Fork addresses are simulations, not deployments.

Continues the published source at `f77cf377f6eb58f05ef9b9c61f36407933d5053a`, including its accepted work.
GitHub main and the project's published head still matched that commit when checked. No earlier bundle was
recovered again. [Size-fix handoff and publication status](docs/SIZE_FIX.md); [historical recovery record](docs/RECOVERY.md).

## Build and check

```sh
forge build
python3 scripts/generate_code_checks.py --check
forge test
python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
forge fmt --check
python3 scripts/verify_network.py
python3 scripts/export_abis.py
python3 scripts/release_artifacts.py
imd launch check .
```

Solidity **0.8.26**, Cancun, optimizer 200, `bytecode_hash = "none"`. All Solidity dependencies are ordinary
vendored files under `lib/`, pinned in `dependencies.lock.json`; no submodules, network downloads, FFI, filesystem
cheatcode access, environment-dependent tests, or compiler binaries are needed. `scripts/check.sh` runs the local
checks. [Validation evidence](docs/VALIDATION.md) distinguishes unit/invariant tests, protected checks, and the fork.

## Contracts and lifecycle

* `UnlkToken`: 1 billion UNLK, 18 decimals, minted once to its deploying factory. No subsequent mint, owner, tax,
  transfer quota, pause, blacklist or upgrade. Passive original-distribution receipts record factory transfers
  until its initial balance first reaches zero. Later transfers/donations cannot change those receipts.
* `UnlkHook`: constructor **`($poolManager, $token, $factory, $owner)`**, no companion arguments or constructor
  external calls. `$owner` is an immutable setup authority, never the factory or IMD signer.
* Stage 1: factory creates token/hook/distributor and initializes the native ETH pool with this hook already in
  its `PoolKey`. Only the manager can call callbacks; only the factory can initialize, exactly once. On chain
  11155111 `beforeInitialize` also requires the factory, pool manager, the factory's `fees()` and its
  `registry()` to carry the pinned `SepoliaRelease` code hashes, the same check both stage-2 calls make, so a
  launch stage 2 would refuse cannot be created. Factory seeding works while UNCONFIGURED. Swaps, quota credits
  and milestones revert; ordinary transfers and eligible native distributor claims work independently.
* Stage 2a: the setup authority calls `deployCompanions(number,feed,routerCode,evidenceCode,oracleCode)` on the
  hook. Each supplied **creation bytecode** must match its compiled constant hash. The hook derives constructor
  arguments from its stage-1 records and deploys all three companions by CREATE2 in one atomic call. This also
  proves their initial storage, unlike ABI or runtime matching alone. Staging first re-runs every stage-1
  precondition of activation (services, registry record, seed position, allocation receipts, distributor
  bindings, live seed capacity), so nothing is staged for a launch that cannot activate. Until activation the
  authority may stage again (a fresh identical bundle under a new salt; the abandoned one can never activate);
  after activation staging is closed permanently.
* Stage 2b: anyone certifies the complete unique-recipient round-0 tree in `MerkleClaimEvidence.certifyRound`
  (up to 1024 leaves in one call) or, for larger rounds, through the chunked `submitLeaves`/`reduce` session path.
  Then the setup authority calls `configureAndActivate(router,evidence,oracle,number)`. It validates stage-1
  records, token creation provenance, allocation receipts, pool/range, dependencies, code/settings and reciprocal
  bindings, binds the oracle, starts observation, and permanently seals. Failure rolls back all activation writes.
* `UnlkSwapRouter`: the sole official-pool swap route. It pulls only `msg.sender`'s input and delivers only to that
  caller. Per-operation context/nonce authenticate the trader; no `tx.origin`. Native outputs and unused ETH
  become caller-owned pull credits (`withdrawNative`). No arbitrary recipient, arbitrary payer or admin sweep.
  Every swap's price limit is bounded to the factory's seed range (the pool's only liquidity): a sell stops at
  the seed's upper boundary and a buy at its lower boundary, with partial fills; a tighter caller limit applies.
* `MerkleClaimEvidence`: actual distributor claim flag **and** exact leaf proof, once per round/recipient. A full
  tree certificate proves recipient uniqueness before amounts can be attested, including claims made before
  activation. Native claims need no certificate, oracle, hook call or credit synchronization.
* `UnlkOracle`: explicit v4 tick accumulation. It does not assume that PoolManager has a built-in TWAP.

No upgrade, pause, reset, replacement, trading exemption, privileged withdrawal or post-activation owner operation
exists in these contracts. The setup authority's deployment and activation powers both expire after use.

## Economics and quota

Factory distribution: **10% native contributor distributor / 87% official pool / 3% actual remainder recipient**.
Seed integer rounding can leave dust with the recipient; only the fixed 30 million allocation is credited.
Activation requires the pool receipt within 10^12 minor units (0.000001 UNLK) of 870 million. Payer attribution is
historical and remains correct after transfers or `factory.setRequester`; a current balance is not evidence.

The official pool fee is **12500 = 1.25%**, split by the authentic factory **80/20**: 1% payer, 0.25% IMD. The hook
adds no fee, fee override, or return delta. Factory liquidity principal cannot be removed. Zero-liquidity fee
collection is permitted, including before activation. The factory supports pull recovery of failed fee payouts.
The factory's fee-share holder may assign future fees, and IMD's external fee settings may change its recipient;
these existing platform powers do not move UNLK credit or unlock principal.

For each wallet, `E` is authenticated official-pool buy output + original allocation credit + proven native claims.
`S` is **executed** token input sold, including the input-side LP fee. `Q = max(0, floor(E*p/10000) - S)`.
Exact-input/output swaps and partial fills enforce Q atomically. Transfers, donations and liquidity create no E.

| Confirmed USD FDV | p | Confirmation after preceding tier |
|---|---:|---:|
| Initial | 2500 | immediate activation |
| $100,000 | 3500 | 6 hours |
| $250,000 | 4500 | 6 hours |
| $500,000 | 5500 | 6 hours |
| $1 million | 7000 | 6 hours |
| $2.5 million | 8500 | 6 hours |
| $5 million | permanent quota bypass | 24 hours |

At the final tier every holder, including transfer-only recipients, can sell without quota. Authentication and
fees remain. Prices falling or oracle outages never reduce a reached tier.

## Oracle parameters and their limits

* **2-hour token/ETH geometric TWAP**, minimum full-window warm-up; same-timestamp changes add no past weight.
* Chainlink Sepolia ETH/USD, exactly 8 decimals, positive bounded answer, nonzero/coherent timestamps and round,
  no future update, `answeredInRound >= roundId`, **90-minute maximum feed age** (hourly heartbeat plus grace).
* Latest pool checkpoint no older than **5 minutes** when read. Every swap and liquidity operation checkpoints
  before/after state changes. Anyone may checkpoint or call `updateMilestone`.
* Confirmation samples at least **4 minutes** apart, at most **10 minutes** apart. No parallel tier accumulation.
  An invalid value (stale or incoherent feed, illiquid or stale pool reading) is not a sample: it never confirms a
  tier and never advances the cadence clock, and earned rights remain. Whether a run restarts is decided only by
  the gap between **valid** samples, so an invalid interval has the same effect whether or not somebody called
  during it: shorter than the 10-minute gap it is simply skipped, longer and the next valid sample restarts the
  run. A genuine below-threshold value also restarts. Repeated same-block calls provide no progress.
* **17 ETH minimum opening-value capacity of the locked factory seed**, plus in-range price and minimum seed
  liquidity `1e18`, continuously over the TWAP window. This is a price-independent capital-quality check:
  870M tokens at 20 ETH/billion provide approximately 17.4 ETH capacity. It is explicitly **not** a claim of 17 ETH
  cash reserves. There is no additional actual-ETH-reserve threshold hiding behind the $100K tier.
* The test seed conservatively rounds the 20 ETH cap to the native token-only boundary tick 177300, giving
  19.968425 ETH FDV and about 17.37253 ETH seed capacity. Tests also prove the first tier below 10 ETH cash reserves.
* **The floor is enforced three times, never assumed.** `beforeAddLiquidity` computes the seed's principal and
  opening-value capacity (`SeedDepth`, the oracle's own formula) when the factory seeds and reverts the launch
  transaction if the capacity is below 17 ETH or the principal is outside the pool-share band; `deployCompanions`
  and `configureAndActivate` recompute both from the live factory position. The minimum opening FDV that passes
  is 17 / 0.87 = 19.54 ETH, 2.3% under the 20 ETH policy cap (under four tick spacings of rounding). A seed that
  would leave the oracle permanently illiquid therefore cannot launch, let alone seal.
* **Allocation receipts are checked against bands, not a dust tolerance.** The pool must have received between
  99% and 100% of its 870M share (`MIN_POOL_ALLOCATION` = 861.3M), the remainder wallet at least its 30M, the
  distributor exactly 100M, and the three must sum to the supply. The remainder wallet is credited exactly 30M
  whatever rounding it received. Deployer liquidity rounding is about 1e-14 relative, so the band is generous
  without changing the economics measurably.

A high sustained price can still force all tiers. At a fixed test feed of $2,000/ETH, raising the token-only pool
to $5.1M and waiting **56 hours** costs about **181.21 ETH gross**, **2.47 ETH net exit loss** without counter-selling;
a payer attacker recovers native fees and loses only about **0.65 ETH** (excluding gas/financing and token fees).
Counter-selling all initial non-pool allocations raises the modeled gross to **404.49 ETH**, net loss to
**264.82 ETH**. These are reproducible scenarios, **not lower bounds or proof of manipulation safety**.
[Method, exact results and residual release concerns](docs/SECURITY_REVIEW.md).

Other pools can trade the freely transferable token without this hook's quota. The official pool cannot prevent
that. External manager governance and Chainlink administration remain dependencies. No independent auditor has
approved this revised artifact; the recovered reviews plus this implementation's adversarial pass are not a new
independent audit.

## After launch

The only setup calls are `deployCompanions`, tree certification, and `configureAndActivate` described above; all
inputs come from the new launch's actual records and frozen claims. There are no later setters. Any funded wallet
may operate a keeper every 5 minutes to call `updateMilestone` during confirmations. There is no keeper reward or
privileged keeper role; missed calls delay tiers. Claims retain the distributor's own unlock/sweep timing regardless
of keeper/oracle state. Users may call `attest` then `syncRewards`, and anyone may call `syncPayer` and `claimFees`.

Twenty ABIs are in `docs/abi/`; reproducible creation/template hashes and sizes are in `docs/ARTIFACTS.json`. [Deployment package](docs/DEPLOYMENT.md) names verified services, responsible actors,
required wallet transactions, recorded fork evidence, and the missing public execution operation.
