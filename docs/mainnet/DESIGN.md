> Current revision (2026-10-16): Current one-way gate design and accounting are in [../unlock-gates/DESIGN.md](../unlock-gates/DESIGN.md). The historical UNLK TWAP/sequential confirmation rules below are superseded.

> Revision notice (2026-10-16): the historical report below describes the previous mainnet delivery. Current implementation, evidence and limits are in [revision/H-01.md](revision/H-01.md). The inactive v3 reader is no longer admitted; buy-credit maturity is now explicit. Historical results are not final-source certification.

# Ethereum UNLK/IMD candidate — blocked, undeployed

Base: `806e94d44d6a96b8561f48ebf5f744c4065c4918`. Public GitHub commit discovery found no newer accepted commit. Existing contracts, release records, dependency files, live launch1560 configuration, gallery, and old frontend trading paths are retained. New Solidity lives in `src/mainnet/`; this is source preparation, not a replacement/re-mint of a live token. New candidate writes are disabled.

## Identity, admission and custody

`UnlkImdHook` keeps the factory's four-word constructor `(PoolManager, UnlkToken, launchFactory, setupAuthority)`, permissions `0x3fcc`, immutable setup and no owner upgrade, pause, reset, fee setter, arbitrary calls, principal withdrawal or swap exemption. Constructor validation makes no external calls. At initialization and staging, Ethereum chain ID 1, mainnet service addresses and runtime hashes are checked. Sepolia is rejected. Runtime evidence is from block **26203203**; exact bytes live in `test/mainnet/MainnetRuntime.sol` and hashes in `network/mainnet.json`. The factory, registry and fees are checked independently, not through ETH-pair assumptions. Chainlink proxy and IMD runtime identity are pinned; metadata and service ownership are external trust assumptions, not powers of this hook.

The official key contains the new UNLK and canonical IMD `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7`, numerically sorted, fee **12500**, spacing **60**. Either token order works. The fixed token is UNLOCK/UNLK, 1 billion, 18 decimals, one factory mint; 10/87/3 allocations and original provenance accounting remain. Ordinary token transfers are unrestricted and transfer no quota rights. Distributor claims do not call this hook; proof synchronization and payer credit are deduplicated.

IMD has 18 decimals at the recorded block. Its verified `BridgedFP` source inherits the ordinary OpenZeppelin ERC20 transfer path without transfer tax, rebase, blacklist or `_update` override. LayerZero OFT bridge mint/burn and owner metadata/peer configuration remain IMD external risks. The new hook neither owns nor mints IMD. Actual-runtime/fork tests use local balance funding, never public token minting.

## Fee and settlement modes

The official **1.25% LP input fee** stays intact. Actual factory code pays 80% of collected fees to the current recorded requester and 20% to the current IMD fee recipient: the nominal 1% / 0.25% entitlement. **Payout assets are the collected currencies themselves**: IMD fees from buys, UNLK fees from sells. There is no ETH conversion. Rounding occurs first at v4 swap steps, then requester share `floor(collected*8000/10000)`; network receives the remainder. The network can change its recipient and the requester can assign its fee entitlement through the existing factory. These external official powers are not new hook powers. Principal stays locked; zero-liquidity-delta fee collection returns no hook delta.

Let `f(x)=floor(x*75/10000)` in raw IMD units. The extra fixed 75 bps treasury fee uses the **executed pool IMD leg**, not nominal volume or UNLK value. Sorting selects `delta.amount1` if UNLK is currency0, else `delta.amount0`. It continues after final unlock.

| Mode | User IMD amount | Pool IMD leg and treasury fee | Delta / limit |
| --- | --- | --- | --- |
| Exact-input buy | Gross budget G | Largest B with B+f(B)<=G; fee G-B | Positive specified beforeSwap delta reduces pool input; maximum settlement is G; minimum UNLK output uses fee-inclusive quote |
| Exact-output buy | Actual amount charged | Executed pool input B; fee f(B), total B+f(B) | Positive unspecified afterSwap delta; maximum IMD input includes treasury fee |
| Exact-input sell | Net IMD received | Executed pool output B; fee f(B), net B-f(B) | Positive unspecified afterSwap delta; minimum IMD output is net |
| Exact-output sell | Exact desired net N | Smallest B with B-f(B)>=N; fee B-N | Positive specified beforeSwap delta increases required gross pool output; maximum UNLK input uses fee-inclusive quote |

Specified-mode rounding exceeds `f(B)` by at most **one raw IMD unit** (1e-18 IMD); unspecified modes floor. Quoter paths return the same amounts as execution. Both fees have different bases on sells and fee-inclusive buys: **do not advertise an exact effective 2%**. Unused exact-output IMD budgets remain with the payer when SETTLE_ALL pulls actual debt; native value is zero.

Only complete fills that end inside the locked seed range settle. Specified fees are tentatively calculated before execution, then the hook requires the exact adjusted specified leg. Partial fills, range exits, slippage, insufficient funding, quota violations or later batch failures revert the entire operation, including pool movement, E/S, oracle observations, claims and accrual. There is no fee on unexecuted volume. At the initial token-only boundary, sells need liquidity created by prior buys; a quota alone does not make an exit executable.

For settled fees, PoolManager mints IMD ERC-6909 claims (`id=uint160(IMD)`) directly to `ImdFeeVault`; accrual requires actual outstanding receipts. Anyone may redeem pending fee claims to the vault, burning claims and checking exact IMD received. Only immutable beneficiary `0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9` can withdraw, only to itself. SafeERC20 and exact sender/recipient balance checks reject non-delivery. Reentrancy guard and effects-before-interactions protect redemption and withdrawals. Fee accrued/redeemed/withdrawn, pending claims and claimable receipts are separate from IMD donations and donated manager claims. UNLK and other accidental tokens have no recovery path. LP fees never enter this accounting. No conversion, NFT purchase, marketplace, listing or burn is implemented.

## Rights and milestones

Only the **exact pinned mainnet Universal Router runtime** may execute, with initiator `router.msgSender()`; only the exact pinned Quoter may simulate with quota bypass, and that Quoter necessarily reverts its unlock callback. No `tx.origin`, claimed final recipient, token-source inference or hookData authentication. E is credited to initiator on actual buys, S consumed by initiator on actual sells. Q=max(0,floor(E*p/10000)-S). Generic quotes are not wallet authorization. Shared executors pool rights: **independently confirmed High, release-blocking**, not waived by design authorization. See `INDEPENDENT_REVIEW.md` and the delivered proof `test/mainnet/SharedExecutorReview.t.sol`.

Initial p=20%. Sequential USD thresholds are 100K/250K/500K/1M/2M/3.5M/5M/7.5M/10M/15M/20M/25M/30M/35M/40M/50M, each adding 5%. UNLK/IMD uses a 2h time-weighted normalized tick, 6h sequential confirmations, 24h final confirmation, minimum 4m cadence, maximum 10m valid-sample gap. Final unlock permanently bypasses quota for everyone. Invalid pricing does not advance or revoke rights; a later valid sample after an excessive gap restarts only pending confirmation. Full ladder reachability and post-unlock fees are tested without altered thresholds. No ETH seed-value floor remains: the quote-capacity check is one representable raw IMD unit, and locked UNLK principal/liquidity checks remain. Additional IMD-source conditions are explicit in `ORACLE_EVIDENCE.md`.

## External operational trust

The hook has no pause or administrator after activation, but external protocol behavior still matters. PoolManager governance setting a nonzero protocol fee makes swaps fail closed to preserve the promised fee structure; it does not revoke earned rights or stop ordinary token transfers/native claims. Factory/registry/fee service identities, router/Quoter/Permit2 runtime pins, Chainlink proxy governance, IMD OFT bridge configuration and oracle venue depth must be monitored by the eventual operator. A runtime change cannot be accommodated by a setter in this immutable bundle; it requires a separate reviewed design, never an unreviewed pin edit or bypass. The setup authority is responsible for exact preactivation evidence, while the beneficiary alone controls withdrawal of its accounted IMD revenue/donations.
