# UNLOCK successor (UnlkHookV3): standard Universal Router, initiator ledger, native-ETH treasury fee

Status: **undeployed source candidate; independent adversarial review PENDING; release blocked until it is
done and its critical/high findings are resolved.** No transaction was broadcast and no website was published.
The sealed launch-1560 contracts (`src/*.sol`) and the V2 candidate (`src/candidate/`) are unchanged.

The requester's new design authorization (this job) explicitly ranks standard compatibility above the earlier
"actual final recipient / actual funding source" definition of E and S. This successor implements that change:
it is **not** a custom-router candidate. The only settling route is the deployed Sepolia Universal Router the
IMD Explorer already uses, with empty hookData, unmodified.

Source: `src/successor/UnlkHookV3.sol`, `src/successor/SuccessorFeeMath.sol`. Companions are the reviewed,
unchanged V2 bundle (`MerkleClaimEvidence`, `UnlkOracle`, `NftFeeVault`, `SetupVerifierV2`, pins in
`src/candidate/ReviewedCodeV2.sol`). The `UnlkRouterV2` companion is **not** part of the successor.

## B-01 Initiator ledger

### Rule

For every swap on the official ETH/UNLK pool:

1. `beforeSwap` requires `sender == 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` (constant, the deployed
   Sepolia Universal Router) **and** `sender.codehash == 0x14f7c925…44f4` (constant runtime hash). The
   router has no proxy, owner, or upgrade path, and the hook has no setter or allowlist. A lookalike at the
   same address with different code (tested via `vm.etch`), or any other unlocker, reverts `InvalidRoute`.
2. The initiator is `UniversalRouter.msgSender()`, the router's own transient lock owner. That is the
   `msg.sender` of the outer `execute` call: an EOA, an EIP-7702 delegated EOA, or a smart account (Safe,
   ERC-4337 account, any contract wallet). `execute` cannot be re-entered, so the value is fixed for the whole
   execution. A zero value reverts. `tx.origin`, hookData, signatures and caller-asserted identities are never
   read. hookData is ignored completely: a test passes `abi.encode(bob)` and Bob gets no credit.
3. A buy credits `eligible[initiator] += executed UNLK output of the pool` (event `Credit(initiator, q, 0)`).
4. A sell requires `sold[initiator] + q <= floor(eligible[initiator] * p / 10000)` unless `fullyUnlocked`,
   then records `sold[initiator] += q` (event `Sale(initiator, q)`). Otherwise the whole transaction
   reverts with `QuotaExceeded`.
5. ERC-20 transfers are ordinary and untouched. They never create, move or consume E or S.
6. Proven allocations are unchanged. The 3% payer allocation credits the recorded `payer` once (`syncPayer`).
   Native distributor claims credit the rightful claimant once each (`syncRewards`, claimed-amount
   deduplication), whether claimed before or after activation and whether synced or not. None of these
   depend on trading or the initiator.

### What this does and does not prove

The initiator is the account that **authorised the router execution**. The hook does **not** prove who
actually paid the input or who actually received the output. Those are decided by later TAKE/SETTLE actions
the hook never sees (see `docs/candidate/COMPATIBILITY.md` for the recorded counterexample). This semantics
change was authorized deliberately; the UI, events and examples describe it as initiator credit.

### Before/after semantic matrix

| Situation | Launch 1560 / V2 candidate (actual recipient & source) | Successor V3 (initiator) | Test |
| --- | --- | --- | --- |
| Alice buys via Explorer (`0x10`/`060c0f`) | E(Alice) += out | E(Alice) += out | `testExplorerBuyExactInput…` |
| Alice buys, `TAKE` delivers to Bob (`060c0e`) | V2: route rejected; intended E(Bob) | **E(Alice)** += out; Bob gets the tokens and no credit; Bob's sale reverts | `testDivertedDeliveryCreditsInitiatorNotRecipient` |
| Bob prefunds UR, Alice executes `SETTLE(payerIsUser=false)` sale | V2: rejected; intended S(Bob) | **S(Alice)** += q; Bob's quota untouched | `testPrefundedSaleConsumesInitiatorQuotaNotFunder` |
| Sale funded through Permit2 allowance | V2: rejected (custom router pulls directly) | S(initiator) += q; Permit2 only pulls from `msgSender` | `testExplorerSellExactInputThroughPermit2…` |
| Smart account calls UR | V2: smart account calls the custom router | E/S of the **smart account**; never its signer or the bundler | `testSmartAccountIsTheInitiator` |
| Batch of buys in one execute | V2: sequential custom batch | each official leg credits the initiator | `testBatchedBuysAllCreditTheInitiator` |
| Multihop ETH→UNLK→OTHER (no UNLK delivered) | V2: rejected | E(initiator) += official-leg UNLK output | `testMultihopOfficialLegCreditsInitiator…` |
| Buy→sell cycle in one execute | V2: n/a | both legs on the initiator; 100% resale reverts `QuotaExceeded`; ≤20% settles and pays both fees | `testCycleInOneExecutionCannotFarmQuota` |
| Transfer to another wallet | no rights move | no rights move | `testTransfersNeverMigrateRights` |
| Generic Quoter call | simulation only | simulation only: the result includes the fee, writes nothing and is not proof of wallet capacity | `testGenericQuoteForZeroQuotaWalletIsSimulationOnly` |
| Direct unlocker / other router | rejected | rejected `InvalidRoute` | `testDirectUnlockerCannotTrade`, `testLookalikeCode…` |
| Payer 3% / native claims | proven recipient, once | unchanged | `testClaimsAndPayerCredit…` |
| After final unlock | quota bypass for everyone | quota bypass for everyone; same pinned route; fee persists | `testFullUnlockKeepsTheStandardRoute…` |

### Quantified residual risks of the initiator ledger

| ID | Counterexample | Severity (self-assessed, pending review) | Bound / mitigation |
| --- | --- | --- | --- |
| I-1 | **Quota pooling via shared executors.** If one contract (aggregator, relayer contract, shared smart account, custodial service) calls UR for many users, every user's buys credit that one contract, and anyone it lets trade can sell against the pooled quota. Users of such services get no personal E. | **High** for users of shared executors: their E/S is not per person. | No on-chain fix exists without the proof the authorization dropped. The same transfer-to-a-cooperating-holder sale was already possible under the original design, so total sellable supply is still capped by Σ p·E. This is disclosed in the UI. Integrators should give each user their own account. |
| I-2 | **Credit without holdings.** An initiator whose buys were delivered elsewhere keeps E but no tokens. A cooperating recipient can send the tokens back, or the initiator can sell other tokens it is given. | Medium | Same cap: no extra sale capacity beyond Σ p·E. Transfers create none. |
| I-3 | **Recipient surprise.** A wallet that receives tokens from someone else's buy (gift, payment, aggregator TAKE) has E = 0 and cannot sell before final unlock. | Medium (UX/economic) | Disclosed in UI, events and docs. |
| I-4 | **Wash-trading E growth.** Repeated buy→sell cycles grow E faster than holdings, the same as the original design. Every round trip pays 1.25% LP + 0.75% treasury on each leg. | Low–Medium | Fees; `p` caps each sale; unchanged economics. |
| I-5 | **Router-held prefunds** can be swept by anyone (standard UR behaviour), so a prefunder can lose tokens. | Low for the protocol, user risk | Not a hook property; the Explorer never prefunds. |
| I-6 | **Pinned-route dependency.** If the deployed router ever stopped working (chain-level change), trading on this pool would stop. There is no admin fallback, by design. | Medium (availability) | The router is immutable code. Claims, sync, transfers and the vault keep working without it. |

No critical counterexample is known in which a third party can spend, create or move **another** account's E
or S: doing either requires being that account's `msgSender`. That claim needs the independent review.

## B-02 Fixed 75 bps treasury fee through standard v4 settlement

Hook permissions add `beforeSwapReturnDelta` (flags `0x3fcc`; V2 was `0x3fc4`). The fee is **always native
ETH**, credited as PoolManager ERC-6909 claims minted to `NftFeeVault` during the swap. It is never charged in
UNLK. The pool's LP fee stays 12500 (1.25%, distributed 1% payer / 0.25% IMD by the factory's position
ownership, unchanged). Protocol fee must stay 0 or swaps revert.

The **fee base in every mode is the executed pool ETH leg**: `|delta.amount0|` as the PoolManager reports it
to the hook. That is the ETH that actually entered (buy) or left (sell) the pool, with the LP fee included on
the input side.

| Mode (v4) | Router action | Specified | Fee timing / mechanism | Fee formula | Trader gross / net |
| --- | --- | --- | --- | --- | --- |
| Buy exact-input (IMD Explorer) | `0x06` | ETH | `beforeSwap`, specified delta | `base = buyPoolInput(G)` = largest `b` with `b + floor(b·75/10000) ≤ G`; `fee = G − base` ∈ [floor(base·75bps), +1 wei] | pays exactly G; pool runs `base` |
| Buy exact-output | `0x08` | UNLK | `afterSwap`, unspecified return delta | `fee = floor(leg·75/10000)`, leg = executed pool ETH input | pays `leg + fee` (≤ amountInMaximum, fee-inclusive) |
| Sell exact-input (IMD Explorer) | `0x06` | UNLK | `afterSwap`, unspecified return delta | `fee = floor(leg·75/10000)`, leg = executed pool ETH output | receives `leg − fee` (≥ amountOutMinimum, fee-inclusive) |
| Sell exact-output | `0x08` | ETH | `beforeSwap`, specified delta | `gross = sellGrossOutput(N)` = smallest `g` with `g − floor(g·75/10000) ≥ N`; `fee = gross − N` ∈ [floor(gross·75bps), +1 wei] | receives exactly N; pool outputs `gross` |

* **Partial fills and range exits revert.** `afterSwap` requires the pool to have executed exactly
  `amountSpecified + specifiedFee`, and requires the post-swap price to be inside the locked seed range. A
  standard route uses the extreme price limit, so a partial fill can only mean the seed was exhausted and the
  price walked into empty liquidity, which the oracle classes illiquid. Rejecting such swaps atomically means
  no fee is ever charged on unexecuted volume. The pre-charged ETH-specified fee is protected the same way.
  The visible consequence: right after launch the pool holds no ETH, so a sale reverts until buys have
  happened. A sale larger than the ETH in the seed range reverts and must be made smaller.
* **No hidden overpayment.** In the ETH-specified modes the treasury can get at most 1 wei of rounding above
  floor(75 bps). Unused exact-output budgets stay with the router's normal `SWEEP`/`SETTLE_ALL` handling
  (tested: router keeps 0 wei). No fee applies to transfers, claims, `syncPayer`/`syncRewards`, liquidity or
  LP fee collection.
* **No stranded debt.** Every settled swap's hook delta is exactly offset by the mint to the vault. Quoter
  simulations skip that mint, so they could not settle even if they did not revert.
* **Effective cost is not "2%".** For buys, LP 1.25% is part of the pool leg, and the treasury fee is 0.75% of
  that leg on top: total ≈ 2% of the pool leg ≈ 1.985% of gross ETH paid. For sells, LP 1.25% is taken in
  UNLK on the input, and 0.75% is taken in ETH on the output. The two bases differ, so the sum is not an
  exact percentage of either.
* **Quotes.** The standard Quoter's results include the fee (the hook's deltas apply in the simulation).
  Tests assert equality with execution for exact-input buys and sells and for exact-output buys and sells.
  Wallets therefore set fee-inclusive limits exactly as the Explorer does (quote minus slippage). The
  Explorer's existing 1% `amountOutMinimum` tolerance is unchanged.

### Treasury asset lifecycle

Fees are native ETH claims, so no UNLK conversion is needed. The automatic ETH goal is met without a swap
executor:

1. Accrual: `poolManager.mint(vault, 0, fee)` plus `vault.recordAccrual(fee)`. The call is hook-only and
   checked against the vault's real claim balance.
2. Anyone may call `vault.redeem()`: burn the accrued claims and `take` the ETH to the vault. The vault never
   redeems donated claims.
3. Only `BENEFICIARY = 0x48e4e74fe1d0c14404ceb57b9fec5b21329c6ec9` (constant) can `withdraw()` to itself.
   ETH donations are tracked separately (`withdrawDonations`). NFT purchases are manual and happen outside
   the contract.

The vault never swaps, has no E, never trades, and so never uses anyone's quota. There is no administrator
swap executor and no trader or vault exemption, and no oracle is involved in fees. Slippage/MEV on the fee is
nil (no conversion). Traders' own MEV exposure is the usual standard-router exposure, bounded by their
fee-inclusive limits. UNLK or other ERC-20 tokens sent directly to the vault are **not** fee revenue and have
no recovery function. The UI shows the vault's UNLK balance labelled "never fee revenue".

## Preserved (unchanged from V2 candidate)

UNLOCK/UNLK, 1B supply, 18 decimals, 10/87/3 allocation; native eligible claims independent of sync; ordinary
transfers; locked LP principal (removal reverts `PrincipalLocked`); fixed beneficiary; sixteen tiers
($100k … $50M, 20% → 100% in 5-point steps); sequential 6h confirmations (24h final), 4-minute cadence,
10-minute maximum gap, 2h TWAP warm-up, Chainlink freshness and seed-depth requirements; permanent final
bypass; sealed two-stage setup; no upgrade, pause, reset or rule change. Other pools can still trade UNLK
without this hook's quota, as already disclosed.

## Supported-mode matrix (standard Universal Router, empty hookData)

| Mode | Status | Evidence |
| --- | --- | --- |
| Buy exact-input `0x10`/`060c0f` (IMD Explorer payload byte-for-byte) | **Supported**, IMD UI covered | offline recorded runtime + public fork |
| Sell exact-input `0x10`/`060c0f` via Permit2 allowance (IMD Explorer payload) | **Supported**, IMD UI covered | same |
| Buy exact-output `0x10 0x04`/`080c0f` + SWEEP | **Supported**, not in IMD UI | same |
| Sell exact-output `0x10`/`080c0f` | **Supported**, not in IMD UI | same |
| TAKE to another recipient, SETTLE from router prefund, batches, multihop, buy→sell cycles | **Supported** with initiator semantics | same |
| Partial fills / swaps ending outside the seed range | **Rejected** (`PartialFill`), no fee | same |
| QuoterV4 `quoteExactInputSingle` / `quoteExactOutputSingle` | Simulation only, fee-inclusive | same |
| Any other router, aggregator calling PoolManager directly, custom unlockers | **Rejected** (`InvalidRoute`) | same |
| Aggregators that call **through** the Universal Router | Supported; the aggregator contract is the initiator (risk I-1) | by construction |
| `PERMIT2_PERMIT` signature flow (`0x0a`) | Expected to work, because funding is not observed by the hook; **not executed in tests** | not tested |
