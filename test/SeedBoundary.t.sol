// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice The production seed is token-only: the factory's range is the pool's only liquidity. The router bounds
/// every swap's price limit to that range, so a sell that consumes the whole ETH reserve ends exactly at the
/// seed's upper boundary, the launch state, which the oracle classes liquid. Without the bound v4 walks the
/// price through the empty region to the caller's limit, the observation turns illiquid and milestone
/// confirmation is unreadable for a full window although nothing economic changed.
contract SeedBoundaryTest is SystemFixture {
    using StateLibrary for IPoolManager;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
    }

    function testSellThatDrainsTheReserveStopsAtTheSeedBoundary() public {
        _buy(alice, 0.05 ether);
        hook.syncPayer();
        uint256 quota = hook.remainingQuota(payer);
        assertGt(quota, 0);
        UnlkSwapRouter.SwapRequest memory request = _request(false, -int256(quota), quota);
        assertEq(request.sqrtPriceLimitX96, TickMath.MAX_SQRT_PRICE - 1, "the client passes v4's open limit");
        uint256 balanceBefore = token.balanceOf(payer);
        vm.prank(payer);
        (uint256 input, uint256 output) = router.swap(request);
        // The reserve was worth far less than the quota, so the sale filled partially and stopped at the boundary.
        assertLt(input, quota, "partial fill");
        assertGt(output, 0.049 ether, "the whole in-range ETH reserve was bought");
        assertEq(hook.sold(payer), input, "only the executed input counts as sold");
        assertEq(token.balanceOf(payer), balanceBefore - input);
        (uint160 sqrtPrice, int24 tick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(
            sqrtPrice, TickMath.getSqrtPriceAtTick(seedUpper), "price stops at the seed's upper boundary"
        );
        assertEq(tick, seedUpper);
        (,, bool liquid,,) = oracle.observations(oracle.observationCount() - 1);
        assertTrue(liquid, "the launch state is liquid");
        // A full window later the TWAP is readable: no illiquid seconds were recorded.
        _advance(oracle.WINDOW());
        oracle.checkpoint();
        assertGt(oracle.fdvUsd(), 0);
        hook.updateMilestone();
        // A buyer can trade again straight away, from the boundary.
        assertGt(_buy(bob, 0.01 ether), 0);
    }

    function testSellIntoAnEmptyReserveRevertsWithoutState() public {
        hook.syncPayer();
        uint256 nonceBefore = router.nonce();
        vm.prank(payer);
        vm.expectRevert();
        router.swap(_request(false, -1 ether, 1 ether));
        assertEq(hook.sold(payer), 0);
        assertEq(router.nonce(), nonceBefore);
        (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(sqrtPrice, TickMath.getSqrtPriceAtTick(seedUpper));
    }

    function testLimitsInsideTheRangeAreHonoured() public {
        _buy(alice, 1 ether);
        (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        uint160 target = uint160(uint256(sqrtPrice) * 10005 / 10000);
        assertLt(target, TickMath.getSqrtPriceAtTick(seedUpper));
        uint256 held = token.balanceOf(alice);
        UnlkSwapRouter.SwapRequest memory request = _request(false, -int256(held / 4), held / 4);
        request.sqrtPriceLimitX96 = target;
        vm.prank(alice);
        (uint256 input,) = router.swap(request);
        assertLt(input, held / 4, "the caller's tighter limit still applies");
        (uint160 after_,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(after_, target);
    }

    function testBuyLimitIsBoundedByTheSeedFloor() public {
        UnlkSwapRouter.SwapRequest memory request = _request(true, -1 ether, 1 ether);
        assertEq(request.sqrtPriceLimitX96, TickMath.MIN_SQRT_PRICE + 1);
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        (uint256 input, uint256 output) = router.swap{value: 1 ether}(request);
        assertEq(input, 1 ether);
        assertGt(output, 0);
        (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertGe(sqrtPrice, TickMath.getSqrtPriceAtTick(seedLower));
    }
}
