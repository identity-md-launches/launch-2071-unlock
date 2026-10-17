# Independent contributor review — initialization admission fix

This review was performed by a separate contributor agent from the implementing agent. It covers the narrow admission repair and the initialization → seed → setup → activation boundary, with supporting review of the unchanged quota, fee, claim and oracle paths. It is a local source review and local adversarial execution, not the platform's official protected admission, specialist panel, signed attestation or proof of a public mainnet deployment.

## Confirmed admission failure and repair

The supplied protected initialization test uses a genuine fresh PoolManager at the constructor-resolved manager address, a generic ERC-20 at the required paired IMD address, the constructor-resolved launch token and the factory probe as `initialize` caller. Those inputs intentionally do not reproduce the production service runtime hashes or every external service getter.

The imported `beforeInitialize` called `_verifyServices` before writing its one-time pool binding. That function requires chain 1, the canonical factory/manager addresses, all pinned service code hashes, factory `fees()` / `registry()` getters and 18-decimal IMD. Consequently the correctly authenticated, correctly sorted launch pool failed in the admission environment. The implementation agent's before-fix reproduction records the actual error in both currency orders in [initialization-before-fix.txt](initialization-before-fix.txt):

`WrappedError(hook, 0xdc98354e, 0x35be3ac8, 0xa9e35b2f)`

Here `0xdc98354e` is the `beforeInitialize` callback, `0x35be3ac8` is `InvalidConfig()` and `0xa9e35b2f` is `HookCallFailed()`. This supports the environmental attestation diagnosis; the protected harness's generic catch message alone would not.

The final production patch removes that call from `beforeInitialize` and adds the unchanged `_verifyServices` call to `deployPriceSource`, after setup-authority/sealed/code checks and before any source creation. Existing `_verifyLaunch` enforcement remains on companion staging and activation. There is no test-address, alternate-chain, missing-code or absent-getter exception.

## Boundary assessment

- Every hook callback still requires its immutable PoolManager. Initialization additionally requires the constructor-bound factory, unbound state, exact hook address, sorted UNLK/IMD currencies, fee 12500 and spacing 60. Constructor permission validation and flags `0x3fcc` are unchanged.
- Seed admission is independent of companions. Only the authenticated factory may add official liquidity; the first position must be one-sided at the appropriate opening boundary and within the principal/depth bounds. Failed core liquidity modification rolls back the recorded seed. Fee collection at zero liquidity delta is allowed before activation; nonzero principal removal remains rejected.
- All successful setup entry paths enforce production service identity. Source staging authenticates the caller and exact creation code. Companion staging and activation also verify the registry record, factory position, token CREATE2 identity, original allocation receipts and seed principal. Restaging cannot make an old source or companion eligible for activation because the current staged addresses, runtime hashes and oracle/feed bindings are checked.
- Failed setup calls revert creation, counters and bindings together. Activation requires valid current reference pricing and certified claim evidence, then binds the exact reviewed oracle and seals setup. Subsequent source/companion/activation calls cannot reopen configuration.
- An initialized but inactive pool cannot swap, synchronize payer/reward quota credits or advance gates. Ordinary ERC-20 transfers and the distributor's native claims have no dependency on activation.
- The patch does not edit trade accounting, fee math, entitlement maturity, native claim evidence, oracle arithmetic, permanent gates or treasury custody. The reviewed cumulative quota remains `max(0, floor(matureE*p/10000)-S)`. Transfers do not copy eligibility, and the final tier bypass applies to transfer-only holders. Invalid external reference reads after activation suppress new gates without revoking existing rights or rejecting otherwise valid swaps.

The mainnet-only service condition is deliberately enforced at setup/activation. Allowing a local constructor-bound factory and manager to initialize an inert pool is not equivalent to permitting that pool to activate: the unchanged canonical identity checks reject every such activation path.

## Independent executions

Executed against the final patch with Solidity 0.8.26: **32 tests passed, 0 failed, 0 skipped**, across nine suites. One fee-math fuzz test ran 256 cases with the required assignment seed. The log is [independent-review-tests.txt](independent-review-tests.txt).

```sh
FOUNDRY_FUZZ_SEED=0xbf84f3f21fd6f3e756b5aa1b53feb5a083e16964a7b58fcc36f0bcbdb81e70bd forge test --match-contract 'ServiceAttestationTest|InitializationAdmission.*Test|V4ActivationTest|SpotActivationFailureMatrixTest|ImdAuthenticationTest|ExternalSpotTouch.*Test|ImdFeeMathTest' -vv
```

The independent reviewer added durable [ServiceAttestation.t.sol](../../test/mainnet/ServiceAttestation.t.sol). It corrupts each of eight service runtimes independently and verifies rejection at source staging, companion staging and activation, then restores valid state and activates. Additional cases use the wrong chain, wrong factory `fees()` / `registry()` return values and wrong IMD decimals with otherwise unchanged runtimes. Every failure asserts unchanged staging counters, companion addresses, activation fields and oracle binding.

The other executed suites cover both token orderings for fresh-manager admission, authenticated and repeated initialization, invalid PoolKeys, seed without companions, inactive trading and credits, source/reference failures, immediate activation recovery, router spoof rejection, fee rounding, and the accepted permanent external spot-touch behavior. `forge fmt --check test/mainnet/ServiceAttestation.t.sol` also passed. The implementation agent runs the complete suite and the release checks separately; this reviewer does not claim to have independently repeated those runs.

Reviewed `src/mainnet/UnlkImdHook.sol` SHA-256: `befb38e0d550277c56b36a07d92597ad81b40f0b1fddf58f2bcafeec9fd6fb38`.

## Accepted risk and release scope

Shared Universal Router executor accounts can pool already mature quota rights across their underlying users. Either spot pool may be manipulated, including an external-reference touch inside one unsettled transaction that permanently opens the final gate. The unchanged tests explicitly demonstrate those behaviors. These are requester-accepted design risks, not security properties claimed repaired here.

Mainnet publication remains a separate fact requiring actual platform admission, the required final panel, the accepted manifest/source binding and successful deployment/setup receipts. No transaction was signed or broadcast by this reviewer. The supplied ownership-floor seed/collection test may skip when its generic seed does not satisfy this launch's one-sided 87% seed rules; that skip must not be described as a successful real-factory liquidity rehearsal.

## Follow-up lint triage

Reviewed every inherited diagnostic in [lint.txt](lint.txt), including the flagged fee cast and milestone local. No substantive reachable defect was confirmed; no production change was made.

The exact-input buy cast is not explicitly guarded at the narrowing site, but settlement is guarded using the **untruncated** fee. Writing `gross = -amountSpecified` and `base = gross - specifiedFee`, `_requireCompleteFill` requires an `int128` core leg to equal `-base`. A successful fill therefore has `base <= 2^127`. The fee math gives `specifiedFee <= floor(base*75/10000)+1`, which is far below `int128.max` at that bound. An input large enough to truncate the fee cannot pass the complete-fill equality; core balance-delta safe casts also reject unrepresentable executions. The `uint256 → int256` fee casts are bounded by the positive gross input (`int256.min` is explicitly rejected). Exact-output sell gross is separately capped at `int128.max`. This is a successful-settlement safety argument, not a claim that an arbitrary forged callback input can never reach the cast.

The remaining amount casts are guarded by their positive/negative branches, promote `int128` before negating its minimum value, or follow the explicit positive `uint128` liquidity bound. Unspecified fees are 75bps of an absolute `int128` leg and fit `int128`. The `fdv` local warning is a control-flow false positive: the successful `try` branch assigns it; the `catch` branch returns before its use.

A supplementary scratch check passed **3/3 tests**: 256 fuzzed positive gross inputs up to `int256.max`, the signed-128 fill boundary and maximum signed-256 input, and all gross amounts 1 through 9,999 across fee-rounding discontinuities. It used the assignment fuzz seed. [lint-independent-bounds.txt](lint-independent-bounds.txt) records the execution. Scratch scaffolding is removed before submission and these three checks are not counted as durable suite tests.

## Verdict

The confirmed initialization admission defect is repaired by the minimal boundary change. The targeted independent executions pass, and final source review found no new confirmed production-code defect in the attestation relocation or the preserved activation boundary. No unresolved finding from this narrow contributor review blocks the patch itself. This verdict does not substitute for official admission, the mandatory platform review or actual mainnet release evidence.
