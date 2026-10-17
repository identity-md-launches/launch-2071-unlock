# Validation record — 2026-10-13

> **Revision 2026-10-13.** The results below are the size-fix job's record. The revised build's results (208 delivered
> tests, protected suite, release gate, format check, recorded-block fork at 11906030) are in `REVISION_2026-10-13.md`
> and `../delivery/checks/revision-*.txt`. Foundry on the revising machine was 1.7.1.

These are implementation-author results, not an independent audit or deployment attestation. **No public
transaction was broadcast.** Release status and outstanding wallet operations are in `../RELEASE_STATUS.json`
and `DEPLOYMENT.md`.

## Reproduction

Run from the repository root. All contract dependencies are ordinary vendored files; the compiler is the
worker-installed **Solidity 0.8.26+commit.8a97fa7a**, not a repository binary. Foundry used here was **1.8.3**, commit
`cae51ad458f6abb64852b7709eb784352429825d`. Recovered `foundry.toml` and `remappings.txt` are retained: Cancun,
optimizer 200, metadata hash none, FFI disabled, no filesystem cheatcode permissions, local `lib/` only.

```sh
forge build
python3 scripts/generate_code_checks.py --check
forge test
python3 -B -m unittest discover -s test -p 'test_release_artifacts.py' -v
forge fmt --check
forge lint src --severity high med
python3 scripts/verify_network.py
python3 scripts/export_abis.py
python3 scripts/release_artifacts.py
sha256sum -c docs/SOURCE_SHA256SUMS
```

`scripts/check.sh` performs build, creation-hash checks, Solidity/Python tests, formatting, source lint, saved-network checks, ABI export and unconditional release size/digest checks.
The hashes in `ReviewedCode.sol` must match the four reviewed compiler creation bodies. A deliberate companion
or token source change requires review, rebuilding and regeneration; it cannot silently become an activation
candidate. There are no unresolved library links. `ARTIFACTS.json` distinguishes compiler runtime templates
from actual deployed runtime hashes, and records ABI digests and the digest of `SOURCE_SHA256SUMS`.

## Final results

| Check | Result | Raw evidence |
|---|---|---|
| `forge build` | PASS; pinned Solc 0.8.26 | `BUILD_RESULTS.txt` |
| `forge test` | **175 passed, 0 failed, 0 skipped**, 38 suites | `TEST_RESULTS.txt` |
| Alternate seed, four threads, minimal environment | **175 passed, 0 failed, 0 skipped** with PATH + existing HOME; PATH alone crashes in Foundry before tests | `MINIMAL_ENV_TEST_RESULTS.txt` |
| Python release size regression tests | **5 passed**; all six artifacts covered | `RELEASE_ARTIFACT_TEST_RESULTS.txt` |
| `forge fmt --check` | PASS, exit 0, no output | `FMT_RESULTS.txt` |
| `imd launch check .` | PASS locally; not service re-admission; Slither only on verifier | `IMD_LAUNCH_CHECK_RESULTS.txt` |
| Production bytecode comparison to published f77cf377 | Five production creation/runtime bodies identical; published hashes match | `BYTECODE_COMPARISON_RESULTS.txt` |
| Saved platform bytecode/source comparisons | PASS offline | `NETWORK_VERIFICATION_RESULTS.txt` |
| `forge lint src --severity high med` | Completed, warnings triaged below | `LINT_RESULTS.txt` |
| Historical supplied protected tests | Prior **11 passed**; input files not supplied this turn, not rerun | `PROTECTED_TEST_RESULTS.txt` |
| Historical Sepolia fork, both stages and trading | Prior **1 passed**; not rerun this turn | `FORK_RESULTS.txt` |
| Sustained manipulation and maximum tree gas | Included in the full suite; earlier detailed measurements retained | `ECONOMICS_RESULTS.txt` |

The 175 tests comprise all 170 existing tests plus five new encoder regressions. The protected suite is separate;
its historical copies were removed from `test/scratch`. None of its checks were weakened. The default test suite
never forks or reads environment variables. The alternate run used `forge test --threads 4 --fuzz-seed 0x20261013`
with only PATH and the existing HOME in a child process. A first PATH-only attempt panicked in the installed
Foundry/SVM (`could not detect user home directory`) before any test executed; both attempts are recorded.
Default fuzz runs are 256; individual tests/invariants retain their existing run/depth overrides.

Build warnings concern `afterInitialize`'s possible view mutability and deliberate forced-ETH `selfdestruct` test
fixtures. Source lint reports 30 warnings: 22 checked/range-bounded casts, three default-zero locals, two
deliberate settlement-balance equalities, two generic reentrancy notices and one signed floor-division precision
notice. The reasoning and guarded external-call paths are in `SECURITY_REVIEW.md`. No Slither, Mythril, formal
verification or independent contributor review was performed on this fix. The old launch record's passed review
applies to the published base, not this new submission.

`test/HookDeployer.t.sol` deploys the helper, checks its actual runtime against 24576, pins the reviewed hook
creation hash, compares the encoded four addresses and hash, and detects changed setup authority/creation code.
`test/test_release_artifacts.py` runs the release script against isolated artifact copies, rejects oversized
runtime and initcode for every release artifact (including the helper), counts constructor arguments, and covers
exact size boundaries. The full production bytecode and ABI comparison is reproducible in `SIZE_FIX.md`.

## Coverage that matters

* Standard supply, metadata and transfers; factory-only initialization and exact hook permission flags.
* Stage-1 pool binding/seed, ordinary transfers/native claims before activation, and rejection of early
  swaps, credit synchronization and milestones.
* Actual reviewed creation-code provenance, malicious constructor/runtime rejection, owner-only one-time staging,
  wrong launch/pool/dependency rejection, certified complete reward roots and atomic activation rollback.
* Authentic router/trader context, spoofing, replay, direct-manager bypass, exact input/output and partial fills,
  executed E/S accounting, transfer-only wallets, deduplication and monotonic earned rights.
* Native claims before activation, duplicate recipients, incomplete trees, real multi-leaf proofs, later funded
  reward rounds without arbitrary cumulative ceilings, sweep/lock timing and claims independent of credit sync.
* Token-only seed with no ETH top-up, principal protection, 80/20 fee payouts, native refunds, rejecting recipients,
  reentrancy attempts and router balance/credit solvency.
* TWAP arithmetic against brute-force integration, full warm-up, stale/future/incoherent feed data, observed depth
  dips, invalid intervals, cadence/gaps, sequential thresholds, the separate final delay and irreversible unlock.
* The $100K tier reachable below 10 ETH actual reserves, and the sustained 56-hour manipulation, fee-recapture and
  counter-selling paths. Successful attack simulation is disclosed risk, not an audit pass.

The 1024-leaf sorted certificate consumed **13,943,571 execution gas** in its direct-call measurement; the test
asserts less than 16,000,000, leaving room for normal transaction/calldata overhead below a 16,777,216 cap. Larger
trees use the chunked session path (`ActivationRobustness.t.sol:ChunkedCertificationTest`, 1500 leaves in three
submissions and two reductions). A duplicate-recipient frozen tree is a preflight incompatibility, so stage 1 must
not be broadcast with it.

## Deployment sizes

| Contract | Creation body bytes | Constructor bytes | Full initcode bytes | Runtime template bytes |
|---|---:|---:|---:|---:|
| UnlkToken | 3444 | 0 | 3444 | 2320 |
| UnlkHook | 25702 | 128 | 25830 | 24328 |
| UnlkSwapRouter | 8102 | 64 | 8166 | 7761 |
| MerkleClaimEvidence | 5943 | 64 | 6007 | 5675 |
| UnlkOracle | 7857 | 96 | 7953 | 7517 |
| HookDeployer | 756 | 0 | 756 | 728 |

Every release runtime, including `HookDeployer`, is below 24,576 bytes (`UnlkHook` retains 248 bytes of margin).
Full initcode includes each artifact's constructor arguments and fits 49,152 bytes. The old helper's 26292/26264
sizes caused real service rejection; its former exemption was incorrect and has been removed. The helper now
accepts the reviewed creation code from its caller and remains a pure encoder, never a production factory.
No oversized artifact is excluded or hidden. All five production bytecodes and ABIs are unchanged from f77cf377.
Twenty ABIs are exported, including the verified platform factory, registry, fees and distributor.

## Repeating checks that use external inputs

```sh
# Only while the supplied protected inputs are present; the script copies them unchanged into scratch.
python3 scripts/check_protected.py

# Optional read-only network checks; no signatures and no broadcast.
python3 scripts/verify_network.py --rpc https://ethereum-sepolia-rpc.publicnode.com
scripts/rehearse-sepolia.sh https://ethereum-sepolia-rpc.publicnode.com
```

The fork is pinned to block **11904506**, hash
`0xf3867dcdde6c437c3297aa05a7e56c1e5c6c63490989ee69d9f69e21e941d87c`. It uses actual factory/registry/fees/manager/feed
code and the actual authorized signer identities, impersonated only inside Foundry. Synthetic launch number and
reward leaf are clearly labelled rehearsal inputs. Simulated output addresses are printed only as **FORK ONLY**.
A fresh read-only call to the public RPC endpoint in this continuation returned HTTP 403 Forbidden. The saved
fork evidence above is historical, not a new run. No real UNLK address, transaction hash, PoolId or source-verification
receipt exists. The base is published as f77cf377; the fixed commit is still a publisher output after acceptance.
The supported local `imd launch check .` passed, but the parked launch's service admission was not rerun.
See `SIZE_FIX.md` for the observed public API limitations and remaining release operations.
