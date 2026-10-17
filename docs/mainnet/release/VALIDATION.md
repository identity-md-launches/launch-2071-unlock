> Imported release history for the previous source. Current admission repair, verification results and release responsibilities are in [../../admission-fix/REPORT.md](../../admission-fix/REPORT.md) and [STATUS.json](STATUS.json).

# Validation of the mainnet adaptation

The repository's Foundry configuration and vendored dependencies are unchanged. These are contributor check results, not independent platform admission. All new-launch identities, funding and allocations used in local tests are explicitly synthetic. No test impersonation, storage override or local CREATE2 salt is a mainnet release input.

## Completed checks

| Check | Result | Evidence |
| --- | --- | --- |
| `forge build` | Passed, Solc0.8.26; existing compiler warnings only | `checks/forge-build.txt` |
| `FOUNDRY_FUZZ_SEED=0xa9a85f3e917f851909cc56d729dafbccc481a7a8bd1cc34be8bf4db901b32cb0 forge test` |439 passed,0 failed,0 skipped; includes one independent scratch math-vector test | `checks/forge-test-all.txt` |
| Submission-path suite, excluding discarded scratch scaffolding | 438 passed,0 failed,0 skipped across82 suites | same required seed, `--no-match-path 'test/scratch/**'` |
| `bash scripts/unlock-gates/fork.sh https://eth.drpc.org --no-storage-caching` |102 passed,0 failed,0 skipped across4 suites | `checks/recorded-block-fork.txt` |
| `python3 scripts/mainnet/artifacts.py --check` | All creation commitments, link checks and size checks passed; ABIs/artifacts refreshed | `checks/artifacts.txt`, `../ARTIFACTS.json` |
| `python3 scripts/mainnet/check-manifest.py` | Correct token/hook constructor ABI, IMD pool and ten permissions | `checks/manifest.txt` |
| Python manifest regressions |3 passed; historical manifest and mutated launch inputs rejected | `checks/python-manifest.txt` |
| Existing release-size regressions |5 passed | `checks/python-artifacts.txt` |
| `python3 scripts/mainnet/verify.py` | Historical archives, nine runtime hashes and recorded source/policy evidence preserved | `checks/archived-runtime.txt` |
| Supported repository import / actual request check | Correct pinned commit; actual paid body accepted with no blockers | `network/import-response.json`, `network/actual-request-check-response.json` |

Python commands use `python3 -B -m unittest discover -s test -p 'test_mainnet_manifest.py' -v` and the same discovery command with `test_release_artifacts.py`. An initial module-style invocation failed to import this non-package test directory; discovery completed successfully. An intermediate build with the old oracle commitment caused setup failures before regeneration; the final commitment and all final suites pass. Neither intermediate attempt is represented as release evidence.

The full suite includes20 protocol-fee regressions across both currency orders (inherited four-mode/quoter/claim tests plus directional-fee fuzz and controller changes),10 owner-envelope tests covering2- and1025-recipient trees,12 stage1-planner tests across both orders, current-source tests, gate/quota properties, historical Sepolia tests and invariant campaigns. Fuzz tests use the mandated seed; configured run counts remain unchanged, normally256 and128 in existing bounded property suites.

## Recorded-block rehearsal and limits

Block26210931, hash `0x46fed6862c03072f4455212eccafbca631f5be88bc34b33ca00d4244a690129c`, chain1. Actual recorded factory, registry, fees, PoolManager, Universal Router, Quoter, Permit2, IMD, IMD/ETH pool and Chainlink contracts are used. The observed current IMD/USD is5.771173587071780191. Both currency orderings are exercised by mining local salts against this final build's initcode.

The strict wallet builder's generated source, companion and certification calls execute against the recorded state, and its final activation calldata is checked against the immediate owner activation call. Activation stays in the recorded block with no source price mock, elapsed warm-up or observation history. The native distributor, enforcing official hook and locked seed are created by the actual factory code, with synthetic local launch number, publisher/verifier record, two-recipient full100M tree, owner/payer identities and token funding. The factory deployer and owner are impersonated locally only.

The suites cover standard-router exact-input/output buys and sells, rollback/quota failures, fee-inclusive quoting, permit/batch behavior, native claims independent of synchronization, treasury redemption and principal protection. A new test impersonates the **actual recorded protocol-fee controller locally** and changes the official pool to maximum directional protocol fees through core's real setter; trades, spot reads and locked principal remain valid. It does not claim governance changed a public pool.

Inherited gate-boundary cases substitute synthetic reference/pool states after activation to exercise exact thresholds; these are not actual market touches. Tests that advance time renew feed timestamps with the recorded answer. Native contributor-lock maturity after activation is distinct from price-source readiness. No live funded buy/sell, claim or treasury transaction is claimed. The actual release still needs a fresh rehearsal using its real assigned identities, full native tree and attestation before stage1 broadcast.

## Deployment bytecode sizes

All runtimes are below24,576 bytes and initcode **including constructor arguments** below49,152 bytes. No unresolved external-library links. Hook flags remain0x3fcc, requiring a new salt with the actual predicted token and final code.

| Contract | Runtime bytes | Initcode bytes including arguments |
| --- | ---: | ---: |
| UnlkToken |2320|3444|
| UnlkImdHook |20957|22284|
| ImdSpotUsdSource |3180|3208|
| MerkleClaimEvidence |5675|6007|
| UnlkImdOracle |6996|7467|
| ImdFeeVault |4196|4735|
| ImdSetupVerifier |7235|7263|
| Factory-native MerkleDistributor |4145|4632|
| Optional WalletExecutor (not automatically deployed) |4576|4944|

`native-distributor-artifact.json` derives the native distributor from the pinned factory's embedded creation body; the actual factory getter/CREATE2 prediction is exercised by the fork tests. Other artifacts are in `../ARTIFACTS.json`, deployment ABIs in `../abi/`, and read-only preparation ABIs in `abi/`. Template runtime hashes need actual immutable resolution before deployed-code verification. Preparation scripts are local tools and are not launch-deployed contracts.

## Missing or deferred checks

- **Protected admission not run:** supplied `.imd/reads/protected/univ4_hook/Hook.protected.t.sol` and `Token.protected.t.sol` are absent. `protected-admission.txt` records the exact missing operation. No replacement test is presented as protected admission. The platform must provide/run its own harness and exact-commit policy checks.
- Required four-specialist platform panel, judge and final manifest acceptance are waiting on this adaptation. Supplemental reviews are recorded in `REVIEW.md`; they do not replace that panel.
- Publication, real release salt/launch identity/tree/attestation, stage1/stage2 receipts, actual new contract explorer verification and sealed-setup postflight are pending platform/owner operations. No new public deployment address or PoolId is fabricated.
- Slither, Mythril and external audit certification were not run. No browser/mobile/website publication checks were attempted because this task excludes website publication.
- Final source formatting is handled by the submission process. Protected build files/dependencies, historical Sepolia contracts/configuration and website files remain byte-identical to the imported source; `preservation.json` records the comparison.

The accepted manipulation and mature shared-executor risks remain disclosed/tested. Tests prove the stated implementation behavior within their fixtures; they do not prove economic resistance or authorize release.
