> Current revision (2026-10-16): Current composition is official UNLK/IMD instantaneous sqrt price × this unchanged sampled reference. All UNLK TWAP, end-of-block persistence, sequential6h/final24h confirmation and milestone-keeper requirements below are historical and superseded. The external reference's48h cold start, windows, freshness/market checks, latency and gas remain. Its attack models are conditional and are not verified realizable mainnet exit profit. See [current design](../../unlock-gates/DESIGN.md) and [consolidated NO-GO](../../unlock-gates/HANDOFF.md).

# Pool-derived sampled price source (oracle redesign)

**Status: implemented and tested locally; release still blocked.** No transaction, deployment or site publication was made. Final changes are **pending independent review**. The High oracle-manipulation finding is **not closed**: the measurements below show a profitable attack under stated assumptions. H-01 (shared-executor quota pooling) also stays High and unchanged.

## What changed, and why

This redesign was authorized by the requester. The per-block state-proof source (`ImdV4UsdSource`, about 10 ETH/day of proof gas at 1 gwei) is **no longer the active candidate**. Its code, tests and evidence stay in the tree as history. `UnlkImdHook.deployPriceSource` now accepts only the creation code of `ImdSampledUsdSource`. The commitment is `ImdReviewedCode.PRICE_SOURCE = 0xcc41e96f…3760`, and `testHistoricalProofSourceIsNoLongerAdmitted` checks that setup rejects the old proof source. Nothing else in the hook changed: the hook, oracle, vault, verifier, token, fees, beneficiary, tiers, thresholds, final bypass, principal lock, maturity rule and executor are the same source. Only the pinned constant moved, so the hook's creation bytes changed. Any launch must re-mine its salt (see `scripts/mainnet/mine.mjs`).

The design needs no paid oracle request, attester, API subscription, off-chain signer or state proof. It still needs ordinary Ethereum transactions, and someone pays the gas for them (see "Operations and gas" below). It reads public RPC state for display.

## Price composition

`USD per UNLK = (IMD per UNLK) × (ETH per IMD) × (USD per ETH)`, and `FDV = 1,000,000,000 × USD per UNLK`.

| Leg | Source | Direction / decimals |
| --- | --- | --- |
| IMD per UNLK | Official UNLK/IMD pool, through the existing hook-checkpointed 2h TWAP (`UnlkImdOracle`, unchanged) | Normalized for either token order. Both tokens have 18 decimals |
| ETH per IMD | Existing hookless IMD/native-ETH v4 pool, PoolId `0xb07d640f…abfb3` (a bytes32, not an address). PoolKey `(currency0 = native ETH 0x0, currency1 = IMD 0xd34a…63b7, fee 10000, tickSpacing 200, hooks 0)` under the canonical PoolManager `0x0000…4444c5dc75cB358380D2e3dE08A90` (address and runtime hash pinned) | The pool tick is log1.0001(IMD per ETH). ETH per IMD is the **negated** tick. Both tokens have 18 decimals |
| USD per ETH | Existing Chainlink ETH/USD proxy `0x5f4e…8419` (codehash pinned) | 8 decimals checked. Positive answer, complete round (`answeredInRound >= roundId`), timestamps ordered and not in the future, at most 90 minutes old, below a $1M sanity ceiling |

No stablecoin peg, DEX website label, price API or new Chainlink feed is used. The PoolKey hash, fee, spacing and manager storage layout were verified in the previous revision (`market-evidence.json`). This revision re-read the live pool state (`sampled-spot-evidence.json`), shown below.

**Real read, block 26204279** (hash `0x717cd43d…2c8e`, public RPC): tick **58963** (≈363.59 IMD per ETH), LP fee 10000, protocol fee `0x3e83e8`, active liquidity 11641103500492225377876 (≈**610.5 virtual ETH**), Chainlink **$2451.75659282** updated 2256 s earlier. That gives spot **≈ $6.743 per IMD**. The successor UNLK/IMD pool does not exist, so **no UNLK price or FDV exists**. This is one block, not history.

## On-chain observation design (`src/mainnet/ImdSampledUsdSource.sol`)

* **Permissionless `sample()`.** Anyone can call it: the milestone keeper right before `updateMilestone()`, a user, or a frontend. It reads slot0 and active liquidity of the external pool at that moment and appends one packed storage slot. It reverts only if the pool cannot be read at all: wrong chain, manager code changed, or pool uninitialized. A thin pool or a fee change is **recorded** as an illiquid sample.
* **SAMPLED, not continuous.** Each sample's value is carried forward only until the next sample. The record is **not** authenticated pool history, **not** a Uniswap TWAP (v4 has no built-in oracle), and samples can be taken in the middle of a manipulated block. A hook cannot be retrofitted onto the external PoolKey, and none is.
* **Rate clamp.** The recorded tick moves at most **50 ticks per elapsed minute** toward spot (≈0.5%/min, ≈1.35×/hour). The elapsed time counted is capped at the 20-minute gap.
* **Minimum interval:** 1 minute. The same block or a too-early sample reverts with `TooSoon`.
* **Gaps.** An interval longer than **20 minutes** between samples is bad time.
* **Depth/fee screen.** A sample with less than **250 virtual ETH** (L/√P), or an LP fee other than 10000, makes the following interval bad. 250 ETH is a liveness screen against an emptied or abandoned pool, about 41% of the 610 ETH just observed. It is **not** an economic safety bound, because virtual depth moves with LP and trader actions.
* **Windows.** The source takes the lower ETH-per-IMD value of the **2h** and **24h** sampled geometric means. Floor division is applied to the negated tick, including negative values. Both windows end at the **latest sample time**, never at now, so the newest sample has zero weight until another sample follows it.
* **Fail-closed reads.** `priceUsd()` reverts (`InvalidPrice`) in any of these cases:
  * fewer than 2 samples;
  * less than **48h** of history (24h warm-up plus the 24h window);
  * latest sample older than 20 minutes;
  * latest sample illiquid, or its raw spot more than **2000 ticks** (~22%) from its recorded tick (lagging, or a flash at the latest sample);
  * any bad second inside either window;
  * current pool fee or initialization changed;
  * any Chainlink check fails.

  History is never deleted, reset or repaired. There is no admin, setter, pause, upgrade, price override or tier override.
* **Display only.** `spot()` returns the instantaneous USD/IMD, tick, virtual ETH and ETH/USD for display. Milestones never use it.

### Before / after and honest-user delays

| | Before: proof source (historical) | After: sampled source |
| --- | --- | --- |
| Off-chain requirement | Capture every block's header/account/storage proof before pruning; submit each with 64–256 confirmations | Call `sample()` at least every 20 minutes. No proof, no signer |
| Gas | ≈1.40M execution gas per block, ≈7,200/day: ≈10.07 ETH/day at 1 gwei | Measured ≈72k execution gas per steady sample in tests (≈84k first), plus 21k base. 72/day at 20 minutes ≈ 6.9M gas/day ≈ 0.007 ETH/day at 1 gwei; 1,440/day at 1 minute ≈ 0.14 ETH/day at 1 gwei. These are illustrative gas prices, not quotes |
| Latency of a valid price | 64 blocks (~12.8 min) behind head, 24h warm-up | 0 blocks behind the latest sample, but the latest sample carries no weight. 48h warm-up |
| Cold start | 24h after creation | **48h** of clean samples |
| A missed interval | Marked bad and needs 24h of clean history | Same: one gap over 20 minutes needs **24h** of clean samples |
| Real 2× market move | Reflected through 2h/24h block-end means | Unavailable for **~100 minutes** (lag > 2000 ticks; measured in `testHonestMoveDelayIsExplicit`), then priced. Fully reflected only after 24h because of `min(2h, 24h)` |
| Current market | Below its 10,000 ETH floor: never usable | Passes the 250 ETH screen today (610 ETH). Usable, but not safe; see below |

Milestone interaction (unchanged hook): an invalid price sample never confirms, advances or revokes anything. However, `MAX_CONFIRMATION_GAP = 10 min` between **valid** milestone samples still restarts a pending 6h or 24h run. A source outage longer than 10 minutes therefore delays honest unlocks. Swaps, native claims and ordinary transfers never depend on the source.

## Manipulation demonstrations (`test/mainnet/SampledOracle.t.sol`)

These run against the **actual pinned mainnet PoolManager runtime**, with pool storage written to model states. Pool-state paths are **synthetic**. Liquidity and tick are anchored to the recorded block 26203792 (L = 11803017312680583666866, tick 58773, ETH/USD $2452.69). Costs use a **fee-only, constant-liquidity, in-range** round-trip model: v4 `SqrtPriceMath` input amount, with the 10990 ppm combined fee lost on both legs. The model excludes gas, priority fees, builder/MEV payments, out-of-range liquidity, and competing arbitrage. It assumes the recorded active liquidity holds across the whole move, which was not verified on chain.

| Attack | Result | Measured cost |
| --- | --- | --- |
| Flash/same-block: push 5000 ticks, sample, restore | Recorded value moves 250 ticks (5 minutes × 50). The latest sample has zero weight. The price is **unavailable** until the next sample (grief), then the conservative price moves < 0.05% | 177 ETH round trip ≈ **$9.6k** in fees for a grief of ≤ 1 minute if honest samplers are active |
| Flashed anchor (first sample 40,000 ticks off) | Lag keeps the price unavailable; the value converges inside the warm-up, then is exact | Same cost scale; delay only |
| Checkpoint-timed + repeated: attacker is the **sole** sampler and flashes at every 20-minute sample to 2× IMD | Ratchets 1000 ticks per sample. **Both windows pass fully at 2×** after 27h | 81 samples ≈ **$1.09M** (≈$14.0k per sample at 2× displacement) |
| Same, with attacker-owned LP recapturing the 1% LP fee | Passes | ≈ **$92k** per 24h (only the 0.1% protocol share lost, if the attacker owns all in-range liquidity) |
| Honest **un-sandwiched** 1-minute samples alternating with attacker flashes | Honest samples pull back as fast as the attacker pushes: < 0.5% effect | — (the attacker must also sandwich every honest sample) |
| Honest 1-minute sampling, attacker sandwiches **every** sample for 24h | Passes | ≈ **$20.2M** per 24h at 2× |
| Sustained: pool genuinely held at 2× for 27h | **Passes in full.** Indistinguishable from a real move | Capital at risk plus arbitrage losses, not bounded here |
| Cross-pool: split a 2× FDV factor as √2 on UNLK/IMD × √2 on IMD/ETH | FDV factors multiply. The IMD/ETH-leg fee falls to ≈$6.4k/sample (convex). The UNLK/IMD leg is end-of-block state in the hook's own TWAP, and its cost depends on the not-yet-existing launch pool's depth. **Not measured** | Partial |

### Realizable unlock-and-exit profit (net, model)

Scenario (`testCrossPoolFactorsMultiplyAndNetProfitModel`): true FDV $25M, so reaching the **$50M final bypass** needs 2× over its 24h confirmation (about 27h including window fill). The bypass is permanent for everyone. An attacker holding 2% of supply (20M UNLK) with zero E can then sell all of it. Its gross value is **$500k** at the true price, before exit slippage into the UNLK/IMD pool.

| Attacker setup | IMD/ETH-leg fee cost | Net |
| --- | --- | --- |
| Sole sampler, pays full fees | ≈ $1.14M | −$0.64M at a 2% holding. Breakeven ≈ **45.5M UNLK (4.5%)** |
| Sole sampler, owns the in-range LP (recaptures the LP fee) | ≈ **$103k** | **≈ +$397k gross profit before exit slippage: UNSAFE** |
| Honest per-minute sampling, every sample sandwiched | ≈ $22.7M | Loss at this holding |

Lower tiers unlock only 5 percentage points of an attacker's cumulative E each. For example, 5% of E = 100M UNLK is 5M UNLK, worth $500 at $100K FDV. Attacks on low tiers are therefore uneconomic in this model, but the final bypass is not. **Conclusion: this no-paid-feed architecture does not meet an independent safety criterion of attack cost exceeding realizable unlocked value.** It meets it only under assumptions (frequent honest sampling, no attacker-controlled liquidity, adequate external depth) that the contracts cannot enforce. The High remains open and deployment remains blocked. Sparse sampling and long delays are not claimed as proof of safety.

## Display

`web/src/spotPrice.ts` reads the following at **one block**:

* IMD/ETH slot0, through `extsload` of the v4 state slot;
* the official UNLK/IMD slot0, after a deployment is configured;
* Chainlink, validated by the same rules as the contract.

It then composes USD/IMD, USD/UNLK and **indicative FDV (1B × spot)**. The preview page (`web/src/NextRelease.tsx`, labelled undeployed) shows:

* the values, block number, block time, feed update time and sources;
* an explicit "Unavailable" with a reason for each failure;
* "Successor UNLK/IMD pool is not deployed" in place of a UNLK value.

It shows no candles, history, backfill or "market cap" label. The live Sepolia launch1560 configuration and pages are unchanged. A new price API dependency is not used. The page reads the same public RPC as before.

## Operations, deployment parameters and responsibilities

1. **Stage the source.** After stage 1, the setup authority calls `hook.deployPriceSource(type(ImdSampledUsdSource).creationCode, "")`. `PrepareImd.preparePriceSource()` produces the unsigned calldata. The source has no constructor arguments.
2. **Sample for at least 48h** before `deployCompanions`/`configureAndActivate`. Activation calls `priceUsd()` and fails atomically on a cold source (`testColdSampledSourceCannotActivateAndNativeClaimsRemainIndependent`).
3. **Keeper (anyone).** Call `sample()` at least every 20 minutes, forever. Running it more often (down to 1 minute) raises attack cost linearly but also raises gas. Call `sample()` before each `updateMilestone()` in the 4–5 minute cadence, either as separate transactions or a multicall from the keeper's own account. Monitor `observationCount`, the latest sample time, `Sampled` events with `gap=true` or `liquid=false`, and `priceUsd()` reverts. A missed 20 minutes costs 24h of availability.
4. **Gas sponsor.** Pays roughly 72–1,440 samples/day as above, plus milestone calls. Normal user swaps pay normal gas. No zero-cost claim is made.
5. **Capture via swaps:** evaluated and **not adopted**. Calling `sample()` from the UNLK/IMD hook would add gas to every user swap and change the reviewed hook. It gives no protection either, because a swapper can bundle IMD/ETH manipulation into the same transaction. Users or frontends may still call `sample()` voluntarily.

## Evidence classes

* **Real:** the block 26204279 pool and Chainlink read above. `rehearsal/mainnet/SampledSourceRehearsal.t.sol` ran on a read-only fork at that block and passed (`sampled-fork-test.txt`). On actual state, the pinned manager and Chainlink codehashes were accepted, `sample()` recorded tick 58963 as liquid, `spot()` returned ≈$6.7432/IMD with 610.50 virtual ETH, and `priceUsd()` correctly reverted after one real sample. The earlier PoolKey and storage proof, and round-trip router costs at block 26203792 (see `ORACLE.md`).
* **Synthetic:** all multi-day sample sequences, manipulation paths and the cost/profit model. The hook-integration fixtures still redirect `priceUsd()` to a synthetic adapter so trading and milestones can be exercised. The production source has no such redirect.
* No real multi-day sampled history exists, because nothing is deployed.

## Remaining blockers (unchanged or new)

1. **Oracle High (open).** Repeated or sustained manipulation passes. The net-profit model is positive with LP recapture at the final bypass.
2. **H-01 High (open).** Shared-executor pooling of mature quota. The residual disclosure in `H-01.md` is unchanged and not accepted.
3. **Independent review of this change set: pending.** None was obtained in this run.
4. Protected admission harness and browser/mobile checks: not run. Separate release, deployment and hosting authorization is still required.
