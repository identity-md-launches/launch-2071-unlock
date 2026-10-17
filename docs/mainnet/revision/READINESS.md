> Current revision (2026-10-16): Superseded release status: see [../../unlock-gates/HANDOFF.md](../../unlock-gates/HANDOFF.md). Valid instantaneous UNLK spikes are accepted; H-01/external-reference Highs are separate, and contributor review now occurred.

# Readiness and final-change review handoff

**CODE COMPLETE FOR THIS MITIGATION CANDIDATE; RELEASE BLOCKED.** This is not a claim of global H-01 prevention, production-safe irreversible unlocking, independent audit, public deployment or publication. The original independent High remains High. The exact submission commit must be supplied by the contributor upload step; local `.git` access/writes and public transactions were not performed.

> **Oracle redesign revision:** rows marked (redesign) supersede the proof-source rows below; see [SAMPLED_ORACLE.md](SAMPLED_ORACLE.md).

| Area | Status | Evidence / remaining condition |
| --- | --- | --- |
| (redesign) Active price source | Implemented, review pending | `ImdSampledUsdSource` pinned as `PRICE_SOURCE`; proof source rejected at setup; 15 sampled-source tests incl. fuzz; real pool/feed read at block 26204279 |
| (redesign) Oracle manipulation | **High, unresolved** | Flash/anchor contained; repeated/sustained pass; final-bypass model profitable with attacker-owned LP (synthetic) |
| (redesign) Spot display | Implemented, preview only | `web/src/spotPrice.ts`, 4 new frontend tests; UNLK leg unavailable until deployment |
| (redesign) Full checks | Passed locally | 345 Foundry tests (seed 0x575e97c9…4312), fmt check, frontend typecheck/build/28 tests; author checks only |
| (redesign) Independent review | **Pending** | None obtained in this run |
| Preserved target and economics | Implemented | Mainnet univ4_hook UNLK/IMD, 1B/18 decimals, 10/87/3, 1.25% official fee, 75bps IMD vault, fixed beneficiary, principal lock, sixteen 20–100% tiers and final bypass |
| Standard router / normal wallets / smart accounts | Tested | All four modes, token ordering, locally signed Permit2, Quoter, directed recipient, batch, multihop, alternate executor and smart-account tests; no tx.origin or EOA gate |
| H-01 atomic recycling reduction | Implemented | One-block buy maturity; cumulative E preserved; normal claims and transfers unaffected |
| Wallet-scoped executor | Implemented, review pending | Immutable caller, caller-funded input, fixed output/refund wallet, no arbitrary plans, separate E/S; unauthorized pull fails before funds move |
| H-01 global pooled-user isolation | **High, unresolved** | Original independent proof preserved unchanged; new mainnet proof consumes all mature pooled cap without victim funds; [limit and costs](H-01.md) |
| IMD market identity/history | Partial real evidence | PoolKey hash, pinned manager account/storage proof, actual metadata/depth/fees; initialization log retrieval was incomplete; no real 24h source history |
| Noncircular oracle implementation | Implemented, review pending | Consecutive canonical block proofs, 2h/24h windows, no unproven extrapolation, depth/divergence/freshness/gap checks, Chainlink ETH/USD |
| Production oracle security | **Blocked** | Observed market below screening floor; floor and long window do not bound sustained manipulation losses; current alternatives lack history or add signer trust |
| Activation | Fails closed on missing real evidence | Empty V4 source cannot activate; v3 creation code is rejected; source failures leave rights/claims/transfers independent |
| Full offline Solidity checks | Passed | Pinned solc0.8.26 build,329 full requested-seed tests and fmt check; exact results in `full-tests.txt`, `build-final.txt`, `fmt-check.txt` |
| Mainnet recorded-block rehearsal | Passed, scope limited | 27 tests: actual factory/manager/router/Permit2/Quoter paths at26203203 and26203856; proof anchor and round-trip costs; candidate price used for successful activation is explicitly synthetic |
| Frontend | Passed source checks | Typecheck, offline preview build and24 unit tests; mature/cumulative ledger distinguished; candidate writes disabled; gallery read-only |
| Browser/mobile | **Skipped** | Playwright unavailable (`browser.txt`); no browser/mobile success claimed |
| Protected admission checks | **Skipped** | No protected harness supplied (`protected.txt`); checker source unchanged; no substitute probe counted as admission |
| Prior checks/history | Preserved / verified | Legacy creation pins, recorded mainnet/Sepolia runtime evidence, dependency hashes and5 Python release tests; old historical reports retained, not promoted to current approval |
| Static analysis | Partial | Forge high/medium lint ran with warnings; not clean-audit evidence. Slither/Mythril not installed and not claimed run |
| Final independent review | **Pending** | No independent reviewer assessed this final change set. Prior separate review remains narrow and its High is unchanged |
| Public commit / stage1 / stage2 / hosting | **Not performed** | Uploader publishes files/assigns commit. All transactions, real oracle operations, postflight and site publication require separate release authorization |

## Exact release blockers

1. Independently resolve/reassess High H-01 at the final source and preserve a reproducible attack result. This task authorizes mitigation engineering, not acceptance or severity reduction. Global per-beneficial-user identity conflicts with the preserved public router/smart-account interface; see the executable limit proof.
2. Establish a source with real, complete historical/current depth and independently justified **net** attack cost relative to realizable unlocked proceeds. The implemented proof source authenticates history but has no production-safe economics certificate. Its observed venue fails the fixed floor; the final sustained-manipulation regression deliberately demonstrates an unresolved threat. No deployment with this limitation is authorized.
3. Review the final RLP/trie verifier, exact storage layout, pool/fee policy, timestamp/rounding/reorg bounds, non-inclusion behavior, gas costs, proof gaps, restart/warm-up and activation integration. Conduct a separate adversarial assessment of the executor and hook's new timing rule. Bind that review to the uploaded exact commit and new creation commitments; `ImdReviewedCode` is a mechanical commitment name, not an audit endorsement.
4. Supply and run the actual protected admission harness and browser/mobile tests against the final artifact. No changes to the protected checks or compiler/dependencies are permitted to obtain a pass.
5. Before any stage1 broadcast, demonstrate an affordable continuously operating source/proof capture-and-submit path with actual history and identified gas sponsor. Near-head proof capture may be necessary because the provider prunes old proofs. These are public infrastructure/funding prerequisites, not missing values that block coding.
6. Separately authorize any public stages. A token-only launch without a usable source would strand hook trading before activation. Do not broadcast stage1 as a workaround for unresolved stage2 safety.

## Two-stage package and postflight responsibilities

The current [deployment specification](../DEPLOYMENT.md) and [source release plan](../release-plan.json) are the executable handoff, not a new launch manifest. `PrepareImd.preparePriceSource()` emits unsigned calldata for the fixed V4 source with no constructor parameters; `PrepareImd.run` derives companion deployment, tree certification and one-time activation from actual stage1 identities. `scripts/mainnet/mine.mjs` mines only a new launch's hook address from explicit real inputs. No future address/key/ID has been replaced by a stand-in.

The IMD launch operator must reverify policy and service code, choose the actual policy-supported opening price and assigned new number, preserve 10/87/3 and token sorting, and check CREATE2/initcode/permission bits before stage1. The setup authority must certify the real native claim tree, establish real oracle history/economic evidence, verify exact companions and seal only once. An oracle operator/gas sponsor must capture each block's proof while available, submit after64 confirmations before256, and alert on gaps/staleness. A separate milestone keeper follows4–5m cadence and valid-sample receipts. Only the immutable beneficiary withdraws its accounted IMD fees/donations. None of these actors gets a pause, upgrade, reset, fee setter, quota exemption or active-source replacement power.

Postflight must record the exact accepted commit, independent review, transaction receipts/finality, actual immutable runtime hashes, chain1/token identity/supply, initial allocations, key/ID/seed principal, source count/history/depth/gap behavior, certified root, sealed bindings, four-mode router/Permit2/Quoter simulations and fee claim conservation. It must verify both currencies' official LP entitlement separately from the IMD treasury. Claims/transfers must work during oracle outages. The optional executor gets its own review/real addresses and never moves direct-wallet rights. Browser/mobile checks and a separate publication approval are required before configuring or enabling any new site writes.

## Reproduction and evidence categories

Use the commands in the root README with seed `0x1d49232a44ff2493b73de50672c825b51c99d7c5f9f966576d2050bd2684d532`. Default Foundry tests are offline and do not read/set environment variables, use FFI or filesystem cheatcodes. Mainnet fixtures explicitly redirect the candidate source's price read to a synthetic model solely to exercise trading/milestone behavior. The production code has no such redirection. Full-history interval tests are synthetic; actual proof tests use recorded RPC bytes with a local blockhash anchor, and the fork separately checks the anchor against actual Ethereum blockhash state.

A final mainnet fork rerun uses `scripts/mainnet/fork.sh [RPC_URL]`, which copies only rehearsal tests into scratch and cleans them. No public write method is called. Some sandboxed Foundry transports ignore the working curl proxy path; this run used a temporary read-only relay to the task endpoint. Delivery provenance names the public source endpoint only. Initialization log errors and old-proof pruning are reported instead of invented history.

To fit the inherited8MiB upload gate, full bytecode export JSON is generated into `test/scratch/mainnet-artifacts/` (also reproducible from `out/`), not duplicated in the submitted source. ABI/templates/hashes remain delivered. The two prior Sourcify mainnet JSON records and the historical Sepolia router verification JSON are losslessly archived as `.json.xz`; `evidence-archives.json` records both compressed and original hashes, and the unchanged checks on decoded runtime/source content still run in `scripts/mainnet/verify.py`. Python's standard `lzma` reads them with no new dependency. The original bytes can be reconstructed exactly. All compiler configuration, dependency files, earlier source, protected checker code and live frontend files remain unchanged apart from the expressly updated candidate preview.
