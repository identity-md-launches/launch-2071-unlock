// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ImdSampledUsdSource} from "../../src/mainnet/ImdSampledUsdSource.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {MainnetRuntime} from "./MainnetRuntime.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";

/// @notice Sampled IMD/ETH source against the ACTUAL pinned PoolManager runtime, with pool storage written to
/// model states. Pool state values are SYNTHETIC except the recorded block-26203792 tick/liquidity anchor.
contract SampledOracleTest is Test {
    ImdSampledUsdSource internal source;
    // Recorded at Ethereum block 26203792 (docs/mainnet/revision/market-evidence.json).
    int24 internal constant REAL_TICK = 58773;
    uint128 internal constant REAL_LIQUIDITY = 11803017312680583666866;
    int256 internal constant ETH_USD = 245269414514; // recorded Chainlink answer, 8 decimals
    uint256 internal constant FEE_PPM = 10990; // 1% LP + 0.1% protocol, combined as v4 does
    uint256 internal constant SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        vm.roll(30_000_000);
        vm.etch(MainnetPins.MANAGER_ADDRESS, MainnetRuntime.manager());
        vm.etch(MainnetPins.ETHUSD_ADDRESS, MainnetRuntime.ethUsd());
        source = new ImdSampledUsdSource();
        _pool(REAL_TICK, REAL_LIQUIDITY, 10000);
        _feed(ETH_USD, block.timestamp);
    }

    // ------------------------------------------------------------------ helpers

    function _pool(int24 tick, uint128 liquidity, uint24 lpFee) internal {
        bytes32 slot = keccak256(abi.encode(source.POOL_ID(), uint256(6)));
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(tick);
        vm.store(
            MainnetPins.MANAGER_ADDRESS,
            slot,
            bytes32(
                uint256(sqrtPrice) | (uint256(uint24(tick)) << 160) | (uint256(0x3e83e8) << 184)
                    | (uint256(lpFee) << 208)
            )
        );
        vm.store(MainnetPins.MANAGER_ADDRESS, bytes32(uint256(slot) + 3), bytes32(uint256(liquidity)));
    }

    function _feed(int256 answer, uint256 updated) internal {
        vm.mockCall(MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(8)));
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(7), answer, updated, updated, uint80(7))
        );
    }

    function _step(uint256 dt) internal {
        vm.warp(block.timestamp + dt);
        vm.roll(block.number + dt / 12 + 1);
    }

    /// Honest keeper: samples the unmanipulated pool every `dt` for `duration`.
    function _honest(int24 tick, uint256 dt, uint256 duration) internal {
        _pool(tick, REAL_LIQUIDITY, 10000);
        for (uint256 t; t < duration; t += dt) {
            _step(dt);
            source.sample();
        }
        _feed(ETH_USD, block.timestamp);
    }

    function _warm(int24 tick) internal {
        source.sample();
        _honest(tick, 5 minutes, 48 hours);
    }

    function _ethPerImd(int24 tick) internal pure returns (uint256) {
        uint160 s = TickMath.getSqrtPriceAtTick(-tick);
        return uint256(s) * s / (1 << 96) * 1e18 / (1 << 96);
    }

    /// Fee-only in-range round trip: ETH in to move IMD-per-ETH tick from `fromTick` down to `toTick` at constant L,
    /// then sell back. Price impact is recovered; LP+protocol fees on both legs are lost. Excludes gas/MEV payments.
    function _flashCostEth(int24 fromTick, int24 toTick, uint128 liquidity, uint256 feePpm)
        internal
        pure
        returns (uint256 ethIn, uint256 cost)
    {
        ethIn = SqrtPriceMath.getAmount0Delta(
            TickMath.getSqrtPriceAtTick(toTick), TickMath.getSqrtPriceAtTick(fromTick), liquidity, true
        );
        cost = ethIn * feePpm / (1e6 - feePpm) + ethIn * feePpm / 1e6;
    }

    function _usd(uint256 eth) internal pure returns (uint256) {
        return eth * uint256(ETH_USD) / 1e8 / 1e18;
    }

    // ------------------------------------------------------------------ availability and direction

    function testColdStartWarmupDirectionAndDecimals() public {
        source.sample();
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _honest(REAL_TICK, 5 minutes, 47 hours);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _honest(REAL_TICK, 5 minutes, 1 hours);
        uint256 price = source.priceUsd();
        // tick 58773 is ~357 IMD per ETH, so one IMD is ~1/357 ETH; NOT ~357 ETH.
        uint256 expected = _ethPerImd(REAL_TICK) * uint256(ETH_USD) / 1e8;
        assertApproxEqRel(price, expected, 1e14, "IMD/USD = ETH/USD divided by IMD-per-ETH");
        assertGt(price, 6 ether);
        assertLt(price, 8 ether);
        (uint256 spotUsd, uint256 spotEthPerImd, int24 tick, uint256 virtualEth, uint256 ethUsd) =
            source.spot();
        assertEq(tick, REAL_TICK);
        assertApproxEqRel(spotUsd, price, 1e14);
        assertApproxEqRel(spotEthPerImd, _ethPerImd(REAL_TICK), 1e14);
        assertApproxEqRel(virtualEth, 624.893 ether, 1e15, "recorded active virtual ETH");
        assertEq(ethUsd, uint256(ETH_USD) * 1e10);
    }

    function testSameBlockAndTooFrequentSamplesRejected() public {
        source.sample();
        vm.expectRevert(ImdSampledUsdSource.TooSoon.selector);
        source.sample();
        vm.warp(block.timestamp + 59);
        vm.expectRevert(ImdSampledUsdSource.TooSoon.selector);
        source.sample();
        vm.warp(block.timestamp + 1);
        source.sample();
        assertEq(source.observationCount(), 2);
    }

    function testUninitializedPoolWrongChainAndWrongManagerFailClosed() public {
        vm.store(
            MainnetPins.MANAGER_ADDRESS,
            keccak256(abi.encode(source.POOL_ID(), uint256(6))),
            bytes32(uint256(0))
        );
        vm.expectRevert(ImdSampledUsdSource.PoolUnavailable.selector);
        source.sample();
        _pool(REAL_TICK, REAL_LIQUIDITY, 10000);
        vm.chainId(11155111);
        vm.expectRevert(ImdSampledUsdSource.PoolUnavailable.selector);
        source.sample();
        vm.chainId(1);
        vm.etch(MainnetPins.MANAGER_ADDRESS, hex"00");
        vm.expectRevert(ImdSampledUsdSource.PoolUnavailable.selector);
        source.sample();
    }

    function testGapVoidsWindowsUntilFullCleanLongWindow() public {
        _warm(REAL_TICK);
        assertGt(source.priceUsd(), 0);
        _step(21 minutes);
        source.sample();
        _feed(ETH_USD, block.timestamp);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _honest(REAL_TICK, 5 minutes, 23 hours + 55 minutes);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _honest(REAL_TICK, 5 minutes, 10 minutes);
        assertGt(source.priceUsd(), 0, "recovers only after 24h without any gap");
    }

    function testThinPoolOrChangedFeeIsRecordedIlliquid() public {
        _warm(REAL_TICK);
        _pool(REAL_TICK, REAL_LIQUIDITY / 3, 10000); // ~208 virtual ETH < 250 screen
        _step(5 minutes);
        source.sample();
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _honest(REAL_TICK, 5 minutes, 5 minutes);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd(); // the thin interval is inside both windows
        _honest(REAL_TICK, 5 minutes, 24 hours);
        assertGt(source.priceUsd(), 0);
        _pool(REAL_TICK, REAL_LIQUIDITY, 3000);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    function testStaleLatestSampleNeverExtrapolated() public {
        _warm(REAL_TICK);
        vm.warp(block.timestamp + 21 minutes);
        _feed(ETH_USD, block.timestamp);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    function testChainlinkValidation() public {
        _warm(REAL_TICK);
        uint256 good = source.priceUsd();
        _feed(ETH_USD, block.timestamp - 91 minutes);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(0, block.timestamp);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(ETH_USD, block.timestamp + 1);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(7), ETH_USD, block.timestamp, block.timestamp, uint80(6))
        );
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(ETH_USD, block.timestamp);
        vm.mockCall(MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(ETH_USD / 2, block.timestamp);
        assertApproxEqRel(source.priceUsd(), good / 2, 1e12, "no USD peg: ETH/USD moves IMD/USD");
        vm.etch(MainnetPins.ETHUSD_ADDRESS, hex"00");
        vm.expectRevert();
        source.priceUsd();
    }

    function testHonestMoveDelayIsExplicit() public {
        _warm(REAL_TICK);
        uint256 before = source.priceUsd();
        // A genuine 2x IMD rise (IMD-per-ETH tick down 6932) arrives at once.
        int24 moved = REAL_TICK - 6932;
        _pool(moved, REAL_LIQUIDITY, 10000);
        _step(5 minutes);
        source.sample();
        _feed(ETH_USD, block.timestamp);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd(); // lag 6682 > 2000: unavailable, not misreported
        uint256 waited;
        while (true) {
            _step(5 minutes);
            waited += 5 minutes;
            source.sample();
            _feed(ETH_USD, block.timestamp);
            try source.priceUsd() returns (uint256) {
                break;
            } catch {}
        }
        console2.log("honest 2x move: minutes unavailable", waited / 60 + 5);
        assertLe(waited, 105 minutes);
        _honest(moved, 5 minutes, 24 hours);
        assertApproxEqRel(
            source.priceUsd(), before * 2, 1e16, "near-full reflection only after the 24h window"
        );
    }

    // ------------------------------------------------------------------ manipulation demonstrations

    /// Flash/same-block: push spot 5000 ticks, sample, restore in the same block.
    function testFlashSameBlockSampleIsClampedAndHasNoImmediateWeight() public {
        _warm(REAL_TICK);
        uint256 honest = source.priceUsd();
        _step(5 minutes);
        _pool(REAL_TICK - 5000, REAL_LIQUIDITY, 10000);
        int24 recorded = source.sample();
        _pool(REAL_TICK, REAL_LIQUIDITY, 10000);
        assertEq(recorded, REAL_TICK - 250, "5 min elapsed: at most 250 ticks recorded");
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd(); // lag 4750: grief = unavailability until the next sample, not a false price
        _honest(REAL_TICK, 1 minutes, 10 minutes);
        uint256 afterFlash = source.priceUsd();
        assertGe(afterFlash, honest);
        assertLt(afterFlash, honest * 10_005 / 10_000, "one flash moves the conservative price < 0.05%");
        (uint256 ethIn, uint256 cost) = _flashCostEth(REAL_TICK, REAL_TICK - 5000, REAL_LIQUIDITY, FEE_PPM);
        console2.log("flash 5000 ticks: ETH in", ethIn / 1e18, "fee cost USD", _usd(cost));
    }

    /// Checkpoint-timed and repeated: attacker is the SOLE sampler, flashes at every 20-minute sample.
    /// The clamp is rate-limited, not a barrier: the recorded tick ratchets 1000 ticks per sample.
    function testCheckpointTimedRepeatedFlashRatchetsAndItsCost() public {
        _warm(REAL_TICK);
        uint256 honest = source.priceUsd();
        int24 target = REAL_TICK - 6932; // 2x IMD price
        uint256 samples;
        uint256 totalCost;
        uint256 elapsed;
        while (elapsed < 27 hours) {
            _step(20 minutes);
            elapsed += 20 minutes;
            _pool(target, REAL_LIQUIDITY, 10000);
            int24 recorded = source.sample();
            _pool(REAL_TICK, REAL_LIQUIDITY, 10000);
            (, uint256 cost) = _flashCostEth(REAL_TICK, recorded, REAL_LIQUIDITY, FEE_PPM);
            totalCost += cost;
            ++samples;
        }
        _feed(ETH_USD, block.timestamp);
        uint256 manipulated = source.priceUsd();
        assertApproxEqRel(manipulated, honest * 2, 2e15, "repeated flashes alone fully pass both windows");
        console2.log("sole-sampler 2x: samples", samples, "fee cost USD", _usd(totalCost));
        // With honest per-minute sampling every honest sample must also be sandwiched: 20x the count.
        (, uint256 perSample) = _flashCostEth(REAL_TICK, target, REAL_LIQUIDITY, FEE_PPM);
        console2.log("per-sample 2x flash fee USD", _usd(perSample));
        console2.log("24h at 1-minute honest cadence USD", _usd(perSample * 1440));
        console2.log(
            "24h, attacker-owned LP recaptures 1% LP fee, USD", _usd(perSample * 72 * 1000 / FEE_PPM)
        );
    }

    /// Honest frequent sampling that the attacker does not sandwich pulls the recorded value back as fast as the
    /// attacker can push it, so the attack fails unless every honest sample is also manipulated.
    function testUnsandwichedHonestSamplesNeutralizeAlternatingFlashes() public {
        _warm(REAL_TICK);
        uint256 honest = source.priceUsd();
        for (uint256 i; i < 26 * 30; ++i) {
            _step(1 minutes);
            _pool(REAL_TICK - 6932, REAL_LIQUIDITY, 10000);
            source.sample();
            _pool(REAL_TICK, REAL_LIQUIDITY, 10000);
            _step(1 minutes);
            source.sample();
        }
        _feed(ETH_USD, block.timestamp);
        uint256 price = source.priceUsd();
        assertLt(price, honest * 1005 / 1000, "alternating honest samples cap the ratchet at 50 ticks");
    }

    /// Sustained: the pool itself is held at 2x for the full warm-up of both windows. Indistinguishable from a real
    /// market move; passes in full. This is the executable limitation, not a defended case.
    function testSustainedManipulationPasses() public {
        _warm(REAL_TICK);
        uint256 honest = source.priceUsd();
        _honest(REAL_TICK - 6932, 5 minutes, 27 hours);
        assertApproxEqRel(source.priceUsd(), honest * 2, 2e15);
    }

    /// Anchor attack: the very first sample is flashed far away. Lag keeps the price unavailable until the
    /// clamp converges; convergence completes inside the 24h warm-up, so windows never contain the anchor.
    function testFlashedAnchorConvergesBeforeAnyPriceIsServed() public {
        _pool(REAL_TICK - 40_000, REAL_LIQUIDITY, 10000);
        source.sample();
        _honest(REAL_TICK, 5 minutes, 48 hours);
        uint256 expected = _ethPerImd(REAL_TICK) * uint256(ETH_USD) / 1e8;
        assertApproxEqRel(source.priceUsd(), expected, 1e14);
    }

    /// External-reference attack model, separate from accepted instantaneous UNLK spikes.
    /// FDV factors multiply. The sampled IMD/ETH attack still needs these repeated observations; the official
    /// UNLK/IMD leg now needs only an observed swap-boundary/current-state touch, not sustained/end-block state.
    /// This model measures sampled-leg fees only, not a realizable production round trip or exit profit.
    function testCrossPoolFactorsMultiplyAndNetProfitModel() public {
        _warm(REAL_TICK);
        uint256 imdUsd = source.priceUsd();
        // Suppose true FDV is $25M. A 2x sampled reference can cause an immediate $50M bypass.
        // The 27h below fills the unchanged external-reference windows; there is NO final gate delay.
        uint256 trueFdv = 25_000_000 ether;
        uint256 imdPerUnlk = trueFdv * 1e18 / SUPPLY * 1e18 / imdUsd;
        // Route A: 2x entirely on IMD/ETH (sampled leg).
        _honest(REAL_TICK - 6932, 5 minutes, 27 hours);
        uint256 fdvA = SUPPLY * imdPerUnlk / 1e18 * source.priceUsd() / 1e18;
        assertGe(fdvA * 1001 / 1000, 50_000_000 ether, "IMD/ETH leg alone can reach the final threshold");
        // Route B: sqrt(2) on each leg: half the IMD/ETH displacement.
        (, uint256 fullLeg) = _flashCostEth(REAL_TICK, REAL_TICK - 6932, REAL_LIQUIDITY, FEE_PPM);
        (, uint256 halfLeg) = _flashCostEth(REAL_TICK, REAL_TICK - 3466, REAL_LIQUIDITY, FEE_PPM);
        // Only an observed instantaneous UNLK/IMD touch is required by the clarified design. That accepted
        // spot move's cost and exit slippage are NOT measured here. Splitting lowers sampled-leg fee cost.
        assertLt(halfLeg, fullLeg / 2 + 1, "IMD/ETH-leg cost is convex in displacement");
        console2.log("per-sample fee USD: full 2x leg / sqrt2 leg", _usd(fullLeg), _usd(halfLeg));
        // Net profit model at the final bypass: attacker holds 2% of supply with zero E; bypass lets all of it sell.
        // Gross value at TRUE price (upper bound before exit slippage) vs. IMD/ETH-leg fee cost over 27h.
        uint256 holding = 20_000_000 ether;
        uint256 value = holding * trueFdv / SUPPLY;
        uint256 sole = _usd(fullLeg * 81); // 27h at the 20-minute minimum cadence
        uint256 lpOwned = _usd(fullLeg * 81 * 1000 / FEE_PPM);
        uint256 minuteCadence = _usd(fullLeg * 27 * 60);
        console2.log("bypass value of 2% holding USD", value / 1e18);
        console2.log("cost: sole sampler / attacker LP / per-minute honest cadence USD", sole, lpOwned);
        console2.log("cost per-minute honest cadence USD", minuteCadence);
        assertLt(
            lpOwned, value / 1e18, "UNSAFE: with LP fee recapture and sole sampling the attack nets profit"
        );
        assertGt(sole, value / 1e18, "a 2% holder paying full fees as sole sampler loses");
        console2.log("sole-sampler breakeven holding (UNLK)", sole * 1e18 / (trueFdv / 1e9));
        assertGt(minuteCadence, value / 1e18, "per-minute honest sampling raises fee cost above this value");
    }

    // ------------------------------------------------------------------ properties

    function testFuzzRecordedStepBoundedAndAccountingMonotone(int24[8] memory spots, uint16[8] memory gaps)
        public
    {
        source.sample();
        for (uint256 i; i < 8; ++i) {
            _checkStep(
                int24(bound(spots[i], REAL_TICK - 60_000, REAL_TICK + 60_000)), bound(gaps[i], 60, 3 hours)
            );
        }
    }

    function _checkStep(int24 spot, uint256 dt) internal {
        uint256 n = source.observationCount();
        (uint32 t0, int24 prevTick,, bool l0,, int56 c0, uint32 b0) = source.observations(n - 1);
        _pool(spot, REAL_LIQUIDITY, 10000);
        _step(dt);
        int24 recorded = source.sample();
        _checkRecorded(n, spot, dt, prevTick, recorded);
        (uint32 t1,,,,, int56 c1, uint32 b1) = source.observations(n);
        assertEq(t1, t0 + dt);
        assertEq(
            int256(c1), int256(c0) + int256(prevTick) * int256(dt), "previous sample weighted forward only"
        );
        assertEq(b1, b0 + (dt > 20 minutes || !l0 ? dt : 0), "gaps and illiquid intervals are bad time");
    }

    function _checkRecorded(uint256 n, int24 spot, uint256 dt, int24 prevTick, int24 recorded) internal view {
        (, int24 tick1, int24 spot1, bool liquid,,,) = source.observations(n);
        uint256 allowed = 50 * (dt < 20 minutes ? dt : 20 minutes) / 60;
        uint256 moved =
            recorded > prevTick ? uint256(int256(recorded - prevTick)) : uint256(int256(prevTick - recorded));
        assertLe(moved, allowed);
        assertEq(tick1, recorded);
        assertEq(spot1, spot);
        uint256 virtualEth = uint256(REAL_LIQUIDITY) * (1 << 96) / TickMath.getSqrtPriceAtTick(spot);
        assertEq(liquid, virtualEth >= 250 ether, "depth screen");
        // Exactly the spot when within reach; otherwise moves fully toward it.
        if (moved < allowed) assertEq(recorded, spot);
    }
}
