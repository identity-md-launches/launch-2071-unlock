# Candidate economics and immutable rules

This document describes undeployed candidate code. Historical deployed contracts retain their original rules. Standard-router attribution and independent review block release; see [COMPATIBILITY](COMPATIBILITY.md).

## Supply and eligibility

The unchanged `UnlkToken` is UNLOCK / UNLK, 18 decimals, with exactly 1,000,000,000 tokens minted once to its deploying factory. Policy allocation is 10% swarm, 87% pool, 3% payer. The hook verifies actual factory/distributor/seed records and the token's immutable allocation receipts. It preserves the accepted liquidity-rounding allowance (pool at least 861,300,000 tokens); any remainder dust does not increase the payer's fixed 30,000,000 eligibility.

For each wallet, E is the sum of proven official buys actually delivered through the authenticated route, its proven initial payer allocation, and proven actual native distributor claims. It is a cumulative ledger, not wallet balance. The inherited evidence mechanism authenticates funded roots and checks real claims, including pre-activation claims, with deduplication. A transfer made before payer sync does not transfer the payer's rights. Repeated sync or replay adds nothing. Sales update S by **executed** token input, not requested maximum.

Before permanent unlock, `Q = max(0, floor(E * p / 10000) - S)`; sellable amount is `min(wallet balance, Q)`. Incoming/outgoing ordinary transfers, gifts, donations and liquidity movements create, move and reset no eligibility. Ordinary ERC-20 transfers and native eligible claims remain unrestricted. At the last tier every wallet permanently bypasses the quota, even with E=0; balance remains a settlement requirement. S continues recording executed sales. There is no re-lock, pause, exemption, upgrade, fee setter or post-activation configuration switch.

## Native ETH treasury fee

The official LP fee remains **12500** millionths (1.25% input fee). The factory allocation remains 80% of LP fees to the payer and 20% to IMD, nominally 1% and 0.25% of pool input. A later nonzero PoolManager protocol fee or a changed LP fee makes candidate swaps revert rather than silently altering this policy. The external protocol fee controller can therefore halt this official pool's trading.

Let B be the absolute **executed native ETH pool leg**, as reported before the hook's additional fee. For buys it includes the pool's ordinary input fee; for sells it is the pool's ETH output after the AMM's token-input fee and price impact. The extra fee is `F(B) = floor(B * 75 / 10000)` wei, charged on buys and sells and still charged after full unlock.

| Mode | Public request | Pool request / final settlement |
| --- | --- | --- |
| Buy, exact input | Gross ETH budget G | Largest B with `B + F(B) <= G`; actual spending is executed B plus F(B); output is executed UNLK |
| Buy, exact output | Exact UNLK output T | Pool computes ETH input B; caller pays `B + F(B)` within maxInput |
| Sell, exact input | UNLK input T | Pool computes ETH output B; caller receives `B - F(B)` within minOutput |
| Sell, exact output | Exact **net ETH** N | Smallest B with `B - F(B) = N`; pool computes required UNLK within maxInput |

For integer wei, `buyPoolInput(G)` starts with `floor(G*10000/10075)` and increments once if it fits; `sellGrossOutput(N)` is zero for zero N, otherwise `floor((N-1)*10000/9925)+1`. Router requests still reject zero swap amounts, zero minimum output, invalid bounds and expired deadlines. The router caps maxInput and positive exact-output requests at positive int128 range. A net ETH exact-output request must also have a fee-grossed pool output within positive int128 range; the router checks this before converting the signed pool amount. Executed v4 deltas impose the corresponding bounds on all modes. All exact-output requests require full execution and revert on partial delivery. Exact-input requests may partially fill at the price limit, subject to minOutput; the fee then uses only the executed leg. Any failed limit, quota, sourcing or delivery check reverts the entire trade and fee.

Unused ETH and net sell ETH become caller-owned `nativeCredit`; `withdrawNative()` pays that caller only. Unused input UNLK is returned immediately. Accrued native credit stays solvent and cannot be consumed by another trade or prefunding. No fee is assessed on refunds or withdrawal. The fee is not charged on generic quotes, transfers, liquidity, rewards, credit synchronization, or vault withdrawals. A floor-rounded fee can be zero for very small executed ETH legs.

Nominal 1.25% + 0.75% is **not necessarily a 2% effective cost**. Ignoring price impact and rounding, a gross buy budget provides pool pricing input approximately `G * (1-0.0125)/(1+0.0075)`, a 1.9851% reduction. A sale's two factors are `(1-0.0125)*(1-0.0075)`, a 1.990625% reduction, in addition to price impact. Pool fee and treasury fee are on different bases; neither expression is a guaranteed execution price.

## Settlement and vault solvency

Only `afterSwapReturnDelta` is enabled for fee accounting; `beforeSwapReturnDelta` stays disabled. For native-unspecified modes (buy exact output / sell exact input), a positive after-swap delta charges the router. For native-specified modes (buy exact input / sell exact output), v4 cannot adjust that currency through afterSwapReturnDelta. The experimental companion router explicitly settles the hook's native debt with `settleFor(hook)`. Unmodified Universal Router does not perform that step. There is no claim of standard compatibility for these modes.

Every executed fee mints an ERC-6909 native claim to `NftFeeVault`, then records backed accrual through its immutable hook. This avoids taking ETH before the current buy has settled on a fresh, token-only manager. At unlock completion all router/hook deltas must net to zero or v4 reverts. The vault has no ERC-20 recovery, principal access or LP-fee collection function.

Anyone can call `redeem()` after settlement. Its authenticated manager callback burns only accounted native claims and transfers exactly that amount to the vault. This may fail if manager settlement is currently locked or the claims cannot be redeemed; failure is atomic. The beneficiary is never called during a swap or redemption.

The immutable beneficiary on Sepolia is **0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9**. Only it may call `withdraw()` and payment goes only to itself. CEI and the reentrancy guard protect both fee and donation withdrawals. A rejecting beneficiary leaves funds and totals unchanged and cannot halt swaps. There is no redirect, arbitrary call target, owner fee switch, upgrade or marketplace function.

- `totalAccrued`: authenticated fee claims recorded over time.
- `pendingClaims = totalAccrued - totalRedeemed`: accounted manager claims awaiting redemption.
- `claimable = totalRedeemed - totalWithdrawn`: redeemed fee ETH currently withdrawable.
- `donations = ETH balance - claimable`: direct or forced native gifts, accounted separately.
- `donationsWithdrawn` and `totalDonations`: separate native donation history.
- `donatedClaims`: excess ERC-6909 claims transferred outside accrual. They are reported but not redeemed by this vault; do not send them.

Accrued, Redeemed, Withdrawn, DonationReceived and DonationWithdrawn events distinguish revenue and gifts. Forced ETH may arrive without a DonationReceived event; balance-derived donation accounting still captures it. Donations and unrelated fee transfers must never be marketed as hook revenue.

NFT acquisition is **manual after withdrawal**. Beneficiary possession of a mainnet NFT does not prove a fee-funded purchase, especially because treasury accrual is on Sepolia. No bridging, marketplace automation, listing management, worker, buyback, burn, yield or floor guarantee is implemented.

## All sixteen thresholds

Initial p is 2000 (20%). The sequential table uses USD FDV with 18 decimals:

| Tier | USD FDV | p | Confirmation |
| --- | ---: | ---: | --- |
| 1 | 100,000 | 2500 | 6 hours |
| 2 | 250,000 | 3000 | 6 hours |
| 3 | 500,000 | 3500 | 6 hours |
| 4 | 1,000,000 | 4000 | 6 hours |
| 5 | 2,000,000 | 4500 | 6 hours |
| 6 | 3,500,000 | 5000 | 6 hours |
| 7 | 5,000,000 | 5500 | 6 hours |
| 8 | 7,500,000 | 6000 | 6 hours |
| 9 | 10,000,000 | 6500 | 6 hours |
| 10 | 15,000,000 | 7000 | 6 hours |
| 11 | 20,000,000 | 7500 | 6 hours |
| 12 | 25,000,000 | 8000 | 6 hours |
| 13 | 30,000,000 | 8500 | 6 hours |
| 14 | 35,000,000 | 9000 | 6 hours |
| 15 | 40,000,000 | 9500 | 6 hours |
| 16 | 50,000,000 | 10000 | 24 hours; permanent bypass for everyone |

The unchanged reviewed oracle uses a two-hour tick TWAP, complete warm-up, same-block zero weighting, five-minute checkpoint freshness, Chainlink 8-decimal ETH/USD rounds with positive bounded answers, valid round ordering and at most 90-minute age. It requires valid in-range locked seed liquidity for the whole lookback, minimum liquidity 1e18 and opening-valued seed quote capacity of 17 ETH. That depth measure is **not current ETH reserves**.

Only one tier can advance at a time. Valid samples at least four minutes apart and no more than ten minutes apart sustain each confirmation. Faster calls add no confirmation time; a valid low-price sample resets only the pending tier. Invalid data advances nothing and revokes no earned rights; a subsequent valid sample determines whether the maximum-gap restart applies. Sixteen virtual-time confirmations take at least 114 hours after the price and warm-up conditions; tests use timestamp advancement, not real-time waiting.

These checks increase manipulation cost but do not prove resistance to a funded sustained-price attack, feed compromise, MEV or loss of liquidity in other venues. Historical manipulation-cost reports for the old ladder are not quantitative guarantees for this candidate. Anyone can submit checkpoints and milestone updates; a reliable operator must maintain the four-minute cadence and monitor oracle validity. Missing cadence can delay progress indefinitely without revoking earned tiers.

The distributor/treasury retains its existing powers to fund later reward rounds and allocate rewards. Certified actual claims add E, so these allocation powers matter economically. LP-fee entitlements can follow the existing factory's reassignment rules; they do not reassign the immutable initial payer's eligibility. Unrestricted transfers permit other pools and OTC trades that bypass this official pool's quota and NFT fee. Protected official-pool principal cannot be removed; zero-liquidity-delta LP fee collection remains available.
