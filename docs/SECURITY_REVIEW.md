# Adversarial review and release limitations

The launch-1534 size fix changed only the pure encoding helper and its callers/checks. **Revision 2026-10-13
then changed `UnlkHook` and `UnlkSwapRouter` bytecode** to answer two independent-review findings (first two rows
of the table below; full record in [REVISION_2026-10-13.md](REVISION_2026-10-13.md)); the token, claim evidence,
oracle and helper are unchanged. Neither change resolves or accepts the protocol-fee halt, treasury reward-round
powers or manipulation risks below. The old launch API records a passed independent-review check at `f77cf377...`;
that does not constitute review of this new submission. See [the size-fix handoff](SIZE_FIX.md).

This is an implementation-author adversarial review and repair record, using the supplied ETH/v4 checklists and
reproductions of the recovered findings. **It is not an independent audit of this revision.** No external reviewer
has signed off the current build. The contributor network's independent review remains a release gate. Tests and
this report carry no independent authority.

## Findings addressed

| Finding | Repair and evidence |
|---|---|
| Review d2d6b0db (2026-10-13, medium): stage 1 accepted a pool whose Sepolia services stage 2 refuses forever, locking the 87% seed in a pool that can never activate | `beforeInitialize` now runs `_verifyServices`, the single place for the four Sepolia pins (factory, manager, fees, registry; the registry pin moved there from `_verifyLaunchRecord`). On chain 11155111 an unpinned or lookalike service reverts the launch transaction with `InvalidConfig`; other chain ids are unaffected. The reviewer's proof passes. `SepoliaPins.t.sol` etches the recorded runtime bytes of the real services (asserted to hash to the pins) and proves the accepting path through the real `PoolManager` code, plus each single mismatch. Both stages re-rehearsed on a recorded Sepolia fork through the real factory (block 11906030). |
| Review 9224491b (2026-10-13, low): an exact-input sell that drained the pool's ETH walked the price to tick 887271, the oracle classed the pool illiquid and milestone confirmation restarted for a full window | The router bounds every swap's price limit to the seed range read from the hook (`seedTickLower`/`seedTickUpper`), so a reserve-draining sell ends exactly at the seed's upper boundary, the launch state, which is liquid; buys stop at the lower boundary. Quota, partial fills, settlement and the TWAP/feed/depth/confirmation rules are unchanged. On Sepolia the seed range is the only liquidity: the verified factory reaches the manager callback only from `launch` and `claimFees`. `SeedBoundary.t.sol` reproduces the reviewer's drain and shows the observation liquid and the FDV readable after a window. |
| Revision a4b5f9a2: activation demanded the factory seed within 1e12 wei of 870M while staging was single-shot, so sub-dust deployer rounding stranded stage 1 forever | Replaced the dust tolerance with policy bands (pool 99-100% of its share, remainder at least 3%, distributor exactly 10%, sum equal to the supply; the remainder wallet is credited exactly 30M regardless). `deployCompanions` now runs the same `_verifyLaunch` as `configureAndActivate`, so an unactivatable launch cannot be staged, and staging may be repeated until activation. `beforeAddLiquidity` refuses a seed outside the band in the launch transaction itself. `ActivationRobustness.t.sol` reproduces the reviewer's exact 1e9-short seed and activates it; below-band seeds revert the launch. |
| Revision d8778e80: the 17 ETH seed-capacity floor was pinned as an oracle constant but never checked against the real seed, so an opening cap 2.3% under 20 ETH sealed a hook whose milestones could never confirm | `SeedDepth` is one internal library used by the oracle, the hook's seed callback and both stage-2 calls. The launch transaction reverts if the seed's opening-value capacity is below 17 ETH (reproduced at the reviewer's -177840 tick), and staging/activation recompute it from the live position. The recorded `seedTokens`/`seedQuoteCapacity` are public. The constant and its 19.54 ETH minimum opening FDV are documented, not hidden. |
| Revision 66b99dca: a permissionless `updateMilestone` during a short feed outage restarted confirmation that an unobserved identical outage would have kept | Removed the observed-interruption flag. An invalid sample never confirms and never advances the cadence clock; restart is decided only by the gap between valid samples, identical for observed and unobserved intervals. `testObservedAndUnobservedInvalidIntervalsAgree` runs both from one snapshot. |
| Revision 153c7ae8: rounds over 1024 leaves could never be certified, so their native claimants received tokens but no sell quota | Added per-submitter chunked certification (`submitLeaves`/`reduce`/`abandonSession`) with cross-chunk uniqueness, tested at 1500 leaves including duplicates, wrong roots, foreign sessions and single-leaf rounds. Duplicate-recipient roots remain uncertifiable by design. |
| Companion ABI/code presence could accept malicious implementations | The hook itself CREATE2-deploys code only after its **creation body hash** matches the compiled constant. Arguments come from authenticated stage-1 records. It records exact addresses/runtime hashes, then only that bundle can activate. This proves constructor state too: a custom constructor cannot prepopulate fake credits or price history. Mutation, inconsistent immutable, counterfeit constructor, rollback and replacement tests are in `SecurityRegression.t.sol`. |
| Mutable fee requester/current balance was not proof of initial allocation | Standard token transfers passively record the initial factory distribution until its first zero balance. Activation authenticates the token's expected CREATE2 address using its exact creation hash and launch number, verifies registry/pool records and allocation receipts, then credits the actual remainder recipient. Subsequent transfers and `setRequester` cannot move the original credit. Tests cover early transfer, fee reassignment, later donations, and unpaid treasury receipt. |
| Two Merkle leaves for one account permit larger attestation after smaller claim | Before attestation, reconstruct the **complete** root and prove every account unique. Double-hashed leaves and complete internal-node reconstruction rule out omitting a sibling. Native claimed flag and exact proof are still required. Certification is permissionless, immutable per round, maximum 1024 leaves, and uses bounded iterative heapsort. Duplicate, incomplete, odd-sized, multileaf and maximum sorted-tree tests cover the boundary. |
| Old 10 ETH cash floor hid a higher first milestone (08f7e7e8/3589008c) | Removed cash-reserve floor. Validate the factory's locked position and its 17 ETH minimum **opening-value seed capacity**, continuously through the TWAP window. The 87% allocation at the policy's opening cap passes without extra buying. A $3,000/ETH test confirms the $100K tier with <10 ETH cash in the seed. This quality check is not a manipulation-cost guarantee. |
| All six confirmations ran concurrently | Exactly one tier can advance after its own six-hour confirmation. The sixth requires its own 24 hours. Same-block calls add nothing; four-minute minimum sample spacing, ten-minute maximum gap, two-hour TWAP. Explicit invalid observations interrupt future confirmation, never revoke an earned tier. Cadence, gaps, stale/future/incoherent feeds, depth dips and final-delay tests cover transitions. |
| Inherited factory candidate had never been authenticated | `0x84cf…` is a ProjectFactory. The current hook factory is `0x315752…E908`, identified from public IMD docs; its normalized runtime exactly matches the verified source build. Registry, fees, signer and distributor creation hash were checked. Both stages and settlement were rehearsed against the real factory/manager on block 11904506. |
| Recovered model opened near 25 ETH while describing a 20 ETH policy cap | The test/fork seed now uses spacing boundary 177300: 19.968425 ETH FDV, conservative rounding from 20 ETH. Economic measurements were rerun against this seed with no artificial quote-liquidity top-up. |

The accepted 90-minute Chainlink age and five-minute checkpoint freshness remain. The old “invalid read leaves
pending start untouched” property also remains visible, but known-invalid intervals cannot be bridged into later
confirmation: the next good observation restarts the pending run. A new tier's clock starts only when its own
threshold has been observed, including at the previous tier's transition. Previously earned p is monotonic.
Feed freshness is checked at each confirmation sample; this is not proof of continuous between-sample freshness.

## Sustained manipulation: reproduced, not dismissed

`test/ManipulationEconomics.t.sol` executes real v4 buys/sells against **only the factory's 870M token seed**. It
uses a local fixed $2,000/ETH feed, the spacing-rounded 20 ETH opening cap, 1.25% LP fee and zero protocol fee.
The attacker buys to a price limit representing **$5.1M FDV**, leaves the capital exposed, checkpoints every five
minutes, advances through all six real confirmations, then sells its acquired inventory. Forge warps the test
clock; this was not a 56-hour real-world wait. No storage cheat unlocks a tier and no mock returns an FDV.

The counter-selling scenario funds and natively claims the entire 10% contributor allocation to one counterparty,
synchronizes its E and the payer's 3% E, then both sell all currently permitted inventory after each tier. The
attacker repurchases to defend the price until final unlock. After the final counter-sales, the attacker exits.
This is a specified adversarial path, not an optimizer over all possible schedules.

| Scenario | Gross ETH capital deployed | Attacker ETH exit | Net loss before fee recovery | Payer native fee receipts | Counter-seller proceeds | Duration |
|---|---:|---:|---:|---:|---:|---:|
| No counter-selling; attacker not payer | 181.211119 | 178.745759 | 2.465360 | 1.812111 (to someone else) | 0 | 201600 s / 56 h |
| Attacker is payer; same purchased inventory exited | 181.211119 | 178.745759 | 2.465360 | 1.812111 (recovered) | 0 | 56 h |
| All initial 13% counter-sells as rights open | 404.492004 | 139.667041 | 264.824963 | 4.044920 | 259.768813 | 56 h |

Payer attack **net cash loss after native fee recovery: 0.653249186877100125 ETH**. Raw wei results are preserved in
`ECONOMICS_RESULTS.txt`. Gross capital is the sum of actual settled buy input; unused prefunds are withdrawn and
excluded. The attacker makes no intermediate sales, so gross also measures peak deployed capital in this path.
Counter-seller proceeds are settled router credits; withdrawability is separately tested. Payer fee recapture is
measured from the real factory's native payout. Token-denominated LP fees remain an additional asset and are **not**
valued as cash recovered here. Gas, financing, MEV, outside venues and counterparty replenishment are excluded.

**Residual economic risk:** a patient funded attacker in a quiet market can permanently unlock the token cheaply
relative to gross capital. The payer's fee share makes its attack cheaper. Six sequential delays increase exposure
to counter-selling; they do not make pool price independent of the attacker. The counter-selling result is not a
minimum attack cost: actual participation can be zero. Price declines after release never relock by specification.
This design cannot certify that $5M is externally established fair value. Any requirement to make that guarantee
remains unresolved under the specified single-pool pricing and fixed-fee mechanics. The release status explicitly
keeps this economic limitation for independent review instead of labelling a longer delay “safe”.

## Trust and scope

* Quotas apply only to the official pool. Freely transferable UNLK can trade through other pools/contracts.
* Setup authority can stage (repeatedly, until activation) and activate once, but cannot supply altered code,
  invented constructor state, substitute routes, reset tiers, change the payer, withdraw funds or install a later
  implementation. Refusing to activate still prevents official trading. Thus owner-wallet execution must be
  secured **before** stage 1.
* The platform signs stage 1 and supplies a unique new launch number, source attestation and authentic frozen
  allocations. Registry artifacts and immutable factory code bind those outputs. The hook cannot cause IMD to
  create a launch record or compel an owner wallet to sign.
* Chainlink's proxy and underlying aggregator governance remain external trust. Pinning proxy code does not freeze
  its aggregator. Current valid ETH/USD is combined with token/ETH TWAP; it is not a separate UNLK valuation source.
* Uniswap manager governance can set protocol fees. The hook refuses changed fee economics, which can stop official
  swaps even though there is no hook-admin pause. Already earned rights stay recorded. No recovery/upgrade escape
  exists if an immutable dependency becomes unusable. **Release decision (revision finding d0e68f0c):** this is
  deliberate. The alternative, continuing to trade at a higher total fee, would silently change the paid-for
  1.25% split the brief fixes; halting keeps the promise and loses liveness. The requester must accept one or the
  other explicitly; the code implements the halt. Holders can still trade the token on other pools.
* Single-call certification is capped at 1024 leaves for transaction gas; larger rounds are certified in chunks.
  A duplicate-recipient frozen root is an explicit preflight failure for this package, not a reason to strand a
  stage-1 pool. A historical live IMD tree
  with 224 distinct wallets was independently reconstructed by `prepare_claim_tree.py`; it is **not this new
  launch's reward snapshot**. Native claims remain possible even before certification or during oracle outages.
* Rewards are deduplicated per round/account, with no artificial ceiling on actual cumulative claims. The treasury
  can fund and open later native remediation rounds under the existing distributor policy; their certified,
  actually paid claims also create E. This is an external platform authority, not a hook exemption (revision
  finding 0147f1a4 records it as a trust assumption: the treasury can route tokens it holds to chosen wallets with
  sell quota that plain transfer recipients never get). The recovered
  100M cumulative cap was removed because it could reject genuine later rewards; its storage-tampering test is
  replaced by real-claim monotonicity and funded multi-round tests. Recycling inventory through treasury-approved
  rounds can create additional rights, just as newly executed buys can; the treasury's reward administration is
  therefore a trust dependency.

## Callback, settlement and code review

All enabled callbacks require the immutable manager and bound PoolKey; initialization also requires factory sender.
Permissions are exactly `0x3fc0`: both initialization, both add, both remove, and both swap callbacks. No return-delta
permissions, custom accounting, hook fee, delegatecall, upgrade, selfdestruct or arbitrary external execution path.
The stage-2 CREATE2 path hashes all three creation bodies before any creation and appends only authenticated args.

BeforeSwap binds the router's current authenticated caller, nonce and exact operation hash. AfterSwap consumes the
pending operation once and applies executed token deltas before settlement completes. Over-quota sales revert the
whole swap. Router prefunding comes literally from msg.sender; callback settlement pays from router custody through
sync/transfer/settle (or native settle), then take. Strict balance checks intentionally catch settlement mismatch.
Native pull credits use effects before the call, including a reverting/reentrant recipient. The single token has
standard ERC20 semantics and no external callback during transfer. Tests cover direct-manager bypass, spoofed
context, replay, exact input/output, partial fills, refund failures, batch operations and ledger/solvency invariants.

## Automated analysis and independence

`forge lint src --severity high med` ran. Findings are recorded in `LINT_RESULTS.txt`: checked integer casts,
signed floor-division arithmetic, deliberate settlement balance equality, default-zero locals, and generic
reentrancy warnings around already guarded swap/credit flows. Router nonReentrant is set before unlock; native
withdrawal zeroes the caller's entitlement before its ETH call. Cast ranges follow signed v4 delta bounds or uint64
wall-clock timestamps; the negative TWAP floor adjustment is intentional. None is treated as evidence of an
independently audited release. Slither and Mythril were not installed/run. Formal verification was not performed.

The final test/fork/protected counts and code sizes are in `VALIDATION.md`. Independent contributor approval and
real stage-2 execution remain outstanding, so the deliverable is a reviewable source/package rather than an inactive
public pool advertised as active trading.
