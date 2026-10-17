// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {MainnetRuntime} from "./MainnetRuntime.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Current-state IMD/USD source against the ACTUAL pinned PoolManager/IMD/Chainlink runtimes, with pool
/// storage written to model states. Values are SYNTHETIC except the recorded block-26203792 tick/liquidity.
contract SpotOracleTest is Test {
    using PoolIdLibrary for PoolKey;

    ImdSpotUsdSource internal source;
    int24 internal constant REAL_TICK = 58773;
    uint128 internal constant REAL_LIQUIDITY = 11803017312680583666866;
    int256 internal constant ETH_USD = 245269414514;

    function setUp() public {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        vm.roll(30_000_000);
        vm.etch(MainnetPins.MANAGER_ADDRESS, MainnetRuntime.manager());
        vm.etch(MainnetPins.ETHUSD_ADDRESS, MainnetRuntime.ethUsd());
        vm.etch(MainnetPins.IMD_ADDRESS, MainnetRuntime.imd());
        vm.mockCall(MainnetPins.IMD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        source = new ImdSpotUsdSource();
        _pool(TickMath.getSqrtPriceAtTick(REAL_TICK), REAL_LIQUIDITY, 10000);
        _feed(7, ETH_USD, block.timestamp, block.timestamp, 7);
    }

    function _pool(uint160 sqrtPrice, uint128 liquidity, uint24 lpFee) internal {
        bytes32 slot = keccak256(abi.encode(source.POOL_ID(), uint256(6)));
        int24 tick = sqrtPrice == 0 ? int24(0) : TickMath.getTickAtSqrtPrice(sqrtPrice);
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

    function _feed(uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered) internal {
        vm.mockCall(MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(8)));
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(round, answer, started, updated, answered)
        );
    }

    function testPoolIdIsTheVerifiedPreimage() public view {
        PoolKey memory key = PoolKey(
            Currency.wrap(source.CURRENCY0()),
            Currency.wrap(source.CURRENCY1()),
            source.POOL_LP_FEE(),
            source.POOL_TICK_SPACING(),
            IHooks(source.POOL_HOOKS())
        );
        assertEq(keccak256(abi.encode(key)), source.POOL_ID());
        assertTrue(source.CURRENCY0() < source.CURRENCY1(), "native ETH sorts first");
        assertFalse(source.IMD_IS_0());
    }

    function testImmediateCurrentPriceNoHistoryNoSample() public view {
        uint256 price = source.priceUsd();
        uint160 s = TickMath.getSqrtPriceAtTick(REAL_TICK);
        // Exact floor(ethUsd*1e10 * 2^192 / s^2): IMD is currency1, so ETH per IMD = 2^192 / s^2.
        assertEq(price, Math.mulDiv(uint256(ETH_USD) * 1e10, 1 << 192, uint256(s) * s));
        assertGt(price, 6 ether, "tick 58773 ~ 357 IMD per ETH, so ~$6.9 per IMD");
        assertLt(price, 8 ether);
        (uint256 usd, uint256 ethPerImd, uint160 sqrtP, uint128 liq, uint256 ethUsd) = source.spot();
        assertEq(usd, price);
        assertEq(sqrtP, s);
        assertEq(liq, REAL_LIQUIDITY);
        assertEq(ethUsd, uint256(ETH_USD) * 1e10);
        assertApproxEqRel(ethPerImd * uint256(ETH_USD) / 1e8, price, 1e12);
    }

    /// Rounding is always down, so rounding can never open a gate early.
    function testFuzzExactFloorAndMonotonic(uint160 sqrtPrice) public {
        sqrtPrice = uint160(bound(sqrtPrice, TickMath.MIN_SQRT_PRICE, TickMath.MAX_SQRT_PRICE - 1));
        _pool(sqrtPrice, 1, 10000);
        uint256 base = uint256(ETH_USD) * 1e10;
        // Reference: exact 512-bit value via two mulDivs is only exact when s^2 fits; check bounds otherwise.
        try source.priceUsd() returns (uint256 price) {
            if (sqrtPrice <= type(uint128).max) {
                assertEq(price, Math.mulDiv(base, 1 << 192, uint256(sqrtPrice) * sqrtPrice));
            } else {
                uint256 lo = Math.mulDiv(
                    base, 1 << 128, Math.mulDiv(sqrtPrice, sqrtPrice, 1 << 64, Math.Rounding.Ceil)
                );
                assertGe(price, lo);
            }
            if (sqrtPrice < TickMath.MAX_SQRT_PRICE - 2) {
                _pool(sqrtPrice + 1, 1, 10000);
                try source.priceUsd() returns (uint256 higher) {
                    assertLe(higher, price, "more IMD per ETH never raises IMD/USD");
                } catch {}
            }
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), ImdSpotUsdSource.InvalidPrice.selector, "only a zero floor reverts");
        }
    }

    function testExtremeSqrtPricesDoNotOverflow() public {
        _pool(TickMath.MIN_SQRT_PRICE, 1, 10000);
        assertEq(
            source.priceUsd(),
            Math.mulDiv(uint256(ETH_USD) * 1e10, 1 << 192, uint256(TickMath.MIN_SQRT_PRICE) ** 2),
            "exact at the minimum price, far above every gate"
        );
        _pool(TickMath.MAX_SQRT_PRICE - 1, 1, 10000);
        // s^2 > 2^256: exact wide division floors to zero, which is not a price.
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    function testManipulatedSpotMovesPriceImmediately() public {
        uint256 honest = source.priceUsd();
        // A same-transaction swap that halves IMD-per-ETH doubles IMD/USD at once. ACCEPTED, NOT RESISTED.
        _pool(TickMath.getSqrtPriceAtTick(REAL_TICK - 6932), REAL_LIQUIDITY, 10000);
        assertApproxEqRel(source.priceUsd(), honest * 2, 1e15);
    }

    function testMissingPoolLiquidityFeeChainAndCodeFailClosed() public {
        _pool(0, REAL_LIQUIDITY, 10000);
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
        _pool(TickMath.getSqrtPriceAtTick(REAL_TICK), 0, 10000);
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
        _pool(TickMath.getSqrtPriceAtTick(REAL_TICK), REAL_LIQUIDITY, 3000);
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
        _pool(TickMath.getSqrtPriceAtTick(REAL_TICK), REAL_LIQUIDITY, 10000);
        source.priceUsd();

        vm.mockCall(MainnetPins.IMD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(6)));
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
        vm.mockCall(MainnetPins.IMD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));

        vm.chainId(11155111);
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
        vm.chainId(1);

        vm.etch(MainnetPins.IMD_ADDRESS, hex"00");
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
        vm.etch(MainnetPins.IMD_ADDRESS, MainnetRuntime.imd());

        vm.etch(MainnetPins.MANAGER_ADDRESS, hex"00");
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        source.priceUsd();
    }

    function testChainlinkValidation() public {
        uint256 t = block.timestamp;
        _feed(7, ETH_USD, t - 90 minutes, t - 90 minutes, 7);
        source.priceUsd(); // exactly at the freshness bound
        _feed(7, ETH_USD, t - 90 minutes - 1, t - 90 minutes - 1, 7);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd(); // stale
        _feed(7, 0, t, t, 7);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(7, -1, t, t, 7);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(7, ETH_USD, t, t, 6); // incomplete round
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(0, ETH_USD, t, t, 0);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(7, ETH_USD, 0, t, 7);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(7, ETH_USD, t, t + 1, 7); // future
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(7, 1_000_000e8 + 1, t, t, 7);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
        _feed(7, ETH_USD, t, t, 7);
        vm.mockCall(MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    function testNoSamplerSurfaceOrState() public {
        (bool ok,) = address(source).call(abi.encodeWithSignature("sample()"));
        assertFalse(ok, "no sample() maintenance");
        (ok,) = address(source).call(abi.encodeWithSignature("observationCount()"));
        assertFalse(ok, "no observation history");
        assertEq(vm.load(address(source), bytes32(0)), bytes32(0));
    }
}
