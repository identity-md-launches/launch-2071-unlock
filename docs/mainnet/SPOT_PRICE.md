# UNLOCK current-state price architecture

Status: current new-launch adaptation; no new public deployment or publication is claimed. Supplemental independent contributor reviews completed; the mandatory platform audit panel, publication and release approval remain pending. See `release/STATUS.json`, `release/REVIEW.md` and `release/VALIDATION.md` for this revision's evidence. This document supersedes historical sampler operations.

## What changed

```
UNLK/USD = official UNLK/IMD spot × existing IMD/ETH v4 spot × validated Chainlink ETH/USD
FDV      = 1,000,000,000 UNLK × UNLK/USD
```

- `src/mainnet/ImdSpotUsdSource.sol` (stateless, no constructor arguments; preserved from the imported source) is the only admitted price source
  (`ImdReviewedCode.PRICE_SOURCE` = keccak of its creation code). `priceUsd()` reads, at call time:
  - canonical PoolManager `0x000000000004444c5dc75cB358380D2e3dE08A90` (chain 1, pinned codehash);
  - IMD/ETH pool `0xb07d640f…abfb3`, preimage (native ETH, IMD `0xD34a…63B7`, fee 10000, tickSpacing 200, no hooks); the preimage is tested to hash to the id; IMD is currency1, so the pool price is IMD per ETH;
  - IMD pinned codehash and `decimals() == 18` (native ETH is 18);
  - slot0 `sqrtPriceX96 != 0`, `lpFee == 10000`, in-range liquidity `!= 0`;
  - Chainlink ETH/USD `0x5f4e…8419`: pinned codehash, `decimals() == 8`, `answer > 0` and ≤ $1,000,000, `roundId != 0`, `startedAt != 0`, `startedAt ≤ updatedAt ≤ now`, `answeredInRound ≥ roundId`, age ≤ 90 minutes.
  - Result: `floor(ethUsd·1e10 · 2^192 / sqrtPriceX96²)` via exact 512-bit `ImdSpotMath` (both currency orders supported; no overflow over the whole TickMath domain; a zero floor reverts).
- `UnlkImdOracle` multiplies by the official UNLK/IMD `sqrtPriceX96` with the same exact math in either order, and keeps its seed-range/liquidity/LP-fee validity checks. The reproduced protocol-fee availability defect is repaired: core-accounted protocol fees no longer invalidate the pool or pause trades. The fixed LP fee remains12500 and the extra IMD treasury fee remains75bps; see `ADAPTATION.md` for the external protocol share's effect on gross fee percentages.
- Removed from the active path: `sample()`, observations, 48h warm-up, 2h/24h windows, tick-rate clamps, lag/gap rules, the 250-virtual-ETH screen and the keeper. `ImdSampledUsdSource` and its tests stay in the tree as **historical**; `deployPriceSource` rejects its code.
- Activation (`configureAndActivate`) still requires `priceUsd()` to succeed once, i.e. a valid current reference — no elapsed time or observation count.
- Rounding is always down at each step (IMD/USD to 1e-18 USD, then FDV), so rounding can delay but never advance a gate; the error is below 1e-9 USD of FDV per unit ratio.

## Accepted economics (requester decision, not a fix)

Instantaneous manipulation of **either** pool — the official UNLK/IMD pool or the external IMD/ETH pool — including same-transaction/flash manipulation, can open gates early and **permanently**, including the **$50M global bypass**. No manipulation resistance is claimed. Attack tests that demonstrate this are kept (`test/mainnet/OneWayGates.t.sol`, `test/mainnet/SpotOracle.t.sol::testManipulatedSpotMovesPriceImmediately`, `test/ManipulationEconomics.t.sol`). Previously accepted shared-executor quota pooling remains disclosed (`test/mainnet/SharedExecutorReview.t.sol`).

## Preserved

Sixteen gates 20%→100%, permanent highest-crossed tier, $50M bypass, cumulative E/S (1000 / 200 at 20% / only 100 more at 30%), one-block buy maturity, 10/87/3 allocation, 1.25% pool fee, 0.75% IMD treasury fee, beneficiary, principal protection, claims, transfers, sealed configuration, standard Universal Router compatibility, sale-before-post-swap gate ordering. Invalid reference data only withholds NEW advancement (`try oracle.fdvUsd()` in the hook); trading, transfers and native claims continue.

## Remaining defects / requirements (not covered by risk acceptance)

- Mandatory platform adversarial panel of the final published revision: **pending**. Supplemental independent review is complete and is not a platform certificate.
- Hook bytecode changed (new `PRICE_SOURCE` commitment): the hook CREATE2 salt must be re-mined against the final init code (`scripts/mine-hook.sh` / `scripts/mainnet/mine.mjs` with `docs/mainnet/ARTIFACTS.json`).
- Candidate UI and historical website bundles are preserved from the imported source; this assignment does not publish a website.
- Public RPC availability and ordinary gas for deployment, trades and `checkpoint()` remain. No periodic price-recording transaction is needed.
- Chainlink staleness (>90 min) or an emptied IMD/ETH pool pauses new gate advancement until valid again.

## Deployment checklist (current)

1. Re-run `forge build`, `python3 scripts/mainnet/artifacts.py --check`, `forge test`, `forge fmt --check`.
2. Complete platform admission/panel/publication; establish the actual owner transaction package and actual-tree rehearsal before stage1. Mine the hook salt for final `UnlkImdHook` initcode and actual constructor addresses; only the verified factory release service sends stage1 (`script/mainnet/PrepareImdLaunch.s.sol`).
3. Prepare verified wallet envelopes with `script/mainnet/PrepareOwnerTransactions.s.sol`; owner signs the returned `deployPriceSource` call to the actual hook.
4. Owner signs `deployCompanions` and the complete actual round0 certification sequence. Large trees use bounded chunks; see `release/OPERATIONS.md`.
5. Confirm `ImdSpotUsdSource.priceUsd()` returns a value at the current block (fresh Chainlink, live IMD/ETH pool).
6. Owner calls `configureAndActivate(evidence, oracle, launchNumber)` — immediately; no warm-up or keeper.
7. No sampler/keeper operations. Anyone may call `checkpoint()` to persist a gate.

## Current validation and historical evidence

Current results and mandatory fuzz seed are in `release/VALIDATION.md`; actual paid request and service evidence are in `release/network/`. The final-code rehearsal uses block26210931 and the wallet-call builder. It is a simulation, not a public deployment.

The following are preserved **historical imported results**, not this revision's release evidence:

- `forge test` (fuzz seed `0x3cd71f9b…19ed`): see `docs/mainnet/spot-results/forge-test-summary.txt`.
- Recorded-block fork, block 26204722, actual factory/PoolManager/Universal Router/Permit2/IMD/IMD-ETH pool/Chainlink, `bash scripts/unlock-gates/fork.sh https://eth.drpc.org`: activation in the recorded block with no warp and no price mock; recorded IMD/USD 6.818840237269049093; normal trades, quota rejection, fees, irreversible gates, both token orders. Output: `docs/mainnet/spot-results/recorded-block-fork.txt`. (Gate-boundary cases inside that suite substitute reference fixtures after activation, as labelled in the file.) publicnode.com now refuses archive reads for that block; drpc was used.
