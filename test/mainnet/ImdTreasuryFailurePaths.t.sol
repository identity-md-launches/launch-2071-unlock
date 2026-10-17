// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SpotIntegrationFixture} from "./SpotIntegrationFixture.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

contract ImdTreasuryFailurePathsTest is SpotIntegrationFixture, IUnlockCallback {
    function _claims() private view returns (uint256) {
        return manager.balanceOf(address(vault), uint160(address(quote)));
    }

    function testMissingRedemptionReceiptRollsBackBurnAndCanBeRetried() public {
        _buy(alice, 3 ether);
        uint256 fees = vault.totalAccrued();
        assertGt(fees, 0);
        _fundQuote(address(this), 1 ether);
        quote.transfer(address(vault), 1 ether);
        uint256 managerBefore = quote.balanceOf(MANAGER);
        // PoolManager receives a successful transfer response, but the vault receives no IMD.
        vm.mockCall(
            address(quote),
            abi.encodeWithSignature("transfer(address,uint256)", address(vault), fees),
            abi.encode(true)
        );
        vm.expectRevert(ImdFeeVault.InvalidReceipt.selector);
        vault.redeem();
        assertEq(vault.totalRedeemed(), 0);
        assertEq(vault.pendingClaims(), fees);
        assertEq(_claims(), fees, "failed receipt must restore the burned ERC6909 claims");
        assertEq(quote.balanceOf(MANAGER), managerBefore);
        assertEq(quote.balanceOf(address(vault)), 1 ether);
        assertEq(vault.donations(), 1 ether);
        vm.clearMockedCalls();
        _freshFeed();
        vault.redeem();
        assertEq(_claims(), 0);
        assertEq(vault.claimable(), fees);
        assertEq(vault.donations(), 1 ether);
        assertEq(quote.balanceOf(MANAGER), managerBefore - fees);
        vm.prank(vault.BENEFICIARY());
        vault.withdraw();
        assertEq(vault.claimable(), 0);
        assertEq(quote.balanceOf(address(vault)), 1 ether);
    }

    function testFalseTransferReturnRestoresRevenueAndDonationWithdrawalsIndependently() public {
        _buy(alice, 3 ether);
        vault.redeem();
        _fundQuote(address(this), 1 ether);
        quote.transfer(address(vault), 1 ether);
        uint256 fees = vault.claimable();
        address beneficiary = vault.BENEFICIARY();
        uint256 beneficiaryBefore = quote.balanceOf(beneficiary);
        vm.mockCall(
            address(quote),
            abi.encodeWithSignature("transfer(address,uint256)", beneficiary, fees),
            abi.encode(false)
        );
        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(quote)));
        vault.withdraw();
        assertEq(vault.totalWithdrawn(), 0);
        assertEq(vault.claimable(), fees);
        vm.mockCall(
            address(quote),
            abi.encodeWithSignature("transfer(address,uint256)", beneficiary, 1 ether),
            abi.encode(false)
        );
        vm.prank(beneficiary);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(quote)));
        vault.withdrawDonations();
        assertEq(vault.donationsWithdrawn(), 0);
        assertEq(vault.donations(), 1 ether);
        assertEq(quote.balanceOf(beneficiary), beneficiaryBefore);
        vm.clearMockedCalls();
        _freshFeed();
        vm.prank(beneficiary);
        vault.withdrawDonations();
        assertEq(vault.claimable(), fees);
        vm.prank(beneficiary);
        vault.withdraw();
        assertEq(quote.balanceOf(beneficiary) - beneficiaryBefore, fees + 1 ether);
        assertEq(quote.balanceOf(address(vault)), 0);
    }

    function testRedemptionDuringManagerUnlockFailsWithoutLosingClaimsOrLiveness() public {
        _buy(alice, 3 ether);
        uint256 fees = vault.totalAccrued();
        vm.expectRevert(IPoolManager.AlreadyUnlocked.selector);
        manager.unlock(abi.encode(uint8(0), uint256(0)));
        assertEq(vault.totalRedeemed(), 0);
        assertEq(_claims(), fees);
        assertEq(vault.pendingClaims(), fees);
        vault.redeem();
        assertEq(vault.claimable(), fees);
        assertEq(vault.pendingClaims(), 0);
    }

    function testManagerCannotReplayCallbackOutsideAnAuthorizedRedemption() public {
        _buy(alice, 3 ether);
        uint256 fees = vault.totalAccrued();
        vm.prank(MANAGER);
        vm.expectRevert(ImdFeeVault.Unauthorized.selector);
        vault.unlockCallback("");
        assertEq(_claims(), fees);
        assertEq(vault.totalRedeemed(), 0);
        vault.redeem();
        vm.prank(MANAGER);
        vm.expectRevert(ImdFeeVault.Unauthorized.selector);
        vault.unlockCallback("");
        assertEq(vault.totalRedeemed(), fees);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzzDonatedClaimsCannotMasqueradeAsSwapRevenue(uint256 rawDonation) public {
        uint256 donation = bound(rawDonation, 1, 1_000_000 ether);
        _fundQuote(address(this), donation);
        manager.unlock(abi.encode(uint8(1), donation));
        assertEq(vault.donatedClaims(), donation);
        vault.redeem();
        assertEq(vault.totalRedeemed(), 0);
        assertEq(_claims(), donation);
        vm.expectRevert(ImdFeeVault.Unauthorized.selector);
        vault.recordAccrual(donation);
        _buy(alice, 3 ether);
        uint256 fees = vault.totalAccrued();
        vault.redeem();
        assertEq(vault.totalRedeemed(), fees);
        assertEq(vault.claimable(), fees);
        assertEq(_claims(), donation);
        assertEq(vault.donatedClaims(), donation);
        assertEq(vault.donations(), 0);
    }

    function testZeroAndOneWeiReceiptBoundaries() public {
        vault.redeem();
        vm.prank(vault.BENEFICIARY());
        vault.withdraw();
        vm.prank(vault.BENEFICIARY());
        vault.withdrawDonations();
        vm.prank(address(hook));
        vm.expectRevert(ImdFeeVault.InvalidReceipt.selector);
        vault.recordAccrual(0);
        vm.prank(address(hook));
        vm.expectRevert(ImdFeeVault.InvalidReceipt.selector);
        vault.recordAccrual(1);
        assertEq(vault.totalAccrued(), 0);
        _fundQuote(address(this), 1);
        quote.transfer(address(vault), 1);
        address beneficiary = vault.BENEFICIARY();
        uint256 before = quote.balanceOf(beneficiary);
        vm.prank(beneficiary);
        vault.withdraw();
        assertEq(quote.balanceOf(beneficiary), before, "donations are not claimable trading revenue");
        vm.prank(beneficiary);
        vault.withdrawDonations();
        assertEq(quote.balanceOf(beneficiary), before + 1);
        assertEq(vault.totalAccrued(), 0);
        assertEq(vault.totalDonations(), 1);
    }

    function testPrincipalGuardPersistsThroughGlobalBypassAndReferenceFailure() public {
        int256[3] memory removals = [int256(-1), -int256(uint256(type(uint128).max)), type(int256).min];
        for (uint256 state; state < 3; ++state) {
            if (state == 1) {
                _referenceState(uint160(1 << 90), 1e18, 10000);
                assertTrue(hook.checkpoint());
                assertTrue(hook.fullyUnlocked());
            } else if (state == 2) {
                _feedRound(7, 0, block.timestamp, block.timestamp, 7);
                assertFalse(hook.checkpoint());
            }
            // Direct callback authorization tests: model the manager requesting removal for the
            // actual factory. These are not claims that the factory exposes a withdrawal entry point.
            for (uint256 i; i < removals.length; ++i) {
                ModifyLiquidityParams memory params =
                    ModifyLiquidityParams(seedLower, seedUpper, removals[i], bytes32(0));
                vm.prank(MANAGER);
                vm.expectRevert(UnlkImdHook.PrincipalLocked.selector);
                hook.beforeRemoveLiquidity(address(factory), key, params, "");
            }
            ModifyLiquidityParams memory feesOnly = ModifyLiquidityParams(seedLower, seedUpper, 0, bytes32(0));
            vm.prank(MANAGER);
            assertEq(
                hook.beforeRemoveLiquidity(address(factory), key, feesOnly, ""),
                IHooks.beforeRemoveLiquidity.selector
            );
            vm.prank(MANAGER);
            vm.expectRevert(UnlkImdHook.Unauthorized.selector);
            hook.beforeRemoveLiquidity(owner, key, feesOnly, "");
            vm.expectRevert(UnlkImdHook.Unauthorized.selector);
            hook.beforeRemoveLiquidity(address(factory), key, feesOnly, "");
            factory.claimFees(LAUNCH_NUMBER);
            assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == MANAGER, "manager only");
        (uint8 operation, uint256 amount) = abi.decode(data, (uint8, uint256));
        if (operation == 0) {
            vault.redeem();
        } else {
            manager.mint(address(vault), uint160(address(quote)), amount);
            manager.sync(Currency.wrap(address(quote)));
            quote.transfer(MANAGER, amount);
            manager.settle();
        }
        return "";
    }
}
