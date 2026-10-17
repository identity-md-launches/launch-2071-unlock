// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdSwapsTest} from "./ImdSwaps.t.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice Imported audit be47c517 regression. Recorded core/router runtimes with synthetic launch/feed
/// state; changing a core-owned protocol fee must not pause the immutable launch. Inherited cases check
/// all four trade modes, fee-inclusive quotes, quota failures, claims, vault accounting and principal.
contract ImdProtocolFeesTest is ImdSwapsTest {
    using StateLibrary for IPoolManager;

    address internal controller;

    function setUp() public override {
        super.setUp();
        controller = makeAddr("test protocol fee controller");
        vm.prank(manager.owner());
        manager.setProtocolFeeController(controller);
        _protocolFee(1000, 1000); // Maximum allowed by the actual v4 core.
    }

    function _protocolFee(uint16 zeroForOne, uint16 oneForZero) internal {
        vm.prank(controller);
        manager.setProtocolFee(key, uint24(zeroForOne) | uint24(oneForZero) << 12);
        (,, uint24 protocolFee, uint24 lpFee) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        assertEq(protocolFee, uint24(zeroForOne) | uint24(oneForZero) << 12);
        assertEq(lpFee, 12500, "launch LP fee does not change");
    }

    function testControllerChangesDoNotResetQuotaOrBlockTradingDuringReferenceOutage() public {
        _protocolFee(0, 0);
        uint256 bought = _buy(alice, 100 ether);
        _sell(alice, bought / 10);
        uint256 e = hook.eligible(alice);
        uint256 s = hook.sold(alice);
        uint256 quota = hook.remainingQuota(alice);
        _protocolFee(10, 160); // The packed 0x0a000a value from the imported finding.
        assertEq(hook.eligible(alice), e);
        assertEq(hook.sold(alice), s);
        assertEq(hook.remainingQuota(alice), quota);
        assertGt(oracle.fdvUsd(), 0);
        market.setOutage(true);
        uint8 oldTier = hook.tier();
        assertFalse(hook.checkpoint());
        uint256 accrued = vault.totalAccrued();
        assertGt(_sell(alice, quota), 0);
        assertGt(_buy(bob, 1 ether), 0);
        assertGt(vault.totalAccrued(), accrued);
        assertEq(hook.tier(), oldTier);
        assertEq(hook.remainingQuota(alice), 0);
        bytes[] memory extraSale = _explorerPlan(false, 1 ether, 1);
        vm.prank(alice);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.QuotaExceeded.selector);
        router.execute(hex"10", extraSale, block.timestamp + 600);
        _protocolFee(0, 0);
        assertEq(hook.sold(alice), s + quota);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testFuzzDirectionalProtocolFeesPreserveExecutedLegFeeAndSolvency(
        uint16 fee0,
        uint16 fee1,
        uint96 input
    ) public {
        _protocolFee(uint16(bound(fee0, 0, 1000)), uint16(bound(fee1, 0, 1000)));
        uint256 gross = bound(input, 1e12, 1000 ether);
        uint256 managerBefore = quote.balanceOf(MANAGER);
        uint256 bought = _buy(alice, gross);
        uint256 buyFee = vault.totalAccrued();
        uint256 poolInput = gross - buyFee;
        // Exact-input rounding can leave one extra wei in the fixed treasury fee.
        assertGe(buyFee, poolInput * 75 / 10000);
        assertLe(buyFee, poolInput * 75 / 10000 + 1);
        uint256 net = _sell(alice, bought / 10);
        uint256 sellFee = vault.totalAccrued() - buyFee;
        assertEq(sellFee, (net + sellFee) * 75 / 10000);
        assertEq(quote.balanceOf(MANAGER), managerBefore + gross - net);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), vault.totalAccrued());
        assertEq(hook.sold(alice), bought / 10);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testProtocolRevenueIsSeparateFromTreasuryAndLockedPrincipal() public {
        uint256 beforeProtocol = manager.protocolFeesAccrued(Currency.wrap(address(quote)));
        _buy(alice, 100 ether);
        assertGt(manager.protocolFeesAccrued(Currency.wrap(address(quote))), beforeProtocol);
        uint256 fee = vault.totalAccrued();
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), fee);
        vault.redeem();
        assertEq(vault.claimable(), fee);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }
}

contract ImdProtocolFeesReverseTest is ImdProtocolFeesTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
