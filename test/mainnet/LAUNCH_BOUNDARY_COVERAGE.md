# Contributor launch-boundary tests

This contribution adds tests to the accepted implementation. Production contracts, manifests,
dependencies and configuration are unchanged. It is a test submission, not a deployment receipt.

## Additional coverage

`SetupLifecycleInvariants.t.sol` exercises both UNLK/IMD currency orderings with a three-actor
handler. Each ordering runs 128 sequences of 64 actions, with unexpected reverts treated as
failures. The model starts with the actual factory launch and locked seed, before any companions
exist. It randomly interleaves source/bundle staging, certification, activation, obsolete-bundle
and unauthorized setup attempts, invalid references, time advancement, native claims, evidence
attestation, synchronization and transfers.

The properties are based on the request's guarantees:

- Only the latest certified bundle using the latest staged source can activate, once. Every failed
  setup checks the exact underlying revert and unchanged configuration, including staging counters.
- Abandoned oracles stay unbound. Attesting a real native claim in an abandoned adapter cannot
  credit the active hook. The active adapter can prove that same native delivery exactly once.
- Native claims and transfers remain independent of setup and current reference validity.
  Claim/allocation credits remain deduplicated and ordinary transfers never generate credits.
- Fixed supply, original allocation receipts, official pool binding and locked seed principal
  survive every sequence. Setup cannot accrue treasury trading revenue.
- At the end of every sequence, a valid latest bundle can complete setup if it has not already
  activated. Native claim delivery and both allocation/claim credit paths are then reconciled.
  This checks setup liveness after arbitrary failed attempts, as well as rejection of bad calls.

A deterministic sequence visits the stale-source, uncertified, invalid-price, obsolete-adapter,
unauthorized and repeated-activation failures, then executes a real recorded-router buy and sale.
The existing `SpotCustodyInvariants.t.sol` continues to cover trading, quotas, fees, treasury
solvency, withdrawals and permanent gates under random call sequences.

`RecordedLaunchBoundary.t.sol` adds six opt-in archive tests, three per currency ordering. They
skip explicitly in the default offline run. The rehearsal uses block **26,210,931**, hash
`0x46fed6862c03072f4455212eccafbca631f5be88bc34b33ca00d4244a690129c`, and verifies the recorded
factory, manager, registry, fees, IMD, router, Quoter, Permit2 and Chainlink proxy runtime hashes.
It exercises token-only seeding without companions, inactive trading rejection, zero-delta fee
collection, native claims/transfers before setup, same-block activation, router buys/sells and
IMD treasury claim redemption/withdrawal. Pool principal remains locked.

The fork uses the named address `0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9` for the simulated
launch's payer and setup authority, and checks it against the factory position, token allocation
receipt, hook and treasury. These are newly created **local fork records**, not assertions that
launch #2064 deployed. The imported previous payment/launch identity evidence remains in
`docs/admission-fix/network/owner-payer-verification.json`.

No service runtime or price read is mocked in the fork tests. The launch number, contributor tree,
deployer/owner impersonation and trader funding are simulation inputs. The production spot source
reads the recorded reference pool and Chainlink directly; no warm-up, historical sampling or feed
timestamp renewal is used. The independent-native-claim test advances only the distributor lock.

## Admission regression and scope

The current source already contains the accepted attestation-boundary fix. A scratch-only replay
restored the old `_verifyServices()` call before the pool binding write and reran the existing
initialization regression in both currency orderings. Both expected-success tests failed with:

```
WrappedError(hook, 0xdc98354e, 0x35be3ac8, 0xa9e35b2f)
```

The underlying revert is `InvalidConfig()` (`0x35be3ac8`) from `beforeInitialize`
(`0xdc98354e`), wrapped with `HookCallFailed()` (`0xa9e35b2f`). Chain ID was 1 and the sorted
key, factory callback sender, fee 12500, spacing 60 and permission flags matched. The local
constructor-bound factory does not satisfy the production factory-address/code attestation.
This is a controlled regression replay, not a newly discovered defect in the accepted source.
The deliberately failing scratch copy is not submitted or included in the final suite.

Unmodified supplied `Hook.protected.t.sol` and `Token.protected.t.sol` were also run locally
against the current creation code with explicit isolated probe inputs: **11 passed, 0 failed,
0 skipped**, including `test_initializesFromTheLaunchFactory`. This is local execution of the
supplied checks, not official attested admission. `Owners.protected.t.sol` could not run because
its platform `OwnerChecks.sol` and `Swapper.sol` dependencies were not supplied. No substitute
for those checks is presented as official admission.

No new implementation defect was established by these tests. The accepted shared-executor quota
pooling and same-transaction reference manipulation risks remain unchanged and are covered by
the existing suites; this contribution does not claim to mitigate them. Official admission,
release approval and public deployment are separate operations and are not asserted here.

## Reproduction

All local fuzz/invariant runs use:

```
FOUNDRY_FUZZ_SEED=0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd
```

```sh
forge build
FOUNDRY_FUZZ_SEED=0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd forge test
UNLK_RECORDED_MAINNET_FORK=true forge test --no-storage-caching --match-path test/mainnet/RecordedLaunchBoundary.t.sol -vv
```

The contributor run directed build/cache output into `test/scratch/` using `--out` and
`--cache-path`; those paths do not affect test behavior. No dependency installation or configuration
change is needed. The opt-in fork passed all six tests with no skips or failures. The baseline
before this contribution passed 479 tests across 94 suites. The final build passed; the final
offline run passed **483 tests across 98 suites, with zero failures and two skips**. Foundry
reports each opt-in fork contract's skipped `setUp` as one skip. Both new invariant campaigns
completed 8,192 random actions with zero unexpected reverts. Results are recorded in
`test/results/contributor-launch-boundary.txt`.
