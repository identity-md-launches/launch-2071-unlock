# One-way UNLOCK gates — current candidate design

This document supersedes UNLK time filtering and sequential confirmation rules in earlier candidate reports. It continues accepted commit `3939f319d67dcd92eb50b057c0c13754ccb6b35c`. Earlier deployed contracts are immutable and unchanged. This source-only successor is undeployed; candidate UI writes remain disabled.

## Doors and accounting

Each FDV threshold opens once for everyone. A valid instantaneous official-pool price touching or exceeding a threshold is sufficient. One evaluation advances directly to the highest crossed threshold. Declines, invalid data, repeated checkpoints and later sales never close a door. No UNLK TWAP, sustained price, confirmation period, sequential waiting period or final delay exists.

| FDV USD | Cumulative entitlement |
| --- | --- |
| Initially | 20% |
| 100K / 250K / 500K / 1M | 25% / 30% / 35% / 40% |
| 2M / 3.5M / 5M / 7.5M | 45% / 50% / 55% / 60% |
| 10M / 15M / 20M / 25M | 65% / 70% / 75% / 80% |
| 30M / 35M / 40M | 85% / 90% / 95% |
| 50M | Permanent global quota bypass, including E=0 holders |

A **brief valid UNLK price spike may permanently open every gate**, including full unlock. Selling immediately after a gate opens is intended even if the sale lowers the price. This design makes **no manipulation-resistance claim** for the official UNLK price. FDV is fixed supply times price; it is neither circulating market capitalization nor extractable cash.

`E` remains cumulative authenticated eligible acquisitions; `S` remains cumulative actual executed official-pool token input on sales. Transfers, donations, LP fee receipts and liquidity operations create no quota rights. Before final unlock, the preserved buy-credit maturity rule gives:

```
matureE = E - official-buy credit acquired in the current block
Q = max(0, floor(matureE * p / 10000) - S)
require S + actualExecutedSale <= floor(matureE * p / 10000)
S += actualExecutedSale
```

Payer/native-claim credits are not delayed. New official buy credit becomes spendable in the next block, across every router call/UI. Opening gates never writes E/S, restores consumed quota or credits a wallet. For E=1000, p=20%, S=0: 200 can sell; S then becomes 200. At 30%, only **100 more** can sell, because entitlement is 300 minus S, not 30% of remaining holdings. Further acquisitions add to E and preserve S. Integer quotas round down in token minor units; actual token balance still limits what can settle.

At $50M, `fullyUnlocked=true` is irreversibly latched. Both sale enforcement and `remainingQuota` branch on that flag, independently of E/maturity. A transfer-only holder with E=0 may sell all of their tokens. S still records actual sales and fixed fees continue. Setting p=10000 without the bypass would not implement this design.

## Price source and execution order

`FDV (USD, 18 decimals) = 1,000,000,000 * official UNLK/IMD spot * validated IMD/USD reference`.

`UnlkImdOracle` binds once, only through its immutable hook at activation. It checks the hook's actual key, token, manager, seed ticks, sorted canonical IMD pair, fee12500 and spacing60. It reads `StateLibrary.getSlot0` for that exact PoolId and uses **sqrtPriceX96**, not the rounded tick. Both tokens are 18 decimals: UNLK is fixed, canonical IMD metadata/runtime are checked by setup. Locked factory seed range, principal/depth and fee screens remain instantaneous validity checks. Arbitrary pools, caller-supplied prices, website APIs, fabricated UNLK history and administrative overrides are absent.

`ImdSpotMath` computes the exact integer floor of the full rational product in either order. Its common path uses 512-bit mulDiv. Above the 128-bit square boundary it uses full-width multiplication or exact 512/512 division, avoiding premature ratio normalization. FDVs exceeding uint256 saturate at its maximum, which remains above all gates. There is no wraparound or one-wei threshold loss. It is an internal library, with no link placeholder or deployment requirement.

Successful official-pool swaps execute in this order:

1. Authenticate the pinned standard router's `msgSender()` and exact bound key; check fee settings. No gate advancement occurs in beforeSwap.
2. PoolManager executes the swap. The hook verifies complete fill and in-range final price.
3. Account the actual executed UNLK delta. A sale must fit the gate **already open**, with unchanged maturity. Its own post-swap update cannot authorize an excessive sale retroactively.
4. Evaluate the actual post-swap sqrt price with the separate valid reference, latch the highest crossed gate, then settle the fixed IMD fee.

An earlier successful buy or checkpoint can open a gate usable by a later sale, including in one transaction. Every successful swap boundary is evaluated; a high buy followed by a low sale in the same transaction preserves the earlier high. A revert anywhere later in the batch rolls back gates, E, S, maturity state, fees and pool movement together. The pinned Quoter returns hypothetical fee deltas only and persists no gate/accounting change.

Anyone may call `hook.checkpoint()`; `updateMilestone()` is a compatible alias. Both read current state and accept no price argument. Viewing `oracle.fdvUsd()` alone does not persist a gate. The contract does not reconstruct past touches it never observed. No periodic UNLK checkpoint is required for swaps, although permissionless calls can observe a changed reference/current pool between swaps.

## Separate IMD/USD reference: retained latency and cost

The admitted source remains `ImdSampledUsdSource`, with unchanged creation code and validation. It samples the existing hookless native ETH/IMD v4 pool (`0xb07d640f…abfb3`) and composes ETH per IMD with canonical Chainlink ETH/USD. It requires:

- Samples 1–20 minutes apart; 50-tick/minute movement clamp, bounded to 20 minutes.
- Sampled depth >=250 virtual ETH and LP fee10000; canonical manager chain/runtime; initialized pool. The depth screen is a liveness condition, not an economic security bound.
- 48h cold start (24h warm-up +24h window); lower of 2h/24h sampled geometric means ending at the latest sample, with zero time weight for that newest observation.
- Latest sample age <=20m, raw-to-clamped lag <=2000 ticks, no gap/illiquid time intersecting either window, and current initialization/fee checks.
- Pinned ETH/USD proxy, 8 decimals, positive/coherent completed round, ordered/nonfuture timestamps, <=90m freshness and $1M ETH/USD sanity ceiling.

This reference is **sampled**, not continuous authenticated pool history or a built-in Uniswap v4 TWAP. A genuine 2x IMD move can cause roughly 100 minutes of unavailability under the tested cadence, and full reflection can take 24h. A gap >20m requires 24h of clean history for recovery. Removing UNLK timers does not remove this latency or any reference check.

Someone must operate and pay Ethereum gas for permissionless `sample()` calls. The tested 5m cadence gives 288 samples/day; the minimum 20m cadence gives 72, and 1m gives1440. Keep margin below20m. Execution gas and excluded base transaction gas are recorded in the fork log; compute ongoing cost as `(sample execution gas + transaction overhead) * samples/day * actual gas price`. No zero-gas promise, paid API/oracle request, subscription, mandatory signer, attester or per-block proof collector is introduced. Automatic gate evaluation adds reference-read gas to successful swaps until final bypass. The source is not automatically sampled by a UNLK swap.

Invalid reference data prevents **new gate advancement only**. Already-open rights, within-quota swaps, transfers and native claims remain available. Activation still requires a valid reference; a cold source cannot activate. A ready public sampler/gas sponsor and complete clean production history are release operations, not facts established by a local time-travel test.

## Preserved boundaries and findings

Standard pinned Universal Router execution with empty hookData, legitimate smart accounts, 1B/18-decimal UNLOCK/UNLK, 10/87/3 allocation, 1.25% official input LP fee, additional 0.75% executed-IMD treasury fee, fixed beneficiary, locked principal, unrestricted transfers and native independent claims are preserved. No upgrade, pause, reset, exemption, admin price/rule change, or live deployment edit was added.

The router authenticates the initiating **account**, not beneficial users behind a shared executor, funding sources or eventual TAKE recipients. **H-01 remains High**: mature shared capacity can be consumed by another user supplying their own tokens. The optional single-wallet executor reduces exposure only for its integration; it cannot globally isolate users of arbitrary shared accounts.

**External-reference manipulation remains a separate High.** Repeated manipulated IMD/ETH samples can ratchet the sampled source and sustained manipulation passes its windows. Conditional fee/LP-recapture models demonstrate limitations, not verified realizable mainnet profit. The accepted UNLK spot-spike rule does not waive this reference finding, wrong-pool attribution, broken accounting or H-01. All are reassessed in [the consolidated handoff](HANDOFF.md).
