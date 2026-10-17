# UNLK initialization admission repair

The imported hook's admission failure is reproduced and repaired. The only executable production changes move `_verifyServices()` from `beforeInitialize` to authenticated `deployPriceSource`. Companion staging and activation retain their existing full service attestation. [production.patch](production.patch) is the complete production diff; no token, fee, quota, claim or oracle logic changed.

This is implementation evidence for the existing mainnet launch job, not a deployment receipt. The final check results and unresolved release operations are in [STATUS.json](STATUS.json). No new mainnet address, salt, transaction or sealed activation is asserted.

The subsequent manifest check rejected `launch.json.notes` at 4,532 characters against its 4,000-character limit. The notes are now 3,757 characters; all other manifest fields and Solidity sources are unchanged. The offline manifest gate now enforces the limit, with ASCII/Unicode boundary and type regressions. The [manifest repair record](manifest-repair/REPORT.md) records fresh checks, supplemental independent review and refreshed manifest/artifact commitments.

## Source and request provenance

- Imported [launch-2064-unlock-symbol-unlk-review-adapt-and-depl](https://github.com/identity-md-launches/launch-2064-unlock-symbol-unlk-review-adapt-and-depl) at `b957a835f1cca9eef51a121851e2026fc17ff435`. GitHub's observed head matched the requested commit. All 2,766 permitted ordinary files were extracted; existing dependencies and historical Sepolia/candidate material were retained. The forbidden `.git/`, `.github/`, `.env` and `node_modules/` paths were excluded. No submodule was created.
- [import-history.json](import-history.json) records the accepted parent history. [imported-file-hashes.json](imported-file-hashes.json) records every imported ordinary file and the source archive hash. The working repository's Git metadata was not modified. Publication must retain the requested source ancestry through the platform's supported import/delivery process.
- The supported `/requests/import` returned HTTP 200 and the exact requested commit: [request](network/import-request.json), [response](network/import-response.json). The structured `launch.open` body explicitly binds `repoUrl`, `baseCommit`, chain 1, IMD, poolBps 8700 and the named owner; its [check response](network/launch-open-check-response.json) has no blockers. This validates the prepared request; it does not amend a running job or submit another paid launch.
- The live [current job record](network/current-job.json), job `563ad4ec-93f8-46fd-b6b0-2182f4a7509e`, confirms an executing Ethereum `univ4_hook` launch paid by the named wallet. Its public project record reports bootstrap base `0243d7da4a4337ae8b16bcdf15bb4ead736fd68f`, rather than the requested import commit, and its launch ID is not assigned. The source-binding discrepancy must be reconciled by the platform before publication; no supported mutation of the active request was exposed to this implementation worker.
- The prior [launch #2064 record](network/launch.json) confirms the requested source commit and the exact `protected_invariants / invariants-1088d95c9ece` failure. It remains parked with no deployed artifacts. Its previous panel/admission results concern that old source, not this repaired bytecode.

## Proven revert and boundary fix

The supplied Hook protected test reconstructs a working PoolManager at the resolved constructor address, installs a generic ERC-20 at the IMD address, deploys the actual launch token at its probe, mines the hook's `0x3fcc` permission bits and calls initialization as the resolved factory. It deliberately does not reconstruct production factory/router/Permit2/fee/registry code and getters. A locally built PoolManager and generic paired token also differ from the production runtime pins.

The original hook accepted the callback caller, factory sender and PoolKey checks, then reverted in `_verifyServices()`. The [before-fix trace](initialization-before-fix.txt) records both currency orders failing with:

```
WrappedError(hook, 0xdc98354e, 0x35be3ac8, 0xa9e35b2f)
```

`0xdc98354e` is `beforeInitialize`; `0x35be3ac8` is `InvalidConfig()`; `0xa9e35b2f` is `HookCallFailed()`. The fresh-manager reproduction uses chain 1, so this is not explained merely by Foundry's default chain. In that reproduction the first failing identity is the factory-address requirement; other missing/different service runtimes independently fail the same attestation. The protected floor's generic catch message alone was not treated as proof. Running the unmodified supplied Hook/Token files on the original compiled hook separately reproduced the generic admission failure: [10 passes, 1 failure](protected-before-fix.txt).

The fixed initialization still requires:

1. `msg.sender == poolManager` and `sender == launchFactory`, both constructor-bound.
2. An unbound hook, its own hook address, numerically sorted exact UNLK/IMD currencies, fee 12500 and tick spacing 60.
3. Matching immutable address permission flags, validated in the constructor, and one-time PoolId binding.

Seed callbacks remain independent of companions and price references. They authenticate the factory, require the exact bound key, validate the one-sided opening boundary and 87% principal band/depth, and retain locked principal. Zero-liquidity-delta collection is allowed before and after activation without a hook liquidity delta.

Full unchanged attestation now runs at every setup entry: `deployPriceSource`, `deployCompanions` via `_verifyLaunch`, and `configureAndActivate` via `_verifyLaunch`. It requires mainnet chain/address/runtime identities, factory getters, 18-decimal IMD and router/Quoter/Permit2 pins. There is no alternate-chain, test-address, absent-code or getter bypass. Source creation fails before its counter or address changes; companion creation and activation failures roll back all state atomically. Activation additionally requires the actual factory/registry record, allocation receipts, locked seed position, pinned companions, certified round 0 and valid current spot reference. It permanently seals setup.

Before activation, swaps, payer/reward credit synchronization and milestone advancement remain disabled. The ERC-20 and native distributor never call the hook for ordinary transfers or eligible claims, so they remain available. Invalid price references after activation only prevent new gates.

## Reproduction and independent review

The project retains Solidity 0.8.26, Cancun, optimizer 200, `bytecode_hash = "none"`, disabled FFI and no filesystem permissions. Dependencies are ordinary vendored files. The required fuzz seed is `0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd`.

```sh
forge build
forge test --fuzz-seed 0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd
forge fmt --check
python3 scripts/mainnet/artifacts.py --check
python3 test/test_mainnet_manifest.py
python3 test/test_release_artifacts.py
python3 scripts/check_protected.py
bash scripts/mainnet/rehearse-admission.sh https://eth.drpc.org
```

Initial repair checks: `forge build` passed; **479 tests across 94 suites passed, zero failed/skipped**, with the required seed; `forge fmt --check` passed; 8 Python release/manifest regressions passed. [Build](build.txt), [full test log](full-suite.txt), [format](format.txt), [Python](python-tests.txt), [artifact checks](artifacts.txt) and [manifest validation](manifest.txt) preserve the outputs. The hook runtime is **20,957 bytes** (EIP-170 limit 24,576); creation code plus four constructor words is **22,284 bytes** (EIP-3860 limit 49,152). All reviewed companion sizes and unlinked-code checks pass. [Final artifact commitments](release-artifacts.json) distinguish runtime templates from immutable-resolved deployed bytecode; no deployed-runtime hash is fabricated.

The protected runner needs the supplied `.imd/reads` inputs, which the assignment removes from the final delivery. It copies their bytes unchanged into disposable scratch space and supplies explicit isolated test probes. Its Hook/Token execution is a **local run of actual supplied checks**, not the platform's official attested admission. `Owners.protected.t.sol` is not executed because its `test/floor/OwnerChecks.sol` and `test/mocks/Swapper.sol` platform dependencies were not supplied. No replacement helper or relaxed protected check is presented as official. Local and recorded-factory tests independently cover setup authority, seeding, collection and principal protection.

Durable new tests:

- [InitializationAdmission.t.sol](../../test/mainnet/InitializationAdmission.t.sol): both currency orders, real fresh-manager initialization, wrong callback caller/factory, wrong currencies/order/fee/spacing/hook, repeated binding, seed with no companions, zero-delta collection, principal-removal refusal, inactive swaps/credits/gates and unrestricted transfers.
- [ServiceAttestation.t.sol](../../test/mainnet/ServiceAttestation.t.sol): independently corrupt all eight service runtime identities at all three setup entries; wrong chain; wrong factory getters or IMD decimals despite unchanged runtime; atomic rollback and successful recovery.

The [independent contributor review](INDEPENDENT_REVIEW.md) used a separate agent, added the service matrix, and independently executed 32 targeted tests with no failures/skips. This review does not stand in for the platform's specialist panel and judge. The broad unchanged suite covers router buys/sells, exact-input/output fee accounting, quota boundaries/maturity, claim/allocation deduplication, native claims, treasury custody, liquidity protection, reference failures and all permanent gates.

The recorded-block fork passed 102 tests using the actual factory, manager, registry, fees, router, Quoter, Permit2, IMD, IMD/ETH pool and Chainlink at block **26,210,931**, hash `0x46fed6862c03072f4455212eccafbca631f5be88bc34b33ca00d4244a690129c`. [Fresh preflight](network/mainnet/preflight.json) rechecks all runtime pins and service getters. The spot source activates in the same setup block from the actual reference price; no sample history or warm-up is manufactured. The [rehearsal log](mainnet-fork.txt) records 102 passes and zero failures/skips.

Fork launch numbers, tree recipients, funding and deployer/owner impersonation are expressly local fixtures. CREATE2 is re-mined for this bytecode in both sort orders. After activation, inherited boundary tests intentionally substitute price fixtures or renew feed timestamps to isolate scenarios. These facts do not establish actual release allocations, wallet signatures, a publishable salt or successful public transactions.

## Preserved economics and operational responsibilities

| Parameter | Value |
| --- | --- |
| Token | UNLOCK / UNLK; 18 decimals; exactly 1 billion, minted once to factory |
| Allocation | 10% native swarm distributor / 87% official pool / 3% payer; seed rounding remainder goes to payer |
| Owner, intended payer, treasury beneficiary | `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9` |
| Chain / pair | Ethereum 1 / IMD `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| Constructor arguments | `$poolManager`, `$token`, `$factory`, `$owner`, in that order |
| Pool | Sorted token/IMD; fee 12500; spacing 60; flags `0x3fcc` |
| Opening price | Factory derives token-only opening from policy's 2500 IMD whole-supply cap; manifest's nominal 1:1 value is not the seed boundary |
| Treasury | 75 bps of executed IMD leg, accounted as IMD manager claims; manual NFT purchases; no automatic purchase/listing/burn |
| Initial quota | `max(0, floor(matureE * 2000 / 10000) - S)`; buys mature after their block |

The [identity proof](network/owner-payer-verification.json) re-reads the successful previous Intake transaction and matches its decoded owner/remainder to its sender and live launch/job records. The current job's `paidBy` matches too. This does not imply this worker can sign for the owner.

LP fees remain 1.25%, split 80% payer / 20% network on actual collections (nominally 1% / 0.25% at zero core protocol fee). The hook's 0.75% uses executed IMD, with specified-mode rounding differing by at most one raw IMD unit. Ignoring price impact and rounding, buy fees are `2% / 1.0075 = 1.98511166%` of total IMD paid. A fee-only sell comparison at a fixed price is `1 - (1 - 0.0125)*(1 - 0.0075) = 1.990625%`; the LP input fee is in UNLK and the treasury fee is in output IMD. An exact flat 2% would be misleading. Actual prices/impact and core protocol fees change effective totals. With core protocol rate `q` in pips, core uses `F = q + 12500 - floor(q*12500/1000000)`; the analogous buy estimate is `(F + 7500)/1007500`, and sell estimate is `1 - (1 - F/1000000)*0.9925`. External protocol fees do not pause trading or gates.

Initial 20%; USD FDV gates remain 100K:25%, 250K:30%, 500K:35%, 1M:40%, 2M:45%, 3.5M:50%, 5M:55%, 7.5M:60%, 10M:65%, 15M:70%, 20M:75%, 25M:80%, 30M:85%, 35M:90%, 40M:95%. A valid observed touch opens the highest crossed gate permanently; at 50M quotas are permanently bypassed for every holder, including transfer-only recipients. For E=1000 and S=200 at 20%, reaching 30% permits only 100 more. Transfers create no quota rights. Standard Universal Router initiator attribution and one-block buy maturity are unchanged.

Price remains official UNLK/IMD spot × verified IMD/native-ETH spot × validated Chainlink ETH/USD through stateless `ImdSpotUsdSource`. Shared-executor pooling and manipulation of either pool, including same-transaction external-reference manipulation causing permanent early unlock, remain accepted, tested risks. There is no upgrade, pause, reset, exemption or later rule-change power.

The platform must accept/publish this repair, reconcile the source binding, run final official admission and its panel/judge, and supply the real launch identity, native round-0 tree and attestation. The current job lists those steps as waiting on this implementation. The release service alone controls the authenticated launch factory. Before stage 1 it must mine the final salt against actual constructor values and rehearse actual allocations and owner transactions. No existing Sepolia address or simulation value may substitute.

The named owner then uses the preserved [PrepareOwnerTransactions](../../script/mainnet/PrepareOwnerTransactions.s.sol) builder to stage the exact price source, deploy the reviewed companions, certify the actual native tree and call `configureAndActivate`. Current service identities and valid current price are required; there is no time-based price wait. Prepare an executable owner-signing path before broadcasting stage 1. Stage 1 alone leaves trading inactive. Public receipts, resolved runtime comparisons, explorer verification, actual PoolKey/PoolId and sealed setup evidence are required to claim deployment completion. This worker has no platform release/signing capability and has not broadcast a transaction.
