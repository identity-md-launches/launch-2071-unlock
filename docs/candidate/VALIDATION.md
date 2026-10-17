# Candidate validation record — 2026-10-15

The final source is **undeployed**. All results below were observed locally; they are not an independent audit or release approval. Historical reports outside this directory describe older artifacts. The standard-router design blocker remains despite passing implementation tests.

The subsequent [source-upload size repair](BUNDLE_SIZE.md) preserves all contracts and frontend exports, trims unused tool files, and losslessly compresses compiler payloads for automatic offline preparation. Its repeat checks passed 242 Foundry tests and 20 frontend tests; the full-source archive estimate is below 8 MiB. Separate repair logs distinguish these runs from the earlier fork/browser/protected-check evidence below.

## Final checks

| Check | Observed result | Evidence |
| --- | --- | --- |
| Clean `forge build` | Pass, Solidity 0.8.26; 155 files compiled | [build-results.txt](build-results.txt) |
| `forge test --fuzz-seed 0x1fb1bda21a2a44ee9da3a358da09a0668c5135bb35baa2d687f3bfba01fc2fde` | **242 passed, 0 failed, 0 skipped**, 52 suites | [all-tests.txt](all-tests.txt) |
| `forge fmt --check` | Pass (no output) | [fmt-results.txt](fmt-results.txt) |
| Historical and candidate creation pins | Both check scripts pass | `scripts/generate_code_checks.py --check`, `scripts/candidate/pin.py --check` |
| `forge build --sizes --skip test --skip script` | All deployable contracts within EIP-170/EIP-3860 | [sizes.txt](sizes.txt), [ARTIFACTS.json](ARTIFACTS.json) |
| Candidate ABI/size/link/constructor export | Eight production artifacts pass | `scripts/candidate/artifacts.py`, `abi/` |
| Unmodified supplied Hook/Token protected checks | **11 passed**, 0 failed, 0 skipped | [protected-results.txt](protected-results.txt) |
| Supplied Owners protected check | **Not run**: absent OwnerChecks.sol and Swapper.sol harness dependencies | See limitations below |
| Historical artifact gate | **5 passed**; checks real artifacts and intentional limit violations | [release-gate-tests.txt](release-gate-tests.txt) |
| Real-router recorded-block fork + real-factory candidate rehearsal | **7 passed**, 0 failed, 0 skipped, Sepolia block11918468 | [fork-results.txt](fork-results.txt) |
| Current public code verification | Router/Quoter/manager/Permit2 match recorded runtimes; observed head11920088 | [network/current-code-check.json](network/current-code-check.json) |
| Vendored dependency integrity | **1996 ordinary files** match SHA-256 inventory after upload-size repair | [DEPENDENCIES.json](DEPENDENCIES.json), [BUNDLE_SIZE.md](BUNDLE_SIZE.md) |
| Original sealed source/config/manifest preservation | **15 files match** the requested source archive | [../provenance/sealed-source.json](../provenance/sealed-source.json) |
| Offline TypeScript application/test check | Pass, TypeScript5.9.2 | [frontend-types.txt](frontend-types.txt) |
| Offline frontend production build | Pass, emits dist-candidate/ with local assets | [frontend-build.txt](frontend-build.txt) |
| Frontend unit/failure tests | **20 passed**, 0 failed/skipped | [frontend-tests.txt](frontend-tests.txt) |
| Foundry high/medium lint | Completed with warnings; author triage recorded, not claimed clean | [lint-results.txt](lint-results.txt), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) |

All Foundry fuzz properties use 256 cases unless a test declares its own invariant configuration. Candidate sequence invariants use 96 runs × 60 calls per invariant with the supplied seed. The handler has a separate test proving meaningful buys, sells, claims, donation handling and rejection paths execute; caught failures are tracked with ghost violation counters. These are deterministic local EVM tests, not sustained wall-clock simulations. No test waits 114 hours in real time.

## Coverage and interpretation

The candidate unit suites cover all four ETH fee modes, buy/sell partial fills and refunds, exact-output partial rollback, strict output bounds, slippage/over-quota rollback, fresh token-only zero-ETH manager settlement, vault accrual/redeem/withdraw invariants, beneficiary rejection/reentry, direct and donated claims, nested redemption failure, and fee exclusions on non-swap actions. Rounding is fuzzed and checked against executed swaps. Quoter tests execute the recorded deployed bytecode for exact-input/output price simulation, state rollback, generic sell-price versus wallet capacity, wrong code, and direct callback/internal-function attacks. Standard Universal Router rejection by the candidate is explicitly tested, not hidden.

Tier tests cover every threshold, the initial20% rate, all sixteen sequential confirmations, final24h, permanent zero-E holder bypass and continuing fees, cadence/gaps/invalid data, pre-activation claims and payer transfers, setup/activation and direct bypasses. Adversarial tests cover each companion creation pin, router prefunding, sequential batches, replay and callbacks. Sequence invariants cover executed E/S, quota, monotonic rights, supply, native refund solvency, manager-claim backing, protected principal and sealed configuration.

Recorded-runtime tests execute captured real Universal Router, Quoter, PoolManager and Permit2 bytecode offline with a local diagnostic pool. They cover TAKE_ALL versus arbitrary TAKE, identical-state Permit2 versus router-funded settlement, smart wallets, batches, multihop and quote rollback. The separate historical fork verifies those same runtime hashes and executes against actual historical chain storage. The real-factory rehearsal uses the actual factory/registry/distributor/fees/manager/feed code to exercise stage1, stage2, pre-activation claim, trading, sync, LP collection, vault redemption and beneficiary withdrawal. Rehearsal addresses and test launch numbers are **local simulation outputs only**; none is a release parameter or on-chain deployment claim.

Frontend tests cover exact BigInt fee/quota math, all tiers, absent candidate configuration, wrong chain/hash/bindings or inconsistent ledgers, separate donations, unavailable FDV, ownership filtering against a stale index, duplicate/invalid IDs, cancellation, stale snapshots, cursor validation, HTTP/size failures, executable URLs and unsafe SVG/JSON. Actual on-chain tokenURI data for #1116 and #1181 is tested as inert image blobs offline. Mainnet ownerOf/tokenURI/balance reads were recorded at block26197406; they are historical evidence, not a claim those NFTs will remain held. The live gallery rechecks ownership at a displayed mainnet block.

## Reproduce

The individual final checks above were run. `scripts/candidate/check.sh` composes the offline build, pin, test, format, size, ABI, type and frontend checks for future reruns. It reads no host configuration. The original network-oriented scripts are historical and are not prerequisites for the candidate offline verifier.

```sh
bash scripts/candidate/check.sh
# Optional read-only archive-RPC reproduction, never a broadcast:
bash scripts/candidate/fork.sh
# Optional, while the supplied protected input files are present:
python3 scripts/candidate/check-protected.py
```

The protected runner copies the two inputs unchanged into scratch and supplies deterministic **synthetic test probe** constructor values, not deployment addresses. It does not modify the protected definitions or claim the missing Owners harness passed. Tests under scratch are cleaned afterward and are not required by the default offline suite. The fork runner also cleans its scratch wrappers so default verification needs no RPC. Public endpoints used were ethereum-sepolia-rpc.publicnode.com and ethereum-rpc.publicnode.com; public Blockscout APIs were used for verified source and NFT discovery. No internal service or host configuration was inspected.

## Limitations, skips and blockers

- Standard-router actual-recipient/source attribution is a demonstrated incompatibility. Native-specified post-execution fee settlement also needs a design change for the standard router. Independent review is pending. Release remains blocked.
- Owners.protected.t.sol imports test/floor/OwnerChecks.sol and test/mocks/Swapper.sol, neither supplied in this repository. No stand-in definition or altered protected test was introduced. Independent local and real-factory tests check authenticated setup and zero-delta LP collection, but do not replace the missing protected result.
- The attempted browser render command returned `/bin/bash: line 1: chromium: command not found`. Browser screenshots, measured mobile overflow, accessibility scans, native-wallet signing and interactive browser failure scenarios are pending. Type/unit/build checks and source/CSS inspection are the actual frontend evidence here. Existing historical screenshots are not candidate screenshots.
- Build warnings include deprecated selfdestruct in historical donation test scaffolding, transient-storage guidance from v4, test mutability suggestions and candidate afterInitialize mutability. No production selfdestruct was added. Foundry lint warnings are retained and triaged without suppressing them. Slither/Mythril and an independent human review were not run.
- A blanket `forge build --sizes` includes the historical oversized LocalDemo script. The deployable-only command excludes tests/scripts; every production artifact is independently size checked including full constructor bytes. No production limit was raised or disabled.
- No GitHub commit, public deployment, signed transaction, website publication, NFT purchase or automated marketplace task was performed. Git metadata writes were forbidden. The contributor's upload/commit step and separately reviewed deployment/publication steps remain outstanding.
